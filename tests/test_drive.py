"""Drive boundary tests use synthetic credentials and no real Google/Firestore traffic."""
import asyncio
import copy
import hashlib
import json
import uuid
from contextlib import asynccontextmanager

import fakeredis.aioredis
import httpx
import pytest
from cryptography.fernet import Fernet
from fastapi import HTTPException

import proxy_server as api
import drive_routes
import drive_google
from drive_catalog import DriveCatalog, empty_state
from drive_token_store import DriveTokenStore

ORIGIN = 'http://localhost:3000'
HEADERS = {'Origin': ORIGIN, 'X-Requested-With': 'XmlHttpRequest'}


class MemoryCatalog:
    def __init__(self):
        self.values = {}
        self.files = {}

    def get(self, uid):
        return copy.deepcopy(self.values.get(uid, empty_state()))

    def replace(self, uid, expected_revision, state):
        if self.get(uid)['revision'] != expected_revision:
            raise drive_google.failure(409, 'DRIVE_CONNECTION_CHANGED')
        self.values[uid] = {**state, 'revision': expected_revision + 1}
        return self.get(uid)

    def commit(self, uid, connection, record):
        self.files[(uid, record['id'])] = record
        return record

    def list_files(self, uid, connection_id, folder_id, cursor, limit):
        return {'files': [v for (owner, _), v in self.files.items() if owner == uid
                          and v['connectionId'] == connection_id and v['logicalFolderId'] == folder_id][:limit],
                'nextCursor': None}


class FakeGoogle:
    def __init__(self):
        self.subject = 'google-alice'
        self.refresh_value = 'synthetic-refresh-secret'
        self.remote = {}
        self.calls = 0

    async def exchange(self, code, origin):
        self.calls += 1
        assert origin == ORIGIN
        assert code == 'synthetic-code'
        return {'refresh_token': self.refresh_value, 'access_token': 'synthetic-access'}, {
            'googleSubject': self.subject, 'permissionId': 'permission-alice', 'email': 'alice@example.com',
        }

    async def refresh(self, token):
        assert token == 'synthetic-refresh-secret'
        return {'access_token': 'synthetic-access'}

    async def file(self, token, file_id):
        return copy.deepcopy(self.remote[file_id])


@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    api.app.dependency_overrides.clear()
    api.app.dependency_overrides[api.verify_firebase_token] = lambda: {'uid': 'alice'}
    monkeypatch.setenv('DRIVE_ENABLED', 'true')
    monkeypatch.setenv('DRIVE_INTERNAL_TEST_UIDS', 'alice,bob')
    monkeypatch.setenv('GOOGLE_DRIVE_WEB_CLIENT_ID', 'synthetic-client')
    monkeypatch.setenv('GOOGLE_DRIVE_CLIENT_SECRET', 'synthetic-secret')
    monkeypatch.setenv('DRIVE_WEB_ORIGINS', ORIGIN)
    monkeypatch.setenv('DRIVE_TOKEN_KEY_VERSION', 'v1')
    monkeypatch.setenv('DRIVE_TOKEN_KEYS_JSON', json.dumps({'v1': Fernet.generate_key().decode()}))
    yield
    api.app.dependency_overrides.clear()


@asynccontextmanager
async def environment(monkeypatch):
    async with fakeredis.aioredis.FakeRedis() as redis:
        svc = drive_routes.DriveServices(MemoryCatalog(), DriveTokenStore(redis), FakeGoogle())
        @asynccontextmanager
        async def fake_services(_):
            yield svc
        monkeypatch.setattr(drive_routes, 'services', fake_services)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api.app, raise_app_exceptions=False),
                                    base_url='https://test', headers=HEADERS) as client:
            yield client, svc


async def connect(client):
    challenge = await client.post('/api/drive/auth/start', json={})
    assert challenge.status_code == 200, challenge.text
    body = {'state': challenge.json()['state'], 'code': 'synthetic-code'}
    response = await client.post('/api/drive/connect', json=body)
    return response, body


def test_connect_binds_identity_and_keeps_credentials_out_of_responses(monkeypatch):
    async def run():
        async with environment(monkeypatch) as (client, svc):
            response, body = await connect(client)
            assert response.status_code == 200, response.text
            assert response.json()['connected'] is True
            assert 'synthetic-refresh-secret' not in response.text
            assert 'tokenRef' not in response.text
            state = svc.catalog.get('alice')
            assert await svc.tokens.read('alice', state['connectionId'], state['tokenRef']) == 'synthetic-refresh-secret'
            again = await client.post('/api/drive/connect', json=body)
            assert again.status_code == 409
            assert svc.google.calls == 1
            api.app.dependency_overrides[api.verify_firebase_token] = lambda: {'uid': 'bob'}
            assert (await client.get('/api/drive/status')).json()['connected'] is False
    asyncio.run(run())


