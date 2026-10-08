import asyncio

import httpx
from starlette.applications import Starlette
from starlette.middleware.cors import CORSMiddleware

from web_origins import cors_allowed_origins, drive_web_origins


def test_explicit_preview_origin_is_shared_and_default_origins_are_preserved(monkeypatch):
    preview = 'https://lecturebag--device-test-example.web.app'
    monkeypatch.setenv('DRIVE_WEB_ORIGINS', f'http://localhost:3000, {preview}, {preview}')
    assert drive_web_origins() == {'http://localhost:3000', preview}
    assert preview in cors_allowed_origins()
    assert 'https://lecturebag.web.app' in cors_allowed_origins()
    assert '*' not in cors_allowed_origins()


def test_malformed_and_nonsecure_remote_origins_fail_closed(monkeypatch):
    monkeypatch.setenv('DRIVE_WEB_ORIGINS', ','.join([
        '*', 'https://*.web.app', 'http://remote.example', 'https://user:pass@host.test',
        'https://host.test/', 'https://host.test/path', 'https://host.test?query',
        'https://host.test#fragment', 'https://host.test:99999', 'https://',
    ]))
    assert drive_web_origins() == set()


def test_preflight_allows_only_the_configured_preview(monkeypatch):
    preview = 'https://lecturebag--device-test-example.web.app'
    monkeypatch.setenv('DRIVE_WEB_ORIGINS', preview)
    app = CORSMiddleware(Starlette(), allow_origins=cors_allowed_origins(),
                         allow_methods=['GET', 'POST'],
                         allow_headers=['Authorization', 'Content-Type', 'X-Requested-With'])

    async def check():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='https://api.test') as client:
            for origin, accepted in [(preview, True), ('https://other--preview-example.web.app', False)]:
                result = await client.options('/api/drive/status', headers={
                    'Origin': origin, 'Access-Control-Request-Method': 'GET',
                    'Access-Control-Request-Headers': 'authorization,content-type,x-requested-with',
                })
                assert result.status_code == (200 if accepted else 400)
                assert result.headers.get('access-control-allow-origin') == (origin if accepted else None)
                assert 'access-control-allow-credentials' not in result.headers
    asyncio.run(check())
