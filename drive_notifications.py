"""Best-effort cross-replica wakeups. Firestore journal, not Redis, is authoritative.

Uses ordinary REDIS_URL, never the encrypted OAuth grant store. Payload has no
filename, UID or credential. With Redis unavailable, long-poll timeout catches up.
"""
import asyncio
import hashlib
import os
import secrets
from contextlib import asynccontextmanager, AsyncExitStack

from redis.asyncio import Redis
from redis.exceptions import RedisError
from drive_google import failure


def channel(uid, connection_id):
    return 'drive:notify:' + hashlib.sha256(f'{uid}:{connection_id}'.encode()).hexdigest()


async def publish_change(uid, connection_id):
    url = os.environ.get('REDIS_URL')
    if not url:
        return
    try:
        async with asyncio.timeout(2):
            async with Redis.from_url(url, socket_connect_timeout=1, socket_timeout=1) as redis:
                await redis.publish(channel(uid, connection_id), 'changed')
    except (RedisError, OSError, asyncio.TimeoutError, ValueError):
        pass  # Durable journal covers missed wakeups. Do not fail a committed upload.


@asynccontextmanager
async def subscription(uid, connection_id):
    url = os.environ.get('REDIS_URL')
    if not url:
        yield None
        return
    async with AsyncExitStack() as stack:
        try:
            async with asyncio.timeout(2):
                redis = await stack.enter_async_context(Redis.from_url(url, socket_connect_timeout=1, socket_timeout=2))
                subscriber = await stack.enter_async_context(redis.pubsub())
                await subscriber.subscribe(channel(uid, connection_id))
                # Wait for subscribe ACK before the caller reads the durable head.
                while True:
                    message = await subscriber.get_message(timeout=0.5)
                    if message and message['type'] == 'subscribe':
                        break
        except (RedisError, OSError, asyncio.TimeoutError, ValueError):
            subscriber = None
        yield subscriber


@asynccontextmanager
async def watch_slot(tokens, uid):
    """Bound long-polls across replicas; expiry recovers crashed processes."""
    identity = hashlib.sha256(uid.encode()).hexdigest()
    nonce = secrets.token_hex(16)
    slot = None
    for number in range(3):
        key = f'drive:watch:{identity}:{number}'
        if await tokens.redis.set(key, nonce, nx=True, ex=90):
            slot = key
            break
    if slot is None:
        raise failure(429, 'DRIVE_WATCH_LIMIT')
    try:
        async with asyncio.timeout(45):
            yield
    except asyncio.TimeoutError:
        raise failure(503, 'DRIVE_STORAGE_UNAVAILABLE') from None
    finally:
        try:
            await tokens.redis.eval("if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0", 1, slot, nonce)
        except RedisError:
            pass  # Lease expires; do not replace an already-computed response.


async def wait_for_change(subscriber, request, seconds):
    end = asyncio.get_running_loop().time() + seconds
    while asyncio.get_running_loop().time() < end:
        if await request.is_disconnected():
            raise asyncio.CancelledError()
        remaining = min(1, end - asyncio.get_running_loop().time())
        if remaining <= 0:
            break
        if subscriber is None:
            await asyncio.sleep(remaining)
        else:
            try:
                message = await subscriber.get_message(ignore_subscribe_messages=True, timeout=remaining)
                if message and message['type'] == 'message':
                    return
            except (RedisError, OSError, asyncio.TimeoutError):
                subscriber = None
