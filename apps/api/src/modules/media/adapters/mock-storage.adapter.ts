import { Injectable, Logger } from '@nestjs/common';
import type { ObjectStoragePort } from '../ports/object-storage.port.js';

@Injectable()
export class MockObjectStorageAdapter implements ObjectStoragePort {
  private readonly logger = new Logger(MockObjectStorageAdapter.name);
  private readonly baseUrl = 'https://mock-storage.example.com';

  async generateUploadUrl(
    key: string,
    _mimeType: string,
    expiresInSeconds = 3600,
  ): Promise<{ uploadUrl: string; key: string }> {
    this.logger.debug(`Generating mock upload URL for key: ${key}`);
    return {
      uploadUrl: `${this.baseUrl}/upload/${key}?expires=${expiresInSeconds}`,
      key,
    };
  }

  async generateDownloadUrl(
    key: string,
    expiresInSeconds = 3600,
  ): Promise<string> {
    this.logger.debug(`Generating mock download URL for key: ${key}`);
    return `${this.baseUrl}/download/${key}?expires=${expiresInSeconds}`;
  }

  async statFile(_key: string) {
    return {
      size: 1024,
      contentType: 'application/octet-stream',
      etag: '"mock-etag"',
    };
  }

  async deleteFile(key: string): Promise<void> {
    this.logger.debug(`Mock deleting file: ${key}`);
    // No-op for mock
  }

  getPublicUrl(key: string): string {
    return `${this.baseUrl}/public/${key}`;
  }
}
