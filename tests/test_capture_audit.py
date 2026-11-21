"""Stable Drive namespaces: actual Firestore transaction bodies, no remote traffic."""
import copy
from concurrent.futures import ThreadPoolExecutor
import hashlib
import threading

import pytest
from fastapi import HTTPException

import drive_catalog
from drive_catalog import DriveCatalog, public_state


@pytest.fixture
def store(monkeypatch):
    data = {}
    lock = threading.Lock()

    class Snapshot:
        def __init__(self, value): self.value = copy.deepcopy(value)
        def to_dict(self): return copy.deepcopy(self.value)

    class Ref:
        def __init__(self, path): self.path = path
        def collection(self, name): return Ref(f'{self.path}/{name}')
        def document(self, name): return Ref(f'{self.path}/{name}')
        @property
        def parent(self): return Ref(self.path.rsplit('/', 1)[0])
        def get(self, transaction=None):
            if transaction: assert not transaction.pending, 'Read after Firestore write'
            return Snapshot(data.get(self.path))

    class Transaction:
        def __init__(self): self.pending = {}
        def set(self, ref, value): self.pending[ref.path] = copy.deepcopy(value)

    class DB:
        def collection(self, name): return Ref(name)
        def transaction(self): return Transaction()

    def transactional(fn):
        def run(tx):
            with lock:
                result = fn(tx)
                data.update(tx.pending)
                return result
        return run

    monkeypatch.setattr(drive_catalog.firestore, 'transactional', transactional)
    return DriveCatalog(DB()), data


def connect(catalog, subject, uid='alice'):
    current = catalog.get(uid)
    connection = catalog.library_connection(uid, current, subject)
    return catalog.replace(uid, current['revision'], {
        'connected': True, 'connectionId': connection, 'googleSubject': subject,
        'permissionId': 'permission-' + subject, 'tokenRef': 'private-grant'})


def disconnect(catalog, uid='alice'):
    current = catalog.get(uid)
    return catalog.replace(uid, current['revision'], {
        'connected': False, 'connectionId': current['connectionId']})


def test_capture_audit_protects_old_connections_and_deletion_tombstones(store):
    catalog, data = store
    data['users/alice/cloudFiles/current'] = {'ownerUid': 'alice', 'connectionId': 'current'}
    data['users/alice/cloudFiles/old'] = {'ownerUid': 'alice', 'connectionId': 'previous'}
    data['users/alice/cloudFiles/removed'] = {'ownerUid': 'alice', 'connectionId': 'current', 'deletedAt': 'date'}
    data['users/alice/cloudFiles/purged'] = {'ownerUid': 'alice', 'connectionId': 'previous', 'purgedAt': 'date'}
    data['users/bob/cloudFiles/missing'] = {'ownerUid': 'bob', 'connectionId': 'current'}
    before = copy.deepcopy(data)
    result = catalog.capture_audit('alice', 'current', ['current', 'old', 'removed', 'purged', 'missing'])
    assert [row['status'] for row in result] == ['registered', 'previous', 'deleted', 'deleted', 'missing']
    assert data == before
    assert all(set(row) == {'fileId', 'status'} for row in result)
    data['users/alice/cloudFiles/corrupt'] = {'ownerUid': 'bob', 'connectionId': 'current'}
    with pytest.raises(HTTPException): catalog.capture_audit('alice', 'current', ['corrupt'])
