"""Account-owned timetable snapshots. Legacy migration starts on mobile only."""
import hashlib
import json
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from firebase_admin import firestore
from pydantic import BaseModel, ConfigDict, Field


class Entry(BaseModel):
    model_config = ConfigDict(extra='forbid')
    subject: str = Field(min_length=1, max_length=300)
    dayOfWeek: int = Field(ge=0, le=6)
    startTime: str = Field(pattern=r'^([01]\d|2[0-3]):[0-5]\d$')
    endTime: str = Field(pattern=r'^([01]\d|2[0-3]):[0-5]\d$')


class Timetable(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: str = Field(min_length=1, max_length=150)
    year: int = Field(ge=1900, le=2200)
    semester: Literal['1학기', '2학기', '여름학기', '겨울학기', '여름계절', '겨울계절']
    startDate: str = Field(pattern=r'^\d{4}-\d{2}-\d{2}$')
    endDate: str = Field(pattern=r'^\d{4}-\d{2}-\d{2}$')
    entries: list[Entry] = Field(max_length=300)
    image: str | None = Field(default=None, max_length=6_000_000)
    createdAt: str = Field(max_length=100)


class TimetableInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    expectedRevision: int = Field(ge=0)
    requestId: UUID
    source: Literal['mobile', 'desktop']
    storageMode: Literal['default', 'timetable']
    timetables: list[Timetable] = Field(max_length=40)


def encode_snapshot(body):
    data = {'timetables': [t.model_dump(exclude_none=True) for t in body.timetables], 'storageMode': body.storageMode}
    for timetable in data['timetables']:
        image = timetable.get('image')
        if image and not image.startswith(('data:image/jpeg;base64,', 'data:image/png;base64,', 'data:image/webp;base64,')):
            raise HTTPException(422, '시간표 사진을 다시 등록해 주세요.')
    encoded = json.dumps(data, ensure_ascii=True, separators=(',', ':'))
    if len(encoded) > 6_000_000:
        raise HTTPException(413, '시간표 사진의 전체 용량이 너무 큽니다.')
    return encoded


class TimetableStore:
    def __init__(self, db):
        self.db = db

    def ref(self, uid):
        return self.db.collection('account_timetables').document(hashlib.sha256(uid.encode()).hexdigest())

    def read(self, uid):
        ref = self.ref(uid)

        @firestore.transactional
        def read(tx):
            state = ref.get(transaction=tx).to_dict() or {}
            if not state:
                return {'revision': 0, 'timetables': [], 'storageMode': 'default'}
            chunks = [ref.collection('chunks').document(str(i)).get(transaction=tx).to_dict()['data']
                      for i in range(state['chunks'])]
            return {**json.loads(''.join(chunks)), 'revision': state['revision']}
        return read(self.db.transaction())

    def write(self, uid, body):
        encoded = encode_snapshot(body)
        chunks = [encoded[i:i + 450_000] for i in range(0, len(encoded), 450_000)]
        digest = hashlib.sha256(encoded.encode()).hexdigest()
        ref = self.ref(uid)

        @firestore.transactional
        def write(tx):
            old = ref.get(transaction=tx).to_dict() or {}
            revision = old.get('revision', 0)
            if old.get('requestId') == str(body.requestId) and old.get('digest') == digest:
                return {'revision': revision}
            if revision != body.expectedRevision:
                raise HTTPException(409, '다른 기기에서 시간표가 변경되었습니다. 저장된 시간표를 다시 불러와 주세요.')
            if not revision and body.source != 'mobile':
                raise HTTPException(409, '모바일에서 시간표를 먼저 동기화해 주세요.')
            if not revision and not body.timetables:
                raise HTTPException(422, '모바일에 등록된 시간표가 필요합니다.')
            for i, chunk in enumerate(chunks):
                tx.set(ref.collection('chunks').document(str(i)), {'data': chunk})
            for i in range(len(chunks), old.get('chunks', 0)):
                tx.delete(ref.collection('chunks').document(str(i)))
            tx.set(ref, {'revision': revision + 1, 'chunks': len(chunks),
                         'requestId': str(body.requestId), 'digest': digest,
                         'updatedAt': firestore.SERVER_TIMESTAMP})
            return {'revision': revision + 1}
        return write(self.db.transaction())


def create_timetable_router(verify_user, firebase_app, store_factory=None):
    router = APIRouter(prefix='/api/timetables')

    def store():
        return store_factory() if store_factory else TimetableStore(firestore.client(app=firebase_app()))

    @router.get('')
    def read(user=Depends(verify_user)):
        return store().read(user['uid'])

    @router.post('')
    def write(body: TimetableInput, user=Depends(verify_user)):
        return store().write(user['uid'], body)

    return router
