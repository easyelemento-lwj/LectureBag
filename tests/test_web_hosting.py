"""Railway hosts the same prebuilt frontend without exposing the repository."""
from pathlib import Path
from tests.test_api_security import request
from starlette.requests import Request
from drive_routes import configured_origin
from fastapi import HTTPException
import pytest


def test_frontend_and_health():
    page = request('GET', '/')
    assert page.status_code == 200
    assert 'text/html' in page.headers['content-type']
    assert 'LectureBag' in page.text
    assert page.headers['x-frame-options'] == 'DENY'
    assert 'no-store' in page.headers['cache-control']
    assert request('GET', '/health').json() == {'status': 'ok'}


def test_only_build_assets_are_public():
    for file in (Path(__file__).resolve().parents[1] / 'railway_web' / 'assets').iterdir():
        response = request('GET', '/assets/' + file.name)
        assert response.status_code == 200
        assert response.content == file.read_bytes()
    for path in ['/.env', '/proxy_server.py', '/.git/config', '/api/not-a-route',
                 '/assets/missing.js', '/%2e%2e/.env', '/assets/%2e%2e/%2e%2e/proxy_server.py']:
        assert request('GET', path).status_code == 404


def test_static_mount_does_not_intercept_api():
    assert request('POST', '/api/generate', json={'prompt': 'hello'}).status_code == 401
    assert request('GET', '/api/cloud-files/changes/head?connectionId=00000000-0000-0000-0000-000000000000').status_code == 401


def test_same_origin_get_still_requires_allowlist(monkeypatch):
    origin = 'https://lecturebag-production.up.railway.app'
    scope = {'type': 'http', 'scheme': 'https', 'method': 'GET', 'path': '/',
             'server': ('lecturebag-production.up.railway.app', 443),
             'headers': [(b'sec-fetch-site', b'same-origin'), (b'x-requested-with', b'XmlHttpRequest')]}
    monkeypatch.setenv('DRIVE_WEB_ORIGINS', origin)
    assert configured_origin(Request(scope)) == origin
    monkeypatch.setenv('DRIVE_WEB_ORIGINS', 'https://lecturebag.web.app')
    with pytest.raises(HTTPException):
        configured_origin(Request(scope))
