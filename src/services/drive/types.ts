export interface DriveConnection {
  connected: boolean;
  revision: number;
  connectionId?: string;
  email?: string;
  updatedAt?: string;
}

export interface DriveIdentity {
  ownerUid: string;
  connectionId: string;
}

export interface CloudMediaRecord extends DriveIdentity {
  id: string;
  driveFileId: string;
  driveParentId: string;
  logicalFolderId: string;
  name: string;
  kind: 'photo' | 'audio' | 'document';
  mimeType: string;
  sizeBytes: number;
  capturedAt: string;
  updatedAt: string;
  revision: number;
  checksum?: string;
  checksumAlgorithm?: 'sha256' | 'md5';
  deletedAt?: string;
  purgedAt?: string;
}

export interface DriveAuthChallenge {
  clientId: string;
  state: string;
  expiresIn: number;
}
