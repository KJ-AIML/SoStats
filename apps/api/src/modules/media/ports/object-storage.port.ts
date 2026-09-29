export const OBJECT_STORAGE_PORT = 'OBJECT_STORAGE_PORT';

export type ObjectStorageStat = {
  size: number;
  contentType?: string | null;
  etag?: string | null;
};

export interface ObjectStoragePort {
  generateUploadUrl(
    key: string,
    mimeType: string,
    expiresInSeconds?: number,
  ): Promise<{ uploadUrl: string; key: string }>;

  generateDownloadUrl(key: string, expiresInSeconds?: number): Promise<string>;

  statFile(key: string): Promise<ObjectStorageStat>;

  deleteFile(key: string): Promise<void>;

  getPublicUrl(key: string): string | null;
}
