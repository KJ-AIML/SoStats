import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { S3ObjectStorageAdapter } from './s3-storage.adapter.js';

describe('S3ObjectStorageAdapter', () => {
  const original = {
    endpoint: process.env.MINIO_ENDPOINT,
    user: process.env.MINIO_ROOT_USER,
    password: process.env.MINIO_ROOT_PASSWORD,
    bucket: process.env.MINIO_BUCKET,
    publicBase: process.env.S3_PUBLIC_BASE_URL,
  };

  beforeEach(() => {
    process.env.MINIO_ENDPOINT = 'http://localhost:9000';
    process.env.MINIO_ROOT_USER = 'test-access-key';
    process.env.MINIO_ROOT_PASSWORD = 'test-secret-key';
    process.env.MINIO_BUCKET = 'sostats-uploads';
    delete process.env.S3_PUBLIC_BASE_URL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    const restore = (name: string, value: string | undefined) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };

    restore('MINIO_ENDPOINT', original.endpoint);
    restore('MINIO_ROOT_USER', original.user);
    restore('MINIO_ROOT_PASSWORD', original.password);
    restore('MINIO_BUCKET', original.bucket);
    restore('S3_PUBLIC_BASE_URL', original.publicBase);
  });

  it('creates AWS SigV4-compatible timestamp/query fields', async () => {
    const adapter = new S3ObjectStorageAdapter();
    const { uploadUrl } = await adapter.generateUploadUrl(
      'workspaces/1/assets/example.png',
      'image/png',
      900,
    );

    const url = new URL(uploadUrl);
    expect(url.pathname).toBe(
      '/sostats-uploads/workspaces/1/assets/example.png',
    );
    expect(url.searchParams.get('X-Amz-Date')).toMatch(
      /^\d{8}T\d{6}Z$/,
    );
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
  });

  it('uses an authenticated HEAD request to verify stored objects', async () => {
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      expect(init?.method).toBe('HEAD');
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toContain('AWS4-HMAC-SHA256');
      return new Response(null, {
        status: 200,
        headers: {
          'content-length': '4096',
          'content-type': 'image/png',
          etag: '"test-etag"',
        },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new S3ObjectStorageAdapter();
    await expect(
      adapter.statFile('workspaces/1/assets/example.png'),
    ).resolves.toEqual({
      size: 4096,
      contentType: 'image/png',
      etag: '"test-etag"',
    });

    vi.unstubAllGlobals();
  });

  it('does not pretend private object storage is public', () => {
    const adapter = new S3ObjectStorageAdapter();

    expect(adapter.getPublicUrl('private/file.png')).toBeNull();
  });
});