@pytest.mark.parametrize('change', ['disabled', 'not_allowed', 'no_auth', 'unconfigured'])
def test_private_endpoints_fail_closed(monkeypatch, change):
    if change == 'disabled': monkeypatch.setenv('DRIVE_ENABLED', 'false')
    if change == 'not_allowed': monkeypatch.setenv('DRIVE_INTERNAL_TEST_UIDS', '')
    if change == 'no_auth': api.app.dependency_overrides.clear()
    if change == 'unconfigured': monkeypatch.delenv('GOOGLE_DRIVE_CLIENT_SECRET')
    async def run():
        async with environment(monkeypatch) as (client, _):
            response = await client.get('/api/drive/status')
            assert response.status_code == {'no_auth': 401, 'unconfigured': 503}.get(change, 404)
    asyncio.run(run())


def test_oauth_challenge_cannot_be_used_by_another_user_or_origin(monkeypatch):
    async def run():
        async with environment(monkeypatch) as (client, svc):
            state = (await client.post('/api/drive/auth/start', json={})).json()['state']
            api.app.dependency_overrides[api.verify_firebase_token] = lambda: {'uid': 'bob'}
            response = await client.post('/api/drive/connect', json={'state': state, 'code': 'synthetic-code'})
            assert response.status_code == 403
            assert svc.google.calls == 0
            response = await client.post('/api/drive/auth/start', json={}, headers={'Origin': 'https://attacker.example'})
            assert response.status_code == 403
            response = await client.post('/api/drive/auth/start', json={}, headers={'X-Requested-With': ''})
            assert response.status_code == 403
    asyncio.run(run())


def test_existing_connection_cannot_silently_switch_google_account(monkeypatch):
    async def run():
        async with environment(monkeypatch) as (client, svc):
            first, _ = await connect(client)
            svc.google.subject = 'google-bob'
            second, _ = await connect(client)
            assert second.status_code == 409
            assert (await client.get('/api/drive/status')).json() == first.json()
    asyncio.run(run())


def test_reauthorization_reuses_refresh_grant_when_google_omits_it(monkeypatch):
    async def run():
        async with environment(monkeypatch) as (client, svc):
            first, _ = await connect(client)
            svc.google.refresh_value = None
            second, _ = await connect(client)
            assert second.status_code == 200
            assert second.json()['connectionId'] == first.json()['connectionId']
            assert second.json()['revision'] == first.json()['revision'] + 1
            assert len(await svc.tokens.redis.keys('drive:grant:*')) == 1
    asyncio.run(run())


def test_initial_missing_refresh_grant_does_not_create_a_connection(monkeypatch):
    async def run():
        async with environment(monkeypatch) as (client, svc):
            svc.google.refresh_value = None
            result, _ = await connect(client)
            assert result.status_code == 409
            assert not svc.catalog.get('alice')['connected']
    asyncio.run(run())


def test_disconnect_invalidates_pending_oauth_and_deletes_only_its_grant(monkeypatch):
    async def run():
        async with environment(monkeypatch) as (client, svc):
            connected, _ = await connect(client)
            first = connected.json()
            challenge = (await client.post('/api/drive/auth/start', json={})).json()
            response = await client.post('/api/drive/disconnect', json={
                'connectionId': first['connectionId'], 'revision': first['revision']})
            assert response.status_code == 200
            assert not response.json()['connected']
            assert await svc.tokens.redis.keys('drive:grant:*') == []
            stale = await client.post('/api/drive/connect', json={'code': 'synthetic-code', 'state': challenge['state']})
            assert stale.status_code == 409
            assert svc.google.calls == 1
            second, _ = await connect(client)
            assert second.json()['connectionId'] != first['connectionId']
            stale = await client.post('/api/drive/disconnect', json={
                'connectionId': first['connectionId'], 'revision': first['revision']})
            assert stale.status_code == 409
            assert svc.catalog.get('alice')['connected']
    asyncio.run(run())


def test_encrypted_store_is_bound_to_user_and_generation_and_supports_old_keys(monkeypatch):
    async def run():
        async with environment(monkeypatch) as (_, svc):
            old = json.loads(__import__('os').environ['DRIVE_TOKEN_KEYS_JSON'])['v1']
            ref, _ = await svc.tokens.save('alice', 'generation-1', 'synthetic-secret')
            raw = await svc.tokens.redis.get((await svc.tokens.redis.keys('drive:grant:*'))[0])
            assert b'synthetic-secret' not in raw
            with pytest.raises(HTTPException): await svc.tokens.read('bob', 'generation-1', ref)
            with pytest.raises(HTTPException): await svc.tokens.read('alice', 'generation-2', ref)
            monkeypatch.setenv('DRIVE_TOKEN_KEYS_JSON', json.dumps({'v1': old, 'v2': Fernet.generate_key().decode()}))
            monkeypatch.setenv('DRIVE_TOKEN_KEY_VERSION', 'v2')
            assert await svc.tokens.read('alice', 'generation-1', ref) == 'synthetic-secret'
            _, version = await svc.tokens.save('alice', 'generation-1', 'new-secret')
            assert version == 'v2'
    asyncio.run(run())


