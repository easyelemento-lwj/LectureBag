"""Keep the currently shipped web client's server routes registered."""
import proxy_server


def test_web_api_routes_are_registered():
    expected = {
        ('GET', '/api/drive/status'), ('POST', '/api/drive/auth/start'),
        ('POST', '/api/drive/connect'), ('POST', '/api/drive/disconnect'),
        ('POST', '/api/drive/transfer-token'), ('POST', '/api/drive/reserve-id'),
        ('GET', '/api/cloud-files'), ('POST', '/api/cloud-files/commit'),
        ('GET', '/api/cloud-files/inventory'), ('POST', '/api/cloud-files/capture-audit'),
        ('POST', '/api/cloud-files/trash/prepare'), ('POST', '/api/cloud-files/trash'),
        ('POST', '/api/cloud-files/trash/cancel'), ('POST', '/api/cloud-files/reconcile'),
        ('GET', '/api/cloud-files/changes/head'), ('GET', '/api/cloud-files/changes'),
        ('GET', '/api/timetables'), ('POST', '/api/timetables'),
        ('GET', '/api/feedback/access'), ('GET', '/api/feedback'),
        ('POST', '/api/feedback'), ('POST', '/api/feedback/{item_id}/read'),
        ('POST', '/api/analyze-timetable'),
    }
    actual = {(method.upper(), path) for path, operations in proxy_server.app.openapi()['paths'].items()
              for method in operations}
    assert expected - actual == set()
