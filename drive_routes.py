"""Internal-only Drive connection milestone; disabled unless explicitly enabled."""
import asyncio
import logging
import os
import uuid
import hashlib
from datetime import timezone
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Annotated
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, Request, Query, Response
from pydantic import BaseModel, ConfigDict, Field, SecretStr, AwareDatetime
from redis.exceptions import RedisError
from google.api_core.exceptions import GoogleAPIError

from drive_catalog import DriveCatalog, public_state
from drive_google import GoogleDrive, failure
from drive_token_store import token_store

logger = logging.getLogger('lecturebag.drive')


class ConnectRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    code: SecretStr = Field(min_length=1, max_length=4096)
    state: str = Field(min_length=32, max_length=128, pattern=r'^[A-Za-z0-9_-]+$')


class DisconnectRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    connectionId: uuid.UUID
    revision: Annotated[int, Field(strict=True, ge=1)]


class TransferRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    connectionId: uuid.UUID


class ReserveRequest(TransferRequest):
    key: str = Field(pattern=r'^[A-Za-z0-9_-]{1,100}$')
    candidate: str = Field(pattern=r'^[A-Za-z0-9_-]{1,200}$')


class CommitRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: uuid.UUID
    connectionId: uuid.UUID
    driveFileId: str = Field(pattern=r'^[A-Za-z0-9_-]{1,200}$')
    logicalFolderId: str = Field(min_length=1, max_length=200)
    capturedAt: AwareDatetime
    sizeBytes: Annotated[int, Field(strict=True, ge=1, le=5 * 1024**4)]
    mimeType: str = Field(pattern=r'^[a-zA-Z0-9.+_-]+/[a-zA-Z0-9.+_-]+$', max_length=100)


@dataclass
class DriveServices:
    catalog: DriveCatalog
    tokens: object
    google: GoogleDrive


@asynccontextmanager
async def services(firebase_app):
    # Lazy initialization: ordinary AI endpoints still work with Drive disabled.
    from firebase_admin import firestore
    try:
        async with token_store() as tokens:
            yield DriveServices(DriveCatalog(firestore.client(app=firebase_app())), tokens, GoogleDrive())
    except (RedisError, GoogleAPIError) as error:
        # Keep client errors opaque, but retain the failing dependency class in
        # Railway logs. Never log tokens, Redis URLs, or provider responses.
        logger.warning('Drive storage dependency unavailable: %s', type(error).__name__)
        raise failure(503, 'DRIVE_STORAGE_UNAVAILABLE') from None


def configured_origin(request):
    origin = request.headers.get('origin', '')
    allowed = set(filter(None, os.environ.get('DRIVE_WEB_ORIGINS', '').split(',')))
    parsed = urlsplit(origin)
    if origin not in allowed or parsed.path or parsed.query or parsed.fragment or parsed.username:
        raise failure(403, 'DRIVE_ORIGIN_DENIED')
    if parsed.scheme != 'https' and not (parsed.scheme == 'http' and parsed.hostname in ('localhost', '127.0.0.1')):
        raise failure(403, 'DRIVE_ORIGIN_DENIED')
    if request.headers.get('x-requested-with') != 'XmlHttpRequest':
        raise failure(403, 'DRIVE_ORIGIN_DENIED')
    return origin


