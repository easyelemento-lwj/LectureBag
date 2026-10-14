"""Native trash integration with synthetic Google/Redis and real catalog bodies.

No production credentials, account, Firestore, or Drive files are used.
"""
import asyncio
import copy
import hashlib
import uuid
from contextlib import asynccontextmanager

import pytest
from fastapi import HTTPException

import drive_catalog
import drive_google
import proxy_server as api
from drive_catalog import DriveCatalog
from test_drive import isolated, environment, connect  # noqa: F401; reuse isolated auth/config fixture


class MemoryFirestore:
    def __init__(self):
        self.data = {}
        self.fail = False

    def collection(self, path):
        return Ref(self, path)

    def transaction(self):
        return Transaction(self)


class Snapshot:
    def __init__(self, path, value): self.id, self.value = path.rsplit('/', 1)[-1], value
    def to_dict(self): return copy.deepcopy(self.value)


class Ref:
    def __init__(self, db, path): self.db, self.path = db, path
    @property
    def parent(self): return Ref(self.db, self.path.rsplit('/', 1)[0])
    def collection(self, value): return Ref(self.db, f'{self.path}/{value}')
    def document(self, value): return Ref(self.db, f'{self.path}/{value}')
    def get(self, transaction=None):
        if transaction: assert not transaction.pending, 'Firestore read after write'
        return Snapshot(self.path, self.db.data.get(self.path))
    def order_by(self, field): return Query(self.db, self.path).order_by(field)
    def where(self, filter): return Query(self.db, self.path).where(filter)


class Query:
    def __init__(self, db, path): self.db, self.path, self.filters, self.after, self.count = db, path, [], None, 100
    def where(self, filter): self.filters.append(filter); return self
    def order_by(self, field): self.order = field; return self
    def limit(self, count): self.count = count; return self
    def start_after(self, value): self.after = value; return self
    def stream(self):
        rows = [(path, v) for path, v in self.db.data.items()
                if path.startswith(self.path + '/') and path.count('/') == self.path.count('/') + 1]
        for f in self.filters:
            rows = [(p, v) for p, v in rows if (v.get(f.field_path) == f.value if f.op_string == '==' else v.get(f.field_path) > f.value)]
        rows.sort(key=lambda pair: pair[0] if self.order == '__name__' else pair[1][self.order])
        if self.after:
            rows = [(p, v) for p, v in rows if p > self.after['__name__'].path]
        return [Snapshot(p, v) for p, v in rows[:self.count]]


class Transaction:
    def __init__(self, db): self.db, self.pending = db, {}
    def set(self, ref, value):
        self.pending[ref.path] = copy.deepcopy(value)
        if self.db.fail: raise RuntimeError('synthetic Firestore failure')


@pytest.fixture
def db(monkeypatch):
    db = MemoryFirestore()
    def transactional(fn):
        def execute(tx):
            result = fn(tx)
            db.data.update(tx.pending)
            return result
        return execute
    monkeypatch.setattr(drive_catalog.firestore, 'transactional', transactional)
    return db


@asynccontextmanager
async def setup(monkeypatch, db):
    async with environment(monkeypatch) as (client, svc):
        response, _ = await connect(client)
        connection = svc.catalog.get('alice')
        svc.catalog = DriveCatalog(db)
        db.data['users/alice/driveState/current'] = connection
        file_id = str(uuid.uuid4())
        record = svc.catalog.commit('alice', connection, {'id': file_id, 'connectionId': connection['connectionId'],
            'driveFileId': 'drive-original', 'driveParentId': 'parent', 'logicalFolderId': 'day',
            'name': 'lecture.jpg', 'kind': 'photo', 'mimeType': 'image/jpeg', 'sizeBytes': 12,
            'capturedAt': '2026-10-14T00:00:00+00:00', 'checksum': 'a' * 64, 'checksumAlgorithm': 'sha256'})
        svc.google.remote = {'parent': {'id': 'parent', 'trashed': False}, 'drive-original': {
            'id': 'drive-original', 'trashed': False, 'explicitlyTrashed': False, 'ownedByMe': True, 'isAppAuthorized': True,
            'size': '12', 'mimeType': 'image/jpeg', 'sha256Checksum': 'a' * 64,
            'parents': ['parent'], 'appProperties': {'lecturebagFileId': file_id,
                'lecturebagConnectionId': connection['connectionId'], 'lecturebagOwner': hashlib.sha256(b'alice').hexdigest()}}}
        svc.google.patches = []
        async def file(token, file_id):
            value = svc.google.remote.get(file_id)
            if isinstance(value, Exception): raise value
            if value is None: raise drive_google.failure(404, 'DRIVE_NOT_FOUND_OR_INACCESSIBLE')
            return copy.deepcopy(value)
        async def trash(token, file_id, trashed):
            svc.google.patches.append((file_id, trashed))
            svc.google.remote[file_id].update(trashed=trashed, explicitlyTrashed=trashed)
            return copy.deepcopy(svc.google.remote[file_id])
        svc.google.file, svc.google.trash = file, trash
        yield client, svc, connection, record


