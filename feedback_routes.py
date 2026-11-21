"""Private beta feedback: authenticated submission, server-authorized administration."""
import hashlib
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from firebase_admin import firestore
from pydantic import BaseModel, ConfigDict, Field


class FeedbackInput(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    requestId: UUID
    rating: int = Field(ge=1, le=5, strict=True)
    comment: str = Field(min_length=1, max_length=500)


class ReadInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    read: bool = Field(strict=True)


def admin_allowed(user):
    return user.get('email_verified') is True and str(user.get('email', '')).strip().lower() == 'easyelemento@gmail.com'


class FeedbackStore:
    def __init__(self, db):
        self.db = db
        self.items = db.collection('beta_feedback')

    def submit(self, uid, body):
        owner = hashlib.sha256(uid.encode()).hexdigest()
        item_id = hashlib.sha256(f'{uid}:{body.requestId}'.encode()).hexdigest()
        ref = self.items.document(item_id)
        now = datetime.now(timezone.utc)
        quota = self.db.collection('beta_feedback_limits').document(f'{owner}_{now:%Y%m%d}')

        @firestore.transactional
        def write(tx):
            existing = ref.get(transaction=tx)
            if existing.exists:
                old = existing.to_dict()
                if old['rating'] != body.rating or old['comment'] != body.comment:
                    raise HTTPException(409, '제출 내용을 확인한 뒤 다시 시도해 주세요.')
                return
            usage = quota.get(transaction=tx)
            count = (usage.to_dict() or {}).get('count', 0)
            if count >= 10:
                raise HTTPException(429, '오늘은 의견을 충분히 보내주셨어요. 내일 다시 남겨주세요.')
            tx.set(ref, {'rating': body.rating, 'comment': body.comment, 'createdAt': now, 'read': False})
            tx.set(quota, {'count': count + 1})

        write(self.db.transaction())
        return {'id': item_id}

    def list(self, cursor):
        query = self.items.order_by('createdAt', direction=firestore.Query.DESCENDING)
        if cursor:
            snapshot = self.items.document(cursor).get()
            if not snapshot.exists:
                raise HTTPException(400, '목록 위치가 변경되었습니다. 새로고침해 주세요.')
            query = query.start_after(snapshot)
        rows = list(query.limit(51).stream())
        items = []
        for row in rows[:50]:
            data = row.to_dict()
            items.append({'id': row.id, 'rating': data['rating'], 'comment': data['comment'],
                          'createdAt': data['createdAt'].isoformat(), 'read': bool(data.get('read'))})
        return {'items': items, 'cursor': rows[49].id if len(rows) > 50 else None}

    def mark(self, item_id, read):
        from google.api_core.exceptions import NotFound
        try:
            self.items.document(item_id).update({'read': read})
        except NotFound:
            raise HTTPException(404, '의견을 찾을 수 없습니다.') from None
        return {'ok': True}


def create_feedback_router(verify_user, firebase_app, store_factory=None):
    router = APIRouter(prefix='/api/feedback')

    def store():
        return store_factory() if store_factory else FeedbackStore(firestore.client(app=firebase_app()))

    def administrator(user=Depends(verify_user)):
        if not admin_allowed(user):
            raise HTTPException(403, '관리자만 확인할 수 있습니다.')
        return user

    @router.get('/access')
    def access(user=Depends(verify_user)):
        return {'admin': admin_allowed(user)}

    @router.post('')
    def submit(body: FeedbackInput, user=Depends(verify_user)):
        return store().submit(user['uid'], body)

    @router.get('')
    def listing(cursor: str | None = Query(None, pattern=r'^[a-f0-9]{64}$'), user=Depends(administrator)):
        return store().list(cursor)

    @router.post('/{item_id}/read')
    def mark(body: ReadInput, item_id: str, user=Depends(administrator)):
        import re
        if not re.fullmatch(r'[a-f0-9]{64}', item_id):
            raise HTTPException(400, '올바르지 않은 의견입니다.')
        return store().mark(item_id, body.read)

    return router
