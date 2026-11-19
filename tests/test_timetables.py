import copy
import threading
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import timetable_routes as routes


@pytest.fixture
def store(monkeypatch):
    data, lock = {}, threading.Lock()

    class Snapshot:
        def __init__(self, value): self.value = copy.deepcopy(value)
        def to_dict(self): return copy.deepcopy(self.value)

    class Ref:
        def __init__(self, path): self.path = path
        def collection(self, name): return Ref(f'{self.path}/{name}')
        def document(self, name): return Ref(f'{self.path}/{name}')
        def get(self, transaction):
            assert not transaction.pending
            return Snapshot(data.get(self.path))

    class Transaction:
        def __init__(self): self.pending = {}
        def set(self, ref, value): self.pending[ref.path] = copy.deepcopy(value)
        def delete(self, ref): self.pending[ref.path] = None

    class DB:
        def collection(self, name): return Ref(name)
        def transaction(self): return Transaction()

    def transactional(fn):
        def run(tx):
            with lock:
                result = fn(tx)
                for key, value in tx.pending.items():
                    if value is None: data.pop(key, None)
                    else: data[key] = value
                return result
        return run
    monkeypatch.setattr(routes.firestore, 'transactional', transactional)
    return routes.TimetableStore(DB()), data


def body(revision=0, source='mobile', **kwargs):
    return routes.TimetableInput(**{'expectedRevision': revision, 'requestId': str(uuid4()),
        'source': source, 'storageMode': 'timetable', 'timetables': [{
            'id': 'mobile-original', 'year': 2026, 'semester': '2학기',
            'startDate': '2026-09-01', 'endDate': '2026-12-31', 'createdAt': '2026-10-01',
            'entries': [{'subject': '경영통계', 'dayOfWeek': 1, 'startTime': '10:00', 'endTime': '11:30'}],
            'image': 'data:image/png;base64,AAAA'}], **kwargs})


def test_pc_cannot_initialize_or_overwrite_mobile(store):
    repo, data = store
    with pytest.raises(HTTPException) as error: repo.write('user', body(source='desktop'))
    assert error.value.status_code == 409 and data == {}
    repo.write('user', body())
    with pytest.raises(HTTPException): repo.write('user', body(source='desktop'))
    assert repo.read('user')['timetables'][0]['id'] == 'mobile-original'


def test_round_trip_images_times_and_mode_and_account_isolation(store):
    repo, _ = store
    original = body()
    assert repo.write('user', original) == {'revision': 1}
    snapshot = repo.read('user')
    assert snapshot['timetables'] == [t.model_dump(exclude_none=True) for t in original.timetables]
    assert snapshot['storageMode'] == 'timetable'
    assert repo.read('other') == {'revision': 0, 'timetables': [], 'storageMode': 'default'}


def test_retry_after_lost_response_is_idempotent(store):
    repo, _ = store
    original = body()
    repo.write('user', original)
    assert repo.write('user', original) == {'revision': 1}
    changed = original.model_copy(update={'storageMode': 'default'})
    with pytest.raises(HTTPException): repo.write('user', changed)


def test_concurrent_edits_do_not_overwrite_each_other(store):
    repo, _ = store
    repo.write('user', body())
    def write(_):
        try: return repo.write('user', body(1))['revision']
        except HTTPException as error: return error.status_code
    with ThreadPoolExecutor(max_workers=2) as executor:
        assert sorted(executor.map(write, range(2))) == [2, 409]


def test_large_image_chunks_and_delete_cleanup(store):
    repo, data = store
    original = body()
    original.timetables[0].image = 'data:image/jpeg;base64,' + 'A' * 1_200_000
    repo.write('user', original)
    assert repo.read('user')['timetables'][0]['image'] == original.timetables[0].image
    assert len(data) == 4
    repo.write('user', body(1, 'desktop', timetables=[], storageMode='default'))
    assert repo.read('user')['timetables'] == []
    assert len(data) == 2


def test_no_empty_bootstrap_or_transient_blob_urls(store):
    repo, data = store
    with pytest.raises(HTTPException): repo.write('user', body(timetables=[]))
    invalid = body()
    invalid.timetables[0].image = 'blob:other-device-only'
    with pytest.raises(HTTPException): repo.write('user', invalid)
    assert not data


def test_authenticated_route_uses_verified_uid(store):
    repo, _ = store
    app = FastAPI()
    app.include_router(routes.create_timetable_router(lambda: {'uid': 'verified'}, None, lambda: repo))
    client = TestClient(app)
    assert client.post('/api/timetables', json=body().model_dump(mode='json')).status_code == 200
    assert client.get('/api/timetables').json()['revision'] == 1
    assert repo.read('verified')['revision'] == 1
    assert repo.read('other')['revision'] == 0
    malicious = body().model_dump(mode='json') | {'uid': 'other'}
    assert client.post('/api/timetables', json=malicious).status_code == 422
