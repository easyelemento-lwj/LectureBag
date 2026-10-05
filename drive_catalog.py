"""Server-only Firestore connection state. Every mutation is revision checked."""
from datetime import datetime, timezone
import base64
import json

from google.cloud import firestore
from google.cloud.firestore_v1.base_query import FieldFilter

from drive_google import failure


def timestamp():
    return datetime.now(timezone.utc).isoformat()


def empty_state():
    return {'revision': 0, 'connected': False}


def public_state(state):
    # An explicit allowlist keeps token references/Google identifiers private.
    keys = ('connected', 'revision', 'connectionId', 'email', 'updatedAt')
    return {key: state[key] for key in keys if key in state}


class DriveCatalog:
    def __init__(self, db):
        self.db = db

    def reference(self, uid):
        if not uid or '/' in uid:
            raise failure(401, 'INVALID_USER')
        return self.db.collection('users').document(uid).collection('driveState').document('current')

    def get(self, uid):
        return self.reference(uid).get().to_dict() or empty_state()

    def replace(self, uid, expected_revision, next_state):
        ref = self.reference(uid)

        @firestore.transactional
        def write(tx):
            current = ref.get(transaction=tx).to_dict() or empty_state()
            if current['revision'] != expected_revision:
                raise failure(409, 'DRIVE_CONNECTION_CHANGED')
            value = {**next_state, 'revision': expected_revision + 1, 'updatedAt': timestamp()}
            tx.set(ref, value)
            if value.get('connectionId'):
                history = ref.parent.parent.collection('driveConnections').document(value['connectionId'])
                # Secret references are stored only on server-readable current state.
                tx.set(history, {k: v for k, v in value.items() if k != 'tokenRef'})
            return value

        return write(self.db.transaction())

    def commit(self, uid, connection, record):
        state_ref = self.reference(uid)
        ref = state_ref.parent.parent.collection('cloudFiles').document(record['id'])

        @firestore.transactional
        def write(tx):
            current = state_ref.get(transaction=tx).to_dict() or empty_state()
            saved = ref.get(transaction=tx).to_dict()
            if not current['connected'] or current['revision'] != connection['revision']:
                raise failure(409, 'DRIVE_CONNECTION_CHANGED')
            if saved:
                fields = ('connectionId', 'driveFileId', 'driveParentId', 'logicalFolderId', 'name',
                          'sizeBytes', 'mimeType', 'kind', 'capturedAt', 'checksum', 'checksumAlgorithm')
                if saved.get('purgedAt') or saved.get('deletedAt') or any(saved.get(k) != record.get(k) for k in fields):
                    raise failure(409, 'DRIVE_FILE_CONFLICT')
                return saved
            value = {**record, 'ownerUid': uid, 'revision': 1, 'updatedAt': timestamp(),
                     'deletedAt': None, 'purgedAt': None}
            tx.set(ref, value)
            return value

        return write(self.db.transaction())

    def list_files(self, uid, connection_id, folder_id, cursor, limit):
        query = self.reference(uid).parent.parent.collection('cloudFiles')
        for field, value in [('connectionId', connection_id), ('logicalFolderId', folder_id), ('deletedAt', None)]:
            query = query.where(filter=FieldFilter(field, '==', value))
        query = query.order_by('capturedAt', direction=firestore.Query.DESCENDING).order_by('id', direction=firestore.Query.DESCENDING)
        if cursor:
            try:
                decoded = json.loads(base64.urlsafe_b64decode(cursor + '=' * (-len(cursor) % 4)))
                if decoded['connectionId'] != connection_id or decoded['folderId'] != folder_id:
                    raise ValueError()
                if not isinstance(decoded['capturedAt'], str) or not isinstance(decoded['id'], str):
                    raise ValueError()
            except (ValueError, KeyError, TypeError):
                raise failure(422, 'DRIVE_INVALID_CURSOR') from None
            query = query.start_after({'capturedAt': decoded['capturedAt'], 'id': decoded['id']})
        values = [doc.to_dict() for doc in query.limit(limit + 1).stream()]
        page = values[:limit]
        next_cursor = None
        if len(values) > limit:
            last = page[-1]
            next_cursor = base64.urlsafe_b64encode(json.dumps({
                'connectionId': connection_id, 'folderId': folder_id,
                'capturedAt': last['capturedAt'], 'id': last['id'],
            }).encode()).decode().rstrip('=')
        return {'files': page, 'nextCursor': next_cursor}
