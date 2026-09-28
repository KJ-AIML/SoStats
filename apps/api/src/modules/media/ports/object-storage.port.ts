export const OBJECT_STORAGE_PORT = 'OBJECT_STORAGE_PORT';

export interface ObjectStoragePort {
  /**
   * Generate a pre-signed URL for uploading a file directly to storage.
   */
  generateUploadUrl(
    key: string,
    mimeType: string,
    expiresInSeconds?: number,
  ): Promise<{ uploadUrl: string; key: string }>;

  /**
   * Generate a pre-signed URL to download or view a file.
   */
  generateDownloadUrl(key: string, expiresInSeconds?: number): Promise<string>;

  /**
   * Delete a file from storage.
   */
  deleteFile(key: string): Promise<void>;

  /**
   * Get the public URL for a given key, if the bucket is public.
   */
  getPublicUrl(key: string): string;
}