def request(connection, record, trashed=True):
    return {'connectionId': connection['connectionId'], 'fileId': record['id'], 'revision': record['revision'],
            'operationId': str(uuid.uuid4()), 'trashed': trashed}


def test_native_trash_restore_journal_and_old_retry_cannot_retrash(monkeypatch, db):
    async def run():
        async with setup(monkeypatch, db) as (client, svc, conn, file):
            remove = request(conn, file)
            first = await client.post('/api/cloud-files/trash', json=remove)
            assert first.status_code == 200, first.text
            deleted = first.json()
            assert deleted['deletedAt'] and deleted['contentRevision'] == 1 and deleted['revision'] == 2
            again = await client.post('/api/cloud-files/trash', json=remove)
            assert again.json() == deleted and len(svc.google.patches) == 1
            restore = await client.post('/api/cloud-files/trash', json=request(conn, deleted, False))
            assert restore.status_code == 200, restore.text
            assert restore.json()['deletedAt'] is None and restore.json()['contentRevision'] == 1
            replay = await client.post('/api/cloud-files/trash', json=remove)
            assert replay.json() == restore.json()
            assert svc.google.patches == [('drive-original', True), ('drive-original', False)]
            events = svc.catalog.changes('alice', conn['connectionId'], svc.catalog.sync_cursor('alice', conn['connectionId'], 0))
            assert [bool(e['file'].get('deletedAt')) for e in events['changes']] == [False, True, False]
            assert not any(e['file'].get('purgedAt') for e in events['changes'])
    asyncio.run(run())


def test_boundaries_revision_conflict_and_origin_do_not_write_google(monkeypatch, db):
    async def run():
        async with setup(monkeypatch, db) as (client, svc, conn, file):
            body = request(conn, file)
            for change, status in [({'connectionId': str(uuid.uuid4())}, 409), ({'fileId': str(uuid.uuid4())}, 404),
                                   ({'revision': 99}, 409), ({'trashed': 'true'}, 422), ({'permanent': True}, 422)]:
                assert (await client.post('/api/cloud-files/trash', json={**body, **change})).status_code == status
            assert (await client.post('/api/cloud-files/trash', json=body, headers={'Origin': 'https://evil.invalid'})).status_code == 403
            api.app.dependency_overrides[api.verify_firebase_token] = lambda: {'uid': 'bob'}
            assert (await client.post('/api/cloud-files/trash', json=body)).status_code == 409
            assert svc.google.patches == []
    asyncio.run(run())


def test_external_trash_restore_and_missing_are_distinct(monkeypatch, db):
    async def run():
        async with setup(monkeypatch, db) as (client, svc, conn, file):
            body = {'connectionId': conn['connectionId']}
            svc.google.remote['drive-original'].update(trashed=True, explicitlyTrashed=True)
            deleted = (await client.post('/api/cloud-files/reconcile', json=body)).json()['files'][0]
            assert deleted['deletedAt'] and not deleted['driveUnavailable']
            saved_remote = svc.google.remote.pop('drive-original')
            missing = (await client.post('/api/cloud-files/reconcile', json=body)).json()['files'][0]
            assert missing['driveUnavailable'] and missing['deletedAt'] == deleted['deletedAt'] and not missing.get('purgedAt')
            svc.google.remote['drive-original'] = {**saved_remote, 'trashed': False, 'explicitlyTrashed': False}
            restored = (await client.post('/api/cloud-files/reconcile', json=body)).json()['files'][0]
            assert not restored['deletedAt'] and not restored['driveUnavailable']
            svc.google.remote.pop('drive-original')
            inaccessible = (await client.post('/api/cloud-files/reconcile', json=body)).json()['files'][0]
            assert inaccessible['driveUnavailable'] and not inaccessible['deletedAt']
            assert svc.google.patches == []  # Observation never deletes or recreates a file.
    asyncio.run(run())


