import asyncio
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from feedback_routes import FeedbackInput, FeedbackStore, admin_allowed, create_feedback_router
import feedback_routes


class MemoryDB:
    def __init__(self):
        self.data = {}

    def collection(self, name):
        db = self

        class Ref:
            def __init__(self, key):
                self.key = key

            def get(self, **kwargs):
                return SimpleNamespace(exists=self.key in db.data, to_dict=lambda: db.data.get(self.key))

        return SimpleNamespace(document=lambda key: Ref((name, key)))

    def transaction(self):
        return SimpleNamespace(set=lambda ref, value: self.data.__setitem__(ref.key, value))


def test_admin_requires_the_single_verified_account(monkeypatch):
    monkeypatch.setenv('FEEDBACK_ADMIN_EMAILS', 'owner@example.com')
    assert admin_allowed({'email': 'easyelemento@gmail.com', 'email_verified': True})
    assert admin_allowed({'email': ' EasyElemento@Gmail.com ', 'email_verified': True})
    assert not admin_allowed({'email': 'easyelemento@gmail.com', 'email_verified': False})
    assert not admin_allowed({'email': 'owner@example.com', 'email_verified': True})
    assert not admin_allowed({'email': 'someone@example.com', 'email_verified': True})
    monkeypatch.delenv('FEEDBACK_ADMIN_EMAILS')
    assert admin_allowed({'email': 'easyelemento@gmail.com', 'email_verified': True})


def test_production_app_mounts_feedback_before_static_fallback(monkeypatch):
    import proxy_server as api
    monkeypatch.setenv('FEEDBACK_ADMIN_EMAILS', 'easyelemento@gmail.com')
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api.app), base_url='http://test') as client:
            # Missing routes previously fell through to static HTML / HTTP 405.
            assert (await client.get('/api/feedback/access')).status_code == 401
            assert (await client.post('/api/feedback', json={})).status_code == 401
            api.app.dependency_overrides[api.verify_firebase_token] = lambda: {
                'uid': 'owner', 'email': 'easyelemento@gmail.com', 'email_verified': True}
            try:
                assert (await client.get('/api/feedback/access')).json() == {'admin': True}
            finally:
                api.app.dependency_overrides.pop(api.verify_firebase_token, None)
    asyncio.run(run())


def test_submission_deduplication_isolation_and_daily_cap(monkeypatch):
    monkeypatch.setattr(feedback_routes.firestore, 'transactional', lambda fn: fn)
    db = MemoryDB()
    store = FeedbackStore(db)
    body = FeedbackInput(requestId=uuid4(), rating=4, comment='좋아요')
    first = store.submit('alice', body)
    assert store.submit('alice', body) == first
    assert store.submit('bob', body) != first
    with pytest.raises(HTTPException) as conflict:
        store.submit('alice', body.model_copy(update={'comment': 'different'}))
    assert conflict.value.status_code == 409
    for _ in range(9):
        store.submit('alice', body.model_copy(update={'requestId': uuid4()}))
    with pytest.raises(HTTPException) as limited:
        store.submit('alice', body.model_copy(update={'requestId': uuid4()}))
    assert limited.value.status_code == 429
    assert store.submit('alice', body) == first  # a retry remains safe at quota
    item = db.data[('beta_feedback', first['id'])]
    assert set(item) == {'rating', 'comment', 'createdAt', 'read'}


def test_private_routes_and_input_validation(monkeypatch):
    monkeypatch.setenv('FEEDBACK_ADMIN_EMAILS', 'owner@example.com')
    current = None
    touched = []

    def verify():
        if current is None:
            raise HTTPException(401)
        return current

    fake = SimpleNamespace(
        submit=lambda uid, body: touched.append('submit') or {'id': 'a' * 64},
        list=lambda cursor: touched.append('list') or {'items': [], 'cursor': None},
        mark=lambda item_id, read: touched.append('mark') or {'ok': True},
    )
    app = FastAPI()
    app.include_router(create_feedback_router(verify, lambda: None, lambda: fake))

    def request(method, path, **kwargs):
        async def run():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
                return await client.request(method, path, **kwargs)
        return asyncio.run(run())

    payload = {'requestId': str(uuid4()), 'rating': 5, 'comment': '테스트'}
    assert request('POST', '/api/feedback', json=payload).status_code == 401
    current = {'uid': 'tester', 'email': 'tester@example.com', 'email_verified': True}
    assert request('GET', '/api/feedback').status_code == 403
    assert request('POST', '/api/feedback/' + 'a' * 64 + '/read', json={'read': True}).status_code == 403
    assert touched == []
    assert request('POST', '/api/feedback', json=payload).status_code == 200
    for changes in [{'rating': 0}, {'rating': 6}, {'rating': True}, {'comment': ' '}, {'comment': 'a' * 501}, {'uid': 'owner'}, {'read': True}]:
        assert request('POST', '/api/feedback', json={**payload, **changes}).status_code == 422
    current = {'uid': 'owner', 'email': 'easyelemento@gmail.com', 'email_verified': True}
    assert request('GET', '/api/feedback').status_code == 200
    assert request('GET', '/api/feedback?cursor=bad').status_code == 422
    assert request('POST', '/api/feedback/' + 'a' * 64 + '/read', json={'read': True}).status_code == 200
    assert request('POST', '/api/feedback/not-an-id/read', json={'read': True}).status_code == 400