def create_drive_router(verify_user, firebase_app):
    router = APIRouter(prefix='/api')

    async def enabled_user(user=Depends(verify_user)):
        allowed = set(filter(None, os.environ.get('DRIVE_INTERNAL_TEST_UIDS', '').split(',')))
        if os.environ.get('DRIVE_ENABLED') != 'true' or user['uid'] not in allowed:
            raise failure(404, 'DRIVE_DISABLED')
        if not os.environ.get('GOOGLE_DRIVE_WEB_CLIENT_ID') or not os.environ.get('GOOGLE_DRIVE_CLIENT_SECRET'):
            raise failure(503, 'DRIVE_NOT_CONFIGURED')
        return user['uid']

    async def deps(uid=Depends(enabled_user)):
        async with services(firebase_app) as svc:
            await svc.tokens.rate_limit(uid)
            yield uid, svc

    @router.get('/drive/status')
    async def status(context=Depends(deps)):
        uid, svc = context
        return public_state(await asyncio.to_thread(svc.catalog.get, uid))

    @router.post('/drive/transfer-token')
    async def transfer_token(body: TransferRequest, request: Request, response: Response, context=Depends(deps)):
        configured_origin(request)
        uid, svc = context
        current = await asyncio.to_thread(svc.catalog.get, uid)
        if not current['connected'] or current['connectionId'] != str(body.connectionId):
            raise failure(409, 'DRIVE_CONNECTION_CHANGED')
        refresh = await svc.tokens.read(uid, current['connectionId'], current['tokenRef'])
        token = await svc.google.refresh(refresh)
        latest = await asyncio.to_thread(svc.catalog.get, uid)
        if latest['revision'] != current['revision']:
            raise failure(409, 'DRIVE_CONNECTION_CHANGED')
        response.headers['Cache-Control'] = 'no-store'
        response.headers['Pragma'] = 'no-cache'
        return {'accessToken': token['access_token'], 'expiresIn': token.get('expires_in', 300),
                'ownerHash': hashlib.sha256(uid.encode()).hexdigest()}

    @router.post('/drive/reserve-id')
    async def reserve_id(body: ReserveRequest, request: Request, context=Depends(deps)):
        configured_origin(request)
        uid, svc = context
        current = await asyncio.to_thread(svc.catalog.get, uid)
        if not current['connected'] or current['connectionId'] != str(body.connectionId):
            raise failure(409, 'DRIVE_CONNECTION_CHANGED')
        key = hashlib.sha256(f'{body.connectionId}:{body.key}'.encode()).hexdigest()
        value = await asyncio.to_thread(svc.catalog.reserve_id, uid, current, key, body.candidate)
        return {'id': value}

    @router.post('/drive/auth/start')
    async def start(request: Request, context=Depends(deps)):
        origin = configured_origin(request)
        uid, svc = context
        current = await asyncio.to_thread(svc.catalog.get, uid)
        state = await svc.tokens.challenge(uid, origin, current['revision'])
        return {'state': state, 'expiresIn': 300, 'clientId': os.environ['GOOGLE_DRIVE_WEB_CLIENT_ID']}

    @router.post('/drive/connect')
    async def connect(body: ConnectRequest, request: Request, context=Depends(deps)):
        origin = configured_origin(request)
        uid, svc = context
        expected = await svc.tokens.consume(body.state, uid, origin)
        current = await asyncio.to_thread(svc.catalog.get, uid)
        if current['revision'] != expected:
            raise failure(409, 'DRIVE_CONNECTION_CHANGED')
        token, identity = await svc.google.exchange(body.code.get_secret_value(), origin)
        if current['connected'] and current['googleSubject'] != identity['googleSubject']:
            raise failure(409, 'DRIVE_ACCOUNT_MISMATCH')
        connection_id = current['connectionId'] if current['connected'] else str(uuid.uuid4())
        refresh_token = token.get('refresh_token')
        if not refresh_token and current['connected']:
            refresh_token = await svc.tokens.read(uid, connection_id, current['tokenRef'])
        if not refresh_token:
            raise failure(409, 'DRIVE_OFFLINE_CONSENT_REQUIRED')
        ref, version = await svc.tokens.save(uid, connection_id, refresh_token)
        try:
            updated = await asyncio.to_thread(svc.catalog.replace, uid, expected, {
                **identity, 'connected': True, 'connectionId': connection_id,
                'tokenRef': ref, 'tokenKeyVersion': version,
            })
        except Exception:
            # A transport timeout may follow a successful Firestore commit.
            # Never delete a grant which current state might already reference.
            try:
                actual = await asyncio.to_thread(svc.catalog.get, uid)
                if actual.get('tokenRef') != ref:
                    await svc.tokens.delete(uid, ref)
            except Exception:
                pass  # Preserve the encrypted grant for later reconciliation.
            raise
        await svc.tokens.delete(uid, current.get('tokenRef'))
        return public_state(updated)

    @router.post('/drive/disconnect')
    async def disconnect(body: DisconnectRequest, context=Depends(deps)):
        uid, svc = context
        current = await asyncio.to_thread(svc.catalog.get, uid)
        if current.get('connectionId') != str(body.connectionId) or current['revision'] != body.revision:
            raise failure(409, 'DRIVE_CONNECTION_CHANGED')
        # Invalidate the generation before deleting credentials; workers must recheck it.
        updated = await asyncio.to_thread(svc.catalog.replace, uid, body.revision, {
            'connected': False, 'connectionId': current['connectionId'],
        })
        await svc.tokens.delete(uid, current.get('tokenRef'))
        return public_state(updated)

    @router.post('/cloud-files/commit')
    async def commit(body: CommitRequest, context=Depends(deps)):
        uid, svc = context
        current = await asyncio.to_thread(svc.catalog.get, uid)
        if not current['connected'] or current['connectionId'] != str(body.connectionId):
            raise failure(409, 'DRIVE_CONNECTION_CHANGED')
        refresh = await svc.tokens.read(uid, current['connectionId'], current['tokenRef'])
        access = (await svc.google.refresh(refresh))['access_token']
        remote = await svc.google.file(access, body.driveFileId)
        properties = remote.get('appProperties', {})
        # Initial upload registration only. Picker imports need a separate endpoint.
        expected = {'lecturebagFileId': str(body.id), 'lecturebagConnectionId': str(body.connectionId),
                    'lecturebagOwner': hashlib.sha256(uid.encode()).hexdigest()}
        if (remote.get('trashed') or remote.get('driveId') or not remote.get('ownedByMe')
                or not remote.get('isAppAuthorized') or any(properties.get(k) != v for k, v in expected.items())):
            raise failure(403, 'DRIVE_FILE_NOT_OWNED')
        parents = remote.get('parents', [])
        if len(parents) != 1 or remote.get('size') != str(body.sizeBytes) or remote.get('mimeType') != body.mimeType:
            raise failure(409, 'DRIVE_FILE_MISMATCH')
        parent = await svc.google.file(access, parents[0])
        parent_properties = parent.get('appProperties', {})
        if (parent.get('trashed') or not parent.get('ownedByMe') or
                parent.get('mimeType') != 'application/vnd.google-apps.folder' or
                parent_properties.get('lecturebagConnectionId') != str(body.connectionId) or
                parent_properties.get('lecturebagFolderId') != body.logicalFolderId):
            raise failure(409, 'DRIVE_FOLDER_MISMATCH')
        mime = body.mimeType
        kind = 'photo' if mime.startswith('image/') else 'audio' if mime.startswith('audio/') else 'document'
        if kind == 'document' and mime not in ('application/pdf', 'text/plain', 'text/markdown'):
            raise failure(422, 'DRIVE_UNSUPPORTED_MEDIA')
        checksum = remote.get('sha256Checksum') or remote.get('md5Checksum')
        record = {'id': str(body.id), 'connectionId': str(body.connectionId),
            'driveFileId': body.driveFileId, 'driveParentId': parents[0],
            'logicalFolderId': body.logicalFolderId, 'name': remote['name'], 'kind': kind,
            'mimeType': mime, 'sizeBytes': body.sizeBytes,
            'capturedAt': body.capturedAt.astimezone(timezone.utc).isoformat(),
            'checksum': checksum,
            'checksumAlgorithm': 'sha256' if remote.get('sha256Checksum') else 'md5' if checksum else None}
        return await asyncio.to_thread(svc.catalog.commit, uid, current, record)

    @router.get('/cloud-files')
    async def list_files(folderId: str = Query(min_length=1, max_length=200),
                         cursor: str | None = Query(default=None, max_length=2048),
                         limit: int = Query(default=50, ge=1, le=50), context=Depends(deps)):
        uid, svc = context
        current = await asyncio.to_thread(svc.catalog.get, uid)
        if not current['connected']:
            raise failure(409, 'DRIVE_CONNECTION_CHANGED')
        result = await asyncio.to_thread(svc.catalog.list_files, uid, current['connectionId'], folderId, cursor, limit)
        latest = await asyncio.to_thread(svc.catalog.get, uid)
        if latest['revision'] != current['revision']:
            raise failure(409, 'DRIVE_CONNECTION_CHANGED')
        return result

    return router