def test_durable_pending_operation_recovers_on_another_device_reconcile(monkeypatch, db):
    async def run():
        async with setup(monkeypatch, db) as (client, svc, conn, file):
            body = request(conn, file)
            svc.catalog.begin_lifecycle('alice', conn, file['id'], body['operationId'], 1, True)
            # Simulate crash after Google accepted PATCH, before catalog receipt.
            svc.google.remote['drive-original'].update(trashed=True, explicitlyTrashed=True)
            result = await client.post('/api/cloud-files/reconcile', json={'connectionId': conn['connectionId']})
            assert result.status_code == 200, result.text
            assert result.json()['files'][0]['deletedAt']
            assert svc.google.patches == []
            assert not svc.catalog.pending_lifecycle('alice', conn['connectionId'], file['id'])
            assert (await client.post('/api/cloud-files/trash', json=body)).status_code == 200
            assert svc.google.patches == []
    asyncio.run(run())


def test_catalog_completion_is_atomic_and_stale_observation_does_not_resurrect(monkeypatch, db):
    async def run():
        async with setup(monkeypatch, db) as (_, svc, conn, file):
            op, _ = svc.catalog.begin_lifecycle('alice', conn, file['id'], str(uuid.uuid4()), 1, True)
            before = copy.deepcopy(db.data)
            db.fail = True
            with pytest.raises(RuntimeError): svc.catalog.observe_lifecycle('alice', conn, file, {'trashed': True}, op)
            assert db.data == before
            db.fail = False
            deleted = svc.catalog.observe_lifecycle('alice', conn, file, {'trashed': True}, op)
            assert svc.catalog.observe_lifecycle('alice', conn, file, {'trashed': False}) == deleted
            assert svc.catalog.sync_head('alice', conn['connectionId'])['sequence'] == 2
    asyncio.run(run())


def test_parent_folder_is_not_restored_implicitly_and_recovery_is_explicit(monkeypatch, db):
    async def run():
        async with setup(monkeypatch, db) as (client, svc, conn, file):
            svc.google.remote['drive-original'].update(trashed=True, explicitlyTrashed=False)
            svc.google.remote['parent']['trashed'] = True
            deleted = (await client.post('/api/cloud-files/reconcile', json={'connectionId': conn['connectionId']})).json()['files'][0]
            result = await client.post('/api/cloud-files/trash', json=request(conn, deleted, False))
            assert result.status_code == 409 and result.json()['detail']['code'] == 'DRIVE_PARENT_TRASHED'
            assert svc.google.patches == []
            svc.google.remote['parent']['trashed'] = False
            recovered = await client.post('/api/cloud-files/reconcile', json={'connectionId': conn['connectionId']})
            assert not recovered.json()['files'][0]['deletedAt']
            assert svc.google.patches == [('drive-original', False)]
    asyncio.run(run())


def test_inventory_pages_include_trash_and_scope_cursors(monkeypatch, db):
    async def run():
        async with setup(monkeypatch, db) as (client, svc, conn, file):
            for n in range(52):
                value = {**file, 'id': f'{n:04}', 'deletedAt': '2026-10-14' if n % 2 else None}
                db.data[f'users/alice/cloudFiles/{value["id"]}'] = value
            db.data['users/alice/cloudFiles/000a'] = {**file, 'id': '000a', 'connectionId': 'previous-generation'}
            first = (await client.get('/api/cloud-files/inventory', params={'connectionId': conn['connectionId']})).json()
            assert first['nextCursor'] and any(f['deletedAt'] for f in first['files'])
            last = (await client.get('/api/cloud-files/inventory', params={'connectionId': conn['connectionId'], 'cursor': first['nextCursor']})).json()
            assert len(first['files']) + len(last['files']) == 53
            assert not last['nextCursor']
            with pytest.raises(HTTPException): svc.catalog.inventory('bob', conn['connectionId'], first['nextCursor'])
            assert svc.google.patches == []
    asyncio.run(run())


def test_google_native_trash_uses_patch_boolean_only(monkeypatch):
    calls = []
    async def mock(method, url, **kwargs): calls.append((method, url, kwargs)); return {}
    monkeypatch.setattr(drive_google, 'google_request', mock)
    async def run():
        google = drive_google.GoogleDrive()
        await google.trash('synthetic', 'registered-id', True)
        await google.trash('synthetic', 'registered-id', False)
        with pytest.raises(HTTPException): await google.trash('synthetic', '../outside', True)
    asyncio.run(run())
    assert [c[0] for c in calls] == ['PATCH', 'PATCH']
    assert [c[2]['json'] for c in calls] == [{'trashed': True}, {'trashed': False}]
    assert all(c[1] == 'https://www.googleapis.com/drive/v3/files/registered-id' for c in calls)