def test_oversized_and_unknown_fields_do_not_echo_secrets(monkeypatch):
    async def run():
        async with environment(monkeypatch) as (client, _):
            response = await client.post('/api/drive/connect', json={'code': 'PRIVATE', 'state': 'x' * 32, 'uid': 'bob'})
            assert response.status_code == 422
            assert 'PRIVATE' not in response.text
            response = await client.post('/api/drive/connect', content=b'x' * 65537)
            assert response.status_code == 413
    asyncio.run(run())


@pytest.mark.parametrize('mutation,expected', [('', 200), ('owner', 403), ('size', 409), ('mime', 409), ('parent', 409), ('trash', 403)])
def test_commit_verifies_google_file_before_catalog_registration(monkeypatch, mutation, expected):
    async def run():
        async with environment(monkeypatch) as (client, svc):
            result, _ = await connect(client)
            connection = result.json()['connectionId']
            file_id = str(uuid.uuid4())
            svc.google.remote = {
                'remote-file': {'id': 'remote-file', 'name': 'lecture.m4a', 'mimeType': 'audio/mp4', 'size': '1024',
                    'parents': ['parent'], 'ownedByMe': True, 'isAppAuthorized': True,
                    'appProperties': {'lecturebagFileId': file_id, 'lecturebagConnectionId': connection,
                                      'lecturebagOwner': hashlib.sha256(b'alice').hexdigest()}},
                'parent': {'id': 'parent', 'mimeType': 'application/vnd.google-apps.folder', 'ownedByMe': True,
                    'appProperties': {'lecturebagConnectionId': connection, 'lecturebagFolderId': 'course'}},
            }
            file = svc.google.remote['remote-file']
            if mutation == 'owner': file['ownedByMe'] = False
            if mutation == 'size': file['size'] = '512'
            if mutation == 'mime': file['mimeType'] = 'text/plain'
            if mutation == 'parent': svc.google.remote['parent']['appProperties']['lecturebagConnectionId'] = 'other'
            if mutation == 'trash': file['trashed'] = True
            response = await client.post('/api/cloud-files/commit', json={'id': file_id, 'connectionId': connection,
                'driveFileId': 'remote-file', 'logicalFolderId': 'course', 'capturedAt': '2026-10-05T09:00:00+09:00',
                'sizeBytes': 1024, 'mimeType': 'audio/mp4'})
            assert response.status_code == expected, response.text
            if expected == 200:
                listing = await client.get('/api/cloud-files', params={'folderId': 'course'})
                assert len(listing.json()['files']) == 1
                assert 'dataUrl' not in listing.text
                api.app.dependency_overrides[api.verify_firebase_token] = lambda: {'uid': 'bob'}
                await connect(client)
                assert (await client.get('/api/cloud-files', params={'folderId': 'course'})).json()['files'] == []
            else:
                assert svc.catalog.files == {}
    asyncio.run(run())


def test_rate_limit_and_page_bounds(monkeypatch):
    async def run():
        async with environment(monkeypatch) as (client, svc):
            assert (await client.get('/api/cloud-files', params={'folderId': 'x', 'limit': 500})).status_code == 422
            for _ in range(60):
                await svc.tokens.rate_limit('separate-user')
            with pytest.raises(HTTPException) as exc: await svc.tokens.rate_limit('separate-user')
            assert exc.value.status_code == 429
    asyncio.run(run())


def test_google_errors_never_expose_upstream_text(monkeypatch, caplog):
    class Client:
        def __init__(self, **kwargs): assert kwargs['follow_redirects'] is False
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def request(self, *args, **kwargs):
            return httpx.Response(401, json={'error': 'SECRET-TOKEN'})
    monkeypatch.setattr(drive_google.httpx, 'AsyncClient', Client)
    async def run():
        with pytest.raises(HTTPException) as exc:
            await drive_google.google_request('POST', 'https://oauth2.googleapis.com/token')
        assert exc.value.detail == {'code': 'DRIVE_NEEDS_AUTH'}
        assert 'SECRET-TOKEN' not in caplog.text
    asyncio.run(run())


