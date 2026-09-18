"""Bounded request intake and distributed per-user AI budgets."""
import asyncio
import hashlib
import os
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import HTTPException
from redis.asyncio import Redis
from starlette.responses import JSONResponse

MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_BODY_BYTES = 14 * 1024 * 1024


class RequestBoundary:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        request_id = uuid.uuid4().hex
        scope.setdefault('state', {})['request_id'] = request_id

        async def secure_send(message):
            if message['type'] == 'http.response.start':
                message.setdefault('headers', []).extend([
                    (b'x-content-type-options', b'nosniff'),
                    (b'cache-control', b'no-store'),
                    (b'x-request-id', request_id.encode()),
                ])
            await send(message)

        if scope['method'] != 'POST':
            return await self.app(scope, receive, secure_send)
        headers = dict(scope.get('headers', []))
        try:
            length = int(headers.get(b'content-length', b'0'))
            if length < 0:
                raise ValueError()
        except ValueError:
            return await JSONResponse({'detail': '잘못된 요청입니다.'}, 400)(scope, receive, secure_send)
        if length > MAX_BODY_BYTES:
            return await JSONResponse({'detail': '파일이 너무 큽니다.'}, 413)(scope, receive, secure_send)
        # Enforce the same bound for chunked requests before JSON/base64 parsing.
        body = bytearray()
        deadline = asyncio.get_running_loop().time() + 15
        while True:
            try:
                remaining = deadline - asyncio.get_running_loop().time()
                if remaining <= 0:
                    raise TimeoutError()
                message = await asyncio.wait_for(receive(), remaining)
            except TimeoutError:
                return await JSONResponse({'detail': '요청 수신 시간이 초과되었습니다.'}, 408)(scope, receive, secure_send)
            if message['type'] == 'http.disconnect':
                return
            body.extend(message.get('body', b''))
            if len(body) > MAX_BODY_BYTES:
                return await JSONResponse({'detail': '파일이 너무 큽니다.'}, 413)(scope, receive, secure_send)
            if not message.get('more_body', False):
                break
        delivered = False

        async def replay():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {'type': 'http.request', 'body': bytes(body), 'more_body': False}
            return await receive()

        await self.app(scope, replay, secure_send)


# All counters and leases change atomically, including across server replicas.
# Keys share a Redis hash tag for Redis Cluster compatibility.
ACQUIRE = """
redis.call('ZREMRANGEBYSCORE', KEYS[4], '-inf', ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[5], '-inf', ARGV[1])
for i = 1, 3 do
  if tonumber(redis.call('GET', KEYS[i]) or '0') >= tonumber(ARGV[i+3]) then return 0 end
end
if redis.call('ZCARD', KEYS[4]) >= tonumber(ARGV[7]) then return 0 end
if redis.call('ZCARD', KEYS[5]) >= tonumber(ARGV[8]) then return 0 end
for i = 1, 3 do
  redis.call('INCR', KEYS[i])
  redis.call('EXPIRE', KEYS[i], i == 1 and 120 or 172800)
end
for i = 4, 5 do
  redis.call('ZADD', KEYS[i], ARGV[2], ARGV[3])
  redis.call('EXPIRE', KEYS[i], 120)
end
return 1
"""


class AiQuota:
    def __init__(self):
        self.redis = None
        self.url = None

    def connection(self):
        url = os.environ.get('REDIS_URL')
        if not url:
            # Never fall back to an ineffective per-process production quota.
            raise HTTPException(503, 'AI 서비스를 준비 중입니다.')
        if self.redis is None or self.url != url:
            self.url = url
            self.redis = Redis.from_url(url, socket_connect_timeout=2, socket_timeout=2)
        return self.redis

    @asynccontextmanager
    async def slot(self, uid):
        redis = self.connection()
        now = time.time()
        identity = hashlib.sha256(uid.encode()).hexdigest()
        prefix = 'lecturebag:{ai}'
        keys = [f'{prefix}:minute:{identity}:{int(now // 60)}',
                f'{prefix}:day:{identity}:{int(now // 86400)}',
                f'{prefix}:day:all:{int(now // 86400)}',
                f'{prefix}:active:{identity}', f'{prefix}:active:all']
        lease = uuid.uuid4().hex
        try:
            allowed = await redis.eval(ACQUIRE, len(keys), *keys, now, now + 90, lease,
                int(os.environ.get('AI_REQUESTS_PER_MINUTE', '10')),
                int(os.environ.get('AI_REQUESTS_PER_DAY', '50')),
                int(os.environ.get('AI_GLOBAL_REQUESTS_PER_DAY', '1000')),
                int(os.environ.get('AI_USER_CONCURRENCY', '2')),
                int(os.environ.get('AI_GLOBAL_CONCURRENCY', '4')))
        except Exception:
            raise HTTPException(503, 'AI 서비스를 잠시 사용할 수 없습니다.') from None
        if not allowed:
            raise HTTPException(429, '사용 한도에 도달했습니다. 잠시 후 다시 시도해주세요.', headers={'Retry-After': '60'})
        try:
            yield
        finally:
            try:
                await redis.zrem(keys[3], lease)
                await redis.zrem(keys[4], lease)
            except Exception:
                pass  # Leases expire even after a crash or Redis disconnect.