def test_cancellation_precedes_late_original_request_without_inverse_google_write(monkeypatch, db):
    async def run():
        async with setup(monkeypatch, db) as (client, svc, conn, file):
            body = request(conn, file)
            cancelled = await client.post('/api/cloud-files/trash/cancel', json=body)
            assert cancelled.status_code == 200 and not cancelled.json()['deletedAt']
            late = await client.post('/api/cloud-files/trash', json=body)
            assert late.status_code == 200 and not late.json()['deletedAt']
            assert svc.google.patches == []
            # Cancellation after Google already changed the file preserves reality.
            second = request(conn, file)
            svc.catalog.begin_lifecycle('alice', conn, file['id'], second['operationId'], 1, True)
            svc.google.remote['drive-original'].update(trashed=True, explicitlyTrashed=True)
            after_write = await client.post('/api/cloud-files/trash/cancel', json=second)
            assert after_write.status_code == 200 and after_write.json()['deletedAt']
            assert svc.google.patches == []
    asyncio.run(run())


def test_parallel_requests_are_serialized_and_pending_intent_rejects_conflicting_operation(monkeypatch, db):
    async def run():
        async with setup(monkeypatch, db) as (client, svc, conn, file):
            entered, release = asyncio.Event(), asyncio.Event()
            original = svc.google.file
            async def hold(token, file_id):
                if file_id == 'drive-original' and not entered.is_set():
                    entered.set(); await release.wait()
                return await original(token, file_id)
            svc.google.file = hold
            body = request(conn, file)
            first = asyncio.create_task(client.post('/api/cloud-files/trash', json=body))
            await entered.wait()
            second = await client.post('/api/cloud-files/trash', json=request(conn, file, False))
            assert second.status_code == 409 and second.json()['detail']['code'] == 'DRIVE_FILE_BUSY'
            release.set()
            assert (await first).status_code == 200
            assert svc.google.patches == [('drive-original', True)]
    asyncio.run(run())


def test_reconnect_between_metadata_and_patch_fences_old_google_mutation(monkeypatch, db):
    async def run():
        async with setup(monkeypatch, db) as (client, svc, conn, file):
            original = svc.google.file
            async def disconnected(token, file_id):
                result = await original(token, file_id)
                svc.catalog.replace('alice', conn['revision'], {**conn, 'connected': False})
                return result
            svc.google.file = disconnected
            result = await client.post('/api/cloud-files/trash', json=request(conn, file))
            assert result.status_code == 409
            assert svc.google.patches == []
    asyncio.run(run())


def test_inventory_document_cursor_encodes_with_real_firestore_sdk():
    from google.auth.credentials import AnonymousCredentials
    from google.cloud import firestore
    db = firestore.Client(project='synthetic-no-network', credentials=AnonymousCredentials())
    collection = db.collection('users').document('alice').collection('cloudFiles')
    query = collection.order_by('__name__').start_after({'__name__': collection.document('test')}).limit(51)
    request = query._to_protobuf()
    assert request.order_by[0].field.field_path == '__name__'
    assert request.start_at.values[0].reference_value.endswith('/users/alice/cloudFiles/test')


def test_changed_remote_bytes_are_not_mistaken_for_a_valid_restored_pc_copy(monkeypatch, db):
    async def run():
        async with setup(monkeypatch, db) as (client, svc, conn, file):
            svc.google.remote['drive-original']['sha256Checksum'] = 'b' * 64
            response = await client.post('/api/cloud-files/reconcile', json={'connectionId': conn['connectionId']})
            current = response.json()['files'][0]
            assert current['driveUnavailable'] and not current['deletedAt']
            assert current['checksum'] == file['checksum'] and current['contentRevision'] == 1
            assert svc.google.patches == []
    asyncio.run(run())


@pytest.mark.parametrize('mutation', ['not-owner', 'not-app-authorized', 'foreign-property'])
def test_only_exact_registered_owned_drive_file_can_be_trashed(monkeypatch, db, mutation):
    async def run():
        async with setup(monkeypatch, db) as (client, svc, conn, file):
            remote = svc.google.remote['drive-original']
            if mutation == 'not-owner': remote['ownedByMe'] = False
            elif mutation == 'not-app-authorized': remote['isAppAuthorized'] = False
            else: remote['appProperties']['lecturebagOwner'] = hashlib.sha256(b'bob').hexdigest()
            response = await client.post('/api/cloud-files/trash', json=request(conn, file))
            assert response.status_code == 403
            assert svc.google.patches == []
            assert not svc.catalog.file('alice', conn['connectionId'], file['id'])['deletedAt']
    asyncio.run(run())
