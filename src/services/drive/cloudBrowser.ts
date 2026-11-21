import { CatalogError, CloudCatalog } from './cloudCatalog';
import { DriveTransferError, type DriveFolder } from './driveClient';
import { trialClient } from './photoTrial';
import type { DriveIdentity } from './types';

export async function checkConnection(catalog: CloudCatalog, identity: DriveIdentity, signal: AbortSignal) {
  signal.throwIfAborted(); catalog.assertOwner(identity.ownerUid);
  const connection = await catalog.status(signal);
  signal.throwIfAborted(); catalog.assertOwner(identity.ownerUid);
  if (!connection.connected || connection.connectionId !== identity.connectionId) throw new CatalogError('DRIVE_CONNECTION_CHANGED', false);
}

export class CloudBrowser {
  private transport?: ReturnType<typeof trialClient>;
  private transportSignal?: AbortSignal;
  constructor(private catalog: CloudCatalog, readonly identity: DriveIdentity) {}

  async folders(parentId: string | undefined, pageToken: string | undefined, signal: AbortSignal) {
    await checkConnection(this.catalog, this.identity, signal);
    // Reuse only within this owned scan/signal; never persist credentials.
    if (!this.transport || this.transportSignal !== signal) {
      this.transport = trialClient(this.catalog, this.identity.connectionId, signal); this.transportSignal = signal;
    }
    const { client, credentials } = this.transport;
    const { ownerHash } = await credentials();
    const page = await client.folders(this.identity.connectionId, ownerHash, parentId, pageToken, signal);
    signal.throwIfAborted(); this.catalog.assertOwner(this.identity.ownerUid);
    return page;
  }

  async root(signal: AbortSignal): Promise<DriveFolder | undefined> {
    let token: string | undefined;
    let root: DriveFolder | undefined;
    const seen = new Set<string>();
    // Empty pages can have a continuation token; don't mistake them for the end.
    for (let i = 0; i < 10; i++) {
      const page = await this.folders(undefined, token, signal);
      for (const folder of page.folders) {
        if (root && root.id !== folder.id) throw new DriveTransferError('failed');
        root = folder;
      }
      token = page.nextPageToken;
      if (!token) return root;
      if (seen.has(token)) break;
      seen.add(token);
    }
    throw new DriveTransferError('retry_wait');
  }

  async files(folder: DriveFolder, cursor: string | undefined, signal: AbortSignal) {
    await checkConnection(this.catalog, this.identity, signal);
    const page = await this.catalog.list(folder.logicalFolderId, cursor, signal);
    signal.throwIfAborted(); this.catalog.assertOwner(this.identity.ownerUid);
    if (!Array.isArray(page.files) || page.files.length > 50 ||
      (page.nextCursor !== null && typeof page.nextCursor !== 'string')) throw new DriveTransferError('failed');
    for (const file of page.files) {
      if (file.ownerUid !== this.identity.ownerUid || file.connectionId !== this.identity.connectionId ||
        file.logicalFolderId !== folder.logicalFolderId || file.driveParentId !== folder.id || file.deletedAt || file.purgedAt) {
        throw new DriveTransferError('failed');
      }
    }
    return page;
  }
}

export function driveReadError(error: unknown) {
  if (error instanceof CatalogError) return error.message;
  if (error instanceof DriveTransferError) {
    if (error.httpStatus === 429) return 'Drive 요청 조절을 위해 잠시 대기합니다. 자동으로 이어받습니다.';
    if (error.code === 'not_found') return 'Drive 원본을 찾을 수 없거나 접근할 수 없습니다. 기기 원본은 삭제하지 않습니다.';
    if (error.code === 'needs_auth') return 'Drive 권한을 다시 확인해 주세요.';
    if (error.code === 'retry_wait') return '연결이 불안정합니다. 인터넷 연결을 확인하고 다시 시도해 주세요.';
  }
  return 'Drive 자료를 확인하지 못했습니다. 연결을 확인한 뒤 목록을 새로고침해 주세요.';
}