@pytest.mark.parametrize('upstream,expected', [
    ('invalid_client', 'DRIVE_OAUTH_CLIENT_REJECTED'),
    ('invalid_grant', 'DRIVE_OAUTH_CODE_REJECTED'),
])
def test_oauth_exchange_classifies_safe_standard_errors(monkeypatch, upstream, expected):
    class Client:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def request(self, *args, **kwargs):
            return httpx.Response(400, json={'error': upstream, 'error_description': 'secret detail'})
    monkeypatch.setattr(drive_google.httpx, 'AsyncClient', Client)
    async def run():
        with pytest.raises(HTTPException) as exc:
            await drive_google.google_request('POST', 'https://oauth2.googleapis.com/token', oauth_token_exchange=True)
        assert exc.value.detail == {'code': expected}
    asyncio.run(run())


def test_oauth_exchange_classifies_invalid_client_returned_as_401(monkeypatch):
    class Client:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def request(self, *args, **kwargs): return httpx.Response(401, json={'error': 'invalid_client'})
    monkeypatch.setattr(drive_google.httpx, 'AsyncClient', Client)
    async def run():
        with pytest.raises(HTTPException) as exc:
            await drive_google.google_request('POST', 'https://oauth2.googleapis.com/token', oauth_token_exchange=True)
        assert exc.value.detail == {'code': 'DRIVE_OAUTH_CLIENT_REJECTED'}
    asyncio.run(run())


@pytest.mark.parametrize('claims,expected', [
    ({'sub': 'person', 'email_verified': True}, None),
    ({'sub': 'person', 'email_verified': False}, 401),
    ({'email_verified': True}, 401),
    ({'sub': 'person', 'email_verified': True, 'hd': 'school.example'}, 403),
])
def test_google_identity_requires_verified_audience_and_personal_account(monkeypatch, claims, expected):
    def verify(token, request, audience):
        assert token == 'synthetic-id-token'
        assert audience == 'expected-web-client'
        return claims
    monkeypatch.setattr(drive_google, 'verify_oauth2_token', verify)
    if expected:
        with pytest.raises(HTTPException) as exc:
            drive_google.verify_identity('synthetic-id-token', 'expected-web-client')
        assert exc.value.status_code == expected
    else:
        assert drive_google.verify_identity('synthetic-id-token', 'expected-web-client')['sub'] == 'person'


def test_missing_drive_scope_stops_before_account_or_file_access(monkeypatch):
    async def fake_request(*args, **kwargs):
        return {'access_token': 'synthetic-access', 'scope': 'openid email'}
    monkeypatch.setattr(drive_google, 'google_request', fake_request)
    async def run():
        with pytest.raises(HTTPException) as exc:
            await drive_google.GoogleDrive().exchange('synthetic-code', ORIGIN)
        assert exc.value.detail['code'] == 'DRIVE_SCOPE_REQUIRED'
    asyncio.run(run())


def test_real_catalog_transaction_rejects_stale_writes_and_deleted_file_registration(monkeypatch):
    # Run the actual catalog mutation bodies against a deterministic transaction double.
    import drive_catalog
    data = {}
    class Ref:
        def __init__(self, path): self.path = path
        def collection(self, value): return Ref(f'{self.path}/{value}')
        def document(self, value): return Ref(f'{self.path}/{value}')
        @property
        def parent(self): return Ref(self.path.rsplit('/', 1)[0])
        def get(self, **kwargs): return self
        def to_dict(self): return copy.deepcopy(data.get(self.path))
    class Transaction:
        def set(self, ref, value): data[ref.path] = copy.deepcopy(value)
    class DB:
        def collection(self, value): return Ref(value)
        def transaction(self): return Transaction()
    monkeypatch.setattr(drive_catalog.firestore, 'transactional', lambda f: f)
    catalog = DriveCatalog(DB())
    state = catalog.replace('alice', 0, {'connected': True, 'connectionId': 'c'})
    with pytest.raises(HTTPException): catalog.replace('alice', 0, {'connected': False})
    record = {'id': 'file', 'connectionId': 'c', 'driveFileId': 'g', 'sizeBytes': 12}
    first = catalog.commit('alice', state, record)
    assert catalog.commit('alice', state, record) == first
    with pytest.raises(HTTPException): catalog.commit('alice', state, {**record, 'sizeBytes': 24})
    data['users/alice/cloudFiles/file']['purgedAt'] = 'deleted'
    with pytest.raises(HTTPException): catalog.commit('alice', state, record)
    catalog.replace('alice', 1, {'connected': False, 'connectionId': 'c'})
    with pytest.raises(HTTPException): catalog.commit('alice', state, {**record, 'id': 'next'})
    assert catalog.get('bob')['connected'] is False
