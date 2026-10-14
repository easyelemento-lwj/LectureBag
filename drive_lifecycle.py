"""Reversible, app-owned Drive trash. No permanent deletion, no absence-as-delete.

Firestore keeps the intent across crashes; a later authorized reconcile can finish
it. A distributed per-file lease serializes mutation and observation. Journal
receipts make old request replays harmless even after a subsequent restoration.
"""
import asyncio
import hashlib
import secrets
from contextlib import asynccontextmanager

from fastapi import HTTPException
from redis.exceptions import RedisError

from drive_google import failure


@asynccontextmanager
async def file_lease(svc, uid, connection_id, file_id):
    key = 'drive:lifecycle:' + hashlib.sha256(f'{uid}:{connection_id}:{file_id}'.encode()).hexdigest()
    nonce = secrets.token_hex(16)
    if not await svc.tokens.redis.set(key, nonce, nx=True, ex=180):
        raise failure(409, 'DRIVE_FILE_BUSY')

    async def guard():
        valid = await svc.tokens.redis.eval(
            "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('PTTL',KEYS[1]) end return 0", 1, key, nonce)
        if valid < 60000:
            raise failure(409, 'DRIVE_FILE_BUSY')
    succeeded = False
    try:
        async with asyncio.timeout(90):
            yield guard
        succeeded = True
    except asyncio.TimeoutError:
        raise failure(503, 'DRIVE_STORAGE_UNAVAILABLE') from None
    except HTTPException as error:
        succeeded = error.status_code < 500
        raise
    finally:
        # On ambiguous failures keep the lease until expiry: a timed-out Google
        # request must not overlap a retry. Pending intent remains recoverable.
        if succeeded:
            try:
                await svc.tokens.redis.eval(
                    "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0", 1, key, nonce)
            except RedisError:
                pass


async def current_connection(svc, uid, expected):
    latest = await asyncio.to_thread(svc.catalog.get, uid)
    if not latest.get('connected') or latest['revision'] != expected['revision'] or latest.get('connectionId') != expected['connectionId']:
        raise failure(409, 'DRIVE_CONNECTION_CHANGED')


def owned_file(uid, connection, file, remote):
    props = remote.get('appProperties') or {}
    if (remote.get('id') != file['driveFileId'] or remote.get('driveId') or not remote.get('ownedByMe')
            or not remote.get('isAppAuthorized') or type(remote.get('trashed')) is not bool
            or props.get('lecturebagOwner') != hashlib.sha256(uid.encode()).hexdigest()
            or props.get('lecturebagFileId') != file['id']
            or props.get('lecturebagConnectionId') != connection['connectionId']):
        raise failure(403, 'DRIVE_FILE_NOT_OWNED')
    checksum = remote.get('sha256Checksum' if file.get('checksumAlgorithm') == 'sha256' else 'md5Checksum')
    # A lifecycle check must not accidentally re-authorize an outdated PC copy
    # after the bytes were edited directly in Drive. Content import is separate.
    remote['_catalogContentChanged'] = (remote.get('mimeType') != file.get('mimeType')
        or remote.get('size') != str(file.get('sizeBytes'))
        or (bool(file.get('checksum')) and checksum != file['checksum']))


async def apply_operation(svc, uid, connection, access, file_id, operation_id, revision, trashed, guard):
    op, file = await asyncio.to_thread(svc.catalog.begin_lifecycle, uid, connection, file_id, operation_id, revision, trashed)
    if op['done']:
        return file  # Never replay an old Google write after restore/delete elsewhere.
    remote = await svc.google.file(access, file['driveFileId'])
    owned_file(uid, connection, file, remote)
    if not trashed:
        # Do not silently restore a parent folder (and all unrelated children).
        for parent_id in remote.get('parents', []):
            parent = await svc.google.file(access, parent_id)
            if parent.get('trashed'):
                raise failure(409, 'DRIVE_PARENT_TRASHED')
    await current_connection(svc, uid, connection)
    await guard()
    if remote['trashed'] != trashed:
        await svc.google.trash(access, file['driveFileId'], trashed)
        remote = await svc.google.file(access, file['driveFileId'])
        owned_file(uid, connection, file, remote)
    if remote['trashed'] != trashed:
        raise failure(409, 'DRIVE_TRASH_NOT_CONFIRMED')
    await current_connection(svc, uid, connection)
    return await asyncio.to_thread(svc.catalog.observe_lifecycle, uid, connection, file, remote, op)


async def cancel_operation(svc, uid, connection, access, file_id, operation_id, revision, trashed, guard):
    # Create a terminal receipt even if the original request has not arrived yet.
    # Cancellation observes reality; it never issues an inverse Google mutation.
    op, file = await asyncio.to_thread(svc.catalog.begin_lifecycle, uid, connection, file_id, operation_id, revision, trashed)
    if op['done']:
        return file
    try:
        remote = await svc.google.file(access, file['driveFileId'])
        owned_file(uid, connection, file, remote)
    except HTTPException as error:
        if error.status_code not in (403, 404):
            raise
        remote = None
    await guard()
    return await asyncio.to_thread(svc.catalog.observe_lifecycle, uid, connection, file, remote, op)


async def reconcile_file(svc, uid, connection, access, file):
    try:
        async with file_lease(svc, uid, connection['connectionId'], file['id']) as guard:
            pending = await asyncio.to_thread(svc.catalog.pending_lifecycle, uid, connection['connectionId'], file['id'])
            if pending:
                return await apply_operation(svc, uid, connection, access, file['id'], pending['operationId'],
                                             pending['revision'], pending['trashed'], guard)
            try:
                remote = await svc.google.file(access, file['driveFileId'])
                owned_file(uid, connection, file, remote)
            except HTTPException as error:
                if error.status_code not in (403, 404):
                    raise
                remote = None  # Permission loss / missing file is never a trash command.
            await guard()
            return await asyncio.to_thread(svc.catalog.observe_lifecycle, uid, connection, file, remote)
    except HTTPException as error:
        if error.status_code == 409 and error.detail.get('code') == 'DRIVE_FILE_BUSY':
            return file
        raise
