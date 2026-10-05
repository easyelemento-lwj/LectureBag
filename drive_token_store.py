"""Encrypted refresh grants in a dedicated persistent Redis secret store.

This store must have persistence, backups, noeviction and a separate ACL.
Keys bind ciphertext to UID + connection generation to prevent substitution.
"""
import hashlib
import json
import os
import secrets
from contextlib import asynccontextmanager

from cryptography.fernet import Fernet, InvalidToken
from redis.asyncio import Redis

from drive_google import failure


def user_key(uid):
    return hashlib.sha256(uid.encode()).hexdigest()


def encryption_keys():
    try:
        current = os.environ['DRIVE_TOKEN_KEY_VERSION']
        values = json.loads(os.environ['DRIVE_TOKEN_KEYS_JSON'])
        keys = {version: Fernet(value.encode()) for version, value in values.items()}
        if current not in keys:
            raise ValueError()
        return current, keys
    except (KeyError, ValueError, TypeError, AttributeError):
        raise failure(503, 'DRIVE_NOT_CONFIGURED') from None


class DriveTokenStore:
    def __init__(self, redis):
        self.redis = redis

    async def challenge(self, uid, origin, revision):
        state = secrets.token_urlsafe(32)
        value = json.dumps({'uid': uid, 'origin': origin, 'revision': revision})
        await self.redis.set(f'drive:state:{hashlib.sha256(state.encode()).hexdigest()}', value, ex=300)
        return state

    async def consume(self, state, uid, origin):
        key = f'drive:state:{hashlib.sha256(state.encode()).hexdigest()}'
        value = await self.redis.getdel(key)
        if not value:
            raise failure(409, 'DRIVE_AUTH_EXPIRED')
        data = json.loads(value)
        if data['uid'] != uid or data['origin'] != origin:
            raise failure(403, 'DRIVE_AUTH_MISMATCH')
        return data['revision']

    async def save(self, uid, connection_id, refresh_token):
        version, keys = encryption_keys()
        ref = secrets.token_hex(24)
        payload = json.dumps({'uid': uid, 'connectionId': connection_id, 'refreshToken': refresh_token})
        envelope = json.dumps({'version': version, 'ciphertext': keys[version].encrypt(payload.encode()).decode()})
        await self.redis.set(f'drive:grant:{user_key(uid)}:{ref}', envelope)
        return ref, version

    async def read(self, uid, connection_id, ref):
        raw = await self.redis.get(f'drive:grant:{user_key(uid)}:{ref}')
        if not raw:
            raise failure(401, 'DRIVE_NEEDS_AUTH')
        try:
            envelope = json.loads(raw)
            _, keys = encryption_keys()
            data = json.loads(keys[envelope['version']].decrypt(envelope['ciphertext'].encode()))
            if data['uid'] != uid or data['connectionId'] != connection_id:
                raise ValueError()
            return data['refreshToken']
        except (KeyError, ValueError, InvalidToken, TypeError):
            raise failure(401, 'DRIVE_NEEDS_AUTH') from None

    async def delete(self, uid, ref):
        if ref:
            await self.redis.delete(f'drive:grant:{user_key(uid)}:{ref}')

    async def rate_limit(self, uid):
        # Atomic increment/expiry; shared across all API replicas.
        count = await self.redis.eval("""
            local n = redis.call('INCR', KEYS[1])
            if n == 1 then redis.call('EXPIRE', KEYS[1], 60) end
            return n
        """, 1, f'drive:rate:{user_key(uid)}')
        if count > 60:
            raise failure(429, 'DRIVE_RATE_LIMITED')


@asynccontextmanager
async def token_store():
    url = os.environ.get('DRIVE_TOKEN_REDIS_URL')
    if not url:
        raise failure(503, 'DRIVE_NOT_CONFIGURED')
    encryption_keys()
    async with Redis.from_url(url, socket_connect_timeout=3, socket_timeout=5) as redis:
        yield DriveTokenStore(redis)
