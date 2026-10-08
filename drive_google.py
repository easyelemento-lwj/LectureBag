"""Small, fixed-host Google client. Never log upstream bodies or credentials."""
import asyncio
import os
import re

import httpx
from fastapi import HTTPException
from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2.id_token import verify_oauth2_token

DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'


def failure(status, code):
    return HTTPException(status, {'code': code})


async def google_request(method, url, *, oauth_token_exchange=False, **kwargs):
    # Callers supply constant Google endpoints, never user-supplied URLs.
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=False) as client:
            response = await client.request(method, url, **kwargs)
        if response.status_code >= 400:
            if oauth_token_exchange and response.status_code == 400:
                # OAuth error identifiers are standardized and safe to classify;
                # do not expose descriptions, codes, tokens, or response bodies.
                error = response.json().get('error') if response.content else ''
                if error == 'invalid_client':
                    raise failure(401, 'DRIVE_OAUTH_CLIENT_REJECTED')
                if error == 'invalid_grant':
                    raise failure(401, 'DRIVE_OAUTH_CODE_REJECTED')
            if response.status_code in (400, 401):
                raise failure(401, 'DRIVE_NEEDS_AUTH')
            if response.status_code == 403:
                raise failure(403, 'DRIVE_ACCESS_DENIED')
            if response.status_code == 404:
                raise failure(404, 'DRIVE_NOT_FOUND_OR_INACCESSIBLE')
            if response.status_code == 429:
                raise failure(429, 'DRIVE_RATE_LIMITED')
            raise failure(502, 'DRIVE_UPSTREAM_ERROR')
        if response.status_code not in (200, 201, 204):
            raise failure(502, 'DRIVE_UPSTREAM_ERROR')
        return response.json() if response.content else {}
    except (httpx.HTTPError, ValueError):
        raise failure(502, 'DRIVE_UPSTREAM_ERROR') from None


def verify_identity(token, client_id):
    try:
        class BoundedRequest(GoogleAuthRequest):
            def __call__(self, *args, **kwargs):
                kwargs['timeout'] = 10
                return super().__call__(*args, **kwargs)
        claims = verify_oauth2_token(token, BoundedRequest(), audience=client_id)
        if not claims.get('sub') or not claims.get('email_verified'):
            raise ValueError('Invalid identity')
        if claims.get('hd'):
            raise failure(403, 'DRIVE_PERSONAL_ACCOUNT_REQUIRED')
        return claims
    except HTTPException:
        raise
    except Exception:
        raise failure(401, 'DRIVE_NEEDS_AUTH') from None


class GoogleDrive:
    async def file(self, token, file_id):
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,200}', file_id):
            raise failure(422, 'DRIVE_INVALID_FILE_ID')
        return await google_request('GET', f'https://www.googleapis.com/drive/v3/files/{file_id}',
            headers={'Authorization': f'Bearer {token}'}, params={'fields':
                'id,name,mimeType,size,parents,md5Checksum,sha256Checksum,trashed,driveId,isAppAuthorized,ownedByMe,appProperties'})

    async def exchange(self, code, origin):
        client_id = os.environ['GOOGLE_DRIVE_WEB_CLIENT_ID']
        token = await google_request('POST', 'https://oauth2.googleapis.com/token', oauth_token_exchange=True, data={
            'code': code, 'client_id': client_id,
            'client_secret': os.environ['GOOGLE_DRIVE_CLIENT_SECRET'],
            'redirect_uri': origin, 'grant_type': 'authorization_code',
        })
        if DRIVE_SCOPE not in token.get('scope', '').split() or not token.get('access_token'):
            raise failure(403, 'DRIVE_SCOPE_REQUIRED')
        claims = await asyncio.to_thread(verify_identity, token.get('id_token', ''), client_id)
        about = await self.about(token['access_token'])
        permission_id = about.get('user', {}).get('permissionId')
        if not permission_id:
            raise failure(502, 'DRIVE_IDENTITY_UNAVAILABLE')
        return token, {'googleSubject': claims['sub'], 'permissionId': permission_id,
                       'email': claims.get('email', '')}

    async def refresh(self, refresh_token):
        token = await google_request('POST', 'https://oauth2.googleapis.com/token', data={
            'refresh_token': refresh_token, 'client_id': os.environ['GOOGLE_DRIVE_WEB_CLIENT_ID'],
            'client_secret': os.environ['GOOGLE_DRIVE_CLIENT_SECRET'], 'grant_type': 'refresh_token',
        })
        if not token.get('access_token'):
            raise failure(401, 'DRIVE_NEEDS_AUTH')
        return token

    async def about(self, token):
        return await google_request('GET', 'https://www.googleapis.com/drive/v3/about',
                                    headers={'Authorization': f'Bearer {token}'},
                                    params={'fields': 'user(permissionId),storageQuota(limit,usage)'})

    async def revoke(self, refresh_token):
        await google_request('POST', 'https://oauth2.googleapis.com/revoke',
                             data={'token': refresh_token})
