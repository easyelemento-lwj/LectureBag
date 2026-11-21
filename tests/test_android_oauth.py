import asyncio
import pytest
import drive_google


@pytest.mark.parametrize('enabled,ready,origin,redirect', [
    ('true', 'true', 'https://localhost', ''),
    ('true', 'false', 'https://localhost', 'https://localhost'),
    ('false', 'true', 'https://localhost', 'https://localhost'),
    ('true', 'true', 'https://lecturebag.web.app', 'https://lecturebag.web.app'),
])
def test_android_server_code_exchange_keeps_browser_redirects(monkeypatch, enabled, ready, origin, redirect):
    monkeypatch.setenv('ANDROID_ENABLED', enabled)
    monkeypatch.setenv('ANDROID_OAUTH_READY', ready)
    monkeypatch.setenv('GOOGLE_DRIVE_WEB_CLIENT_ID', 'test-client')
    monkeypatch.setenv('GOOGLE_DRIVE_CLIENT_SECRET', 'test-secret')
    calls = []

    async def request(method, url, **kwargs):
        calls.append(kwargs)
        return {'scope': drive_google.DRIVE_SCOPE, 'access_token': 'test-access', 'id_token': 'test-id'}

    async def about(self, token):
        return {'user': {'permissionId': 'test-permission'}}

    monkeypatch.setattr(drive_google, 'google_request', request)
    monkeypatch.setattr(drive_google, 'verify_identity', lambda token, client: {'sub': 'test-sub', 'email': 'test@example.com'})
    monkeypatch.setattr(drive_google.GoogleDrive, 'about', about)
    _, identity = asyncio.run(drive_google.GoogleDrive().exchange('test-code', origin))
    assert calls[0]['data']['redirect_uri'] == redirect
    assert identity['googleSubject'] == 'test-sub'
