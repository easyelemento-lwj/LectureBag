import asyncio
import base64

import httpx
import pytest
import fakeredis.aioredis
from fastapi import HTTPException
import proxy_server as api
from api_security import AiQuota, MAX_BODY_BYTES, RequestBoundary


def request(method, path, **kwargs):
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api.app, raise_app_exceptions=False), base_url='https://test') as client:
            return await client.request(method, path, **kwargs)
    return asyncio.run(run())


@pytest.fixture(autouse=True)
def reset(monkeypatch):
    api.app.dependency_overrides.clear()
    monkeypatch.setenv('GEMINI_API_KEY', 'test-key-not-real')
    yield
    api.app.dependency_overrides.clear()


def login():
    api.app.dependency_overrides[api.verify_firebase_token] = lambda: {'uid': 'alice'}


def test_private_routes_require_authentication():
    for path, body in [('/api/generate', {'prompt': 'test'}), ('/api/analyze-timetable', {'base64Image': 'test'}), ('/api/summarize', {'fileName': 'test', 'fileDataUrl': 'test'})]:
        assert request('POST', path, json=body).status_code == 401
    assert request('GET', '/api/models').status_code == 404
    assert request('GET', '/docs').status_code == 404


@pytest.mark.parametrize('error_type', [api.auth.InvalidIdTokenError, api.auth.RevokedIdTokenError, api.auth.UserDisabledError])
def test_invalid_revoked_and_disabled_tokens_rejected(monkeypatch, error_type):
    monkeypatch.setattr(api, 'firebase_app', lambda: object())
    def verify(token, **kwargs):
        assert kwargs['check_revoked'] is True
        raise error_type('sensitive internal reason')
    monkeypatch.setattr(api.auth, 'verify_id_token', verify)
    response = request('POST', '/api/generate', headers={'Authorization': 'Bearer invalid'}, json={'prompt': 'test'})
    assert response.status_code == 401
    assert 'sensitive' not in response.text


def test_payload_and_validation_limits_do_not_echo_input():
    login()
    response = request('POST', '/api/generate', json={'prompt': 'SECRET' * 4000})
    assert response.status_code == 422
    assert 'SECRET' not in response.text
    response = request('POST', '/api/generate', content=b'{}', headers={'Content-Length': str(MAX_BODY_BYTES + 1)})
    assert response.status_code == 413


def test_chunked_body_limit_is_enforced_before_route():
    async def run():
        entered = False
        async def app(scope, receive, send):
            nonlocal entered
            entered = True
        messages = iter([{'type': 'http.request', 'body': b'x' * (MAX_BODY_BYTES // 2 + 1), 'more_body': True}] * 2)
        async def receive(): return next(messages)
        output = []
        async def send(message): output.append(message)
        await RequestBoundary(app)({'type': 'http', 'method': 'POST', 'headers': []}, receive, send)
        assert output[0]['status'] == 413
        assert not entered
    asyncio.run(run())


def test_media_signature_and_mime_validation():
    for url in ['data:image/jpeg;base64,' + base64.b64encode(b'<script>bad</script>').decode(), 'data:text/html;base64,PHNjcmlwdD4=', 'data:image/png;base64,???']:
        with pytest.raises(HTTPException) as exc: api.parse_media(url)
        assert exc.value.status_code == 422
    api.parse_media('data:image/png;base64,' + base64.b64encode(b'\x89PNG\r\n\x1a\ndata').decode(), images_only=True)
    api.parse_media('data:audio/webm;codecs=opus;base64,' + base64.b64encode(b'\x1aE\xdf\xa3test').decode())
    api.parse_media('data:application/octet-stream;base64,' + base64.b64encode(b'\x89PNG\r\n\x1a\ndata').decode(), images_only=True)
    with pytest.raises(HTTPException): api.parse_media('data:audio/ogg;base64,T2dnUw==', images_only=True)


def test_missing_quota_configuration_fails_closed(monkeypatch):
    monkeypatch.delenv('REDIS_URL', raising=False)
    with pytest.raises(HTTPException) as exc: AiQuota().connection()
    assert exc.value.status_code == 503


def test_distributed_quota_limits_and_releases_leases(monkeypatch):
    monkeypatch.setenv('AI_REQUESTS_PER_DAY', '1')
    monkeypatch.setenv('AI_GLOBAL_CONCURRENCY', '1')
    async def run():
        redis = fakeredis.aioredis.FakeRedis()
        a, b = AiQuota(), AiQuota()
        a.connection = b.connection = lambda: redis
        async with a.slot('alice'):
            with pytest.raises(HTTPException) as exc:
                async with b.slot('bob'): pass
            assert exc.value.status_code == 429
        async with b.slot('bob'): pass  # Global lease was released.
        with pytest.raises(HTTPException) as exc:
            async with b.slot('alice'): pass  # Daily budget shared across instances.
        assert exc.value.status_code == 429
        await redis.aclose()
    asyncio.run(run())


def test_upstream_error_sanitized_and_output_bound(monkeypatch):
    login()
    class Quota:
        def slot(self, uid):
            from contextlib import asynccontextmanager
            @asynccontextmanager
            async def context(): yield
            return context()
    class Client:
        def __init__(self, **kwargs):
            self.aio = self
            self.models = self
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def generate_content(self, **kwargs):
            assert kwargs['config'].max_output_tokens == 4096
            raise RuntimeError('LEAKED-SECRET-KEY')
        def close(self): pass
    monkeypatch.setattr(api, 'quota', Quota())
    monkeypatch.setattr(api.genai, 'Client', Client)
    response = request('POST', '/api/generate', json={'prompt': 'test'})
    assert response.status_code == 502
    assert 'LEAKED' not in response.text
    assert response.headers['x-content-type-options'] == 'nosniff'


def test_localhost_cors_supports_real_development_port():
    response = request('OPTIONS', '/api/generate', headers={'Origin': 'http://localhost:3000', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type'})
    assert response.status_code == 200
    assert response.headers['access-control-allow-origin'] == 'http://localhost:3000'
