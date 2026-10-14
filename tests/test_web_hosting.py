"""Railway hosts the same prebuilt frontend without exposing the repository."""
from pathlib import Path
from tests.test_api_security import request


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
