"""Exact, operator-configured origins shared by CORS and Drive OAuth checks."""
import os
from urllib.parse import urlsplit

DEFAULT_ORIGINS = (
    'https://lecturebag.web.app', 'https://lecturebag.firebaseapp.com',
    'http://localhost:3000', 'http://localhost:5173', 'http://localhost:4173',
)


def drive_web_origins():
    allowed = set()
    for value in os.environ.get('DRIVE_WEB_ORIGINS', '').split(','):
        origin = value.strip()
        try:
            parsed = urlsplit(origin)
            _ = parsed.port  # Reject invalid/out-of-range ports as well.
            if (not parsed.hostname or parsed.username or parsed.password or
                    '*' in origin or any(char.isspace() for char in origin) or
                    origin != f'{parsed.scheme}://{parsed.netloc}'):
                continue
            if parsed.scheme == 'https' or (parsed.scheme == 'http' and parsed.hostname in ('localhost', '127.0.0.1')):
                allowed.add(origin)
        except ValueError:
            continue
    return allowed


def cors_allowed_origins():
    # No wildcard Firebase-preview suffix: only explicitly configured origins.
    return sorted(set(DEFAULT_ORIGINS) | drive_web_origins())
