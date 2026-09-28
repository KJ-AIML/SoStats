import {
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, createHmac } from 'crypto';
import type { ObjectStoragePort } from '../ports/object-storage.port.js';

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key: Buffer | string, value: string) {
  return createHmac('sha256', key).update(value).digest();
}

function awsEncode(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    '%' + char.charCodeAt(0).toString(16).toUpperCase(),
  );
}

function encodeKey(key: string) {
  return key.split('/').map(awsEncode).join('/');
}

function timestamp(date: Date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

@Injectable()
export class S3ObjectStorageAdapter implements ObjectStoragePort {
  private readonly endpoint: URL;
  private readonly bucket: string;
  private readonly accessKey: string;
  private readonly secretKey: string;
  private readonly region: string;

  constructor() {
    const endpoint =
      process.env.S3_ENDPOINT ||
      process.env.MINIO_ENDPOINT ||
      'http://localhost:9000';
    const bucket =
      process.env.S3_BUCKET ||
      process.env.MINIO_BUCKET ||
      'sostats-uploads';
    const accessKey =
      process.env.S3_ACCESS_KEY ||
      process.env.MINIO_ROOT_USER;
    const secretKey =
      process.env.S3_SECRET_KEY ||
      process.env.MINIO_ROOT_PASSWORD;

    if (!accessKey || !secretKey) {
      throw new ServiceUnavailableException(
        'S3_ACCESS_KEY/S3_SECRET_KEY or MinIO credentials must be configured',
      );
    }

    this.endpoint = new URL(endpoint);
    if (this.endpoint.pathname !== '/' && this.endpoint.pathname !== '') {
      throw new ServiceUnavailableException(
        'S3_ENDPOINT/MINIO_ENDPOINT must be an origin without a path prefix',
      );
    }

    this.bucket = bucket;
    this.accessKey = accessKey;
    this.secretKey = secretKey;
    this.region = process.env.S3_REGION || 'us-east-1';
  }

  private signingKey(dateStamp: string) {
    const dateKey = hmac('AWS4' + this.secretKey, dateStamp);
    const regionKey = hmac(dateKey, this.region);
    const serviceKey = hmac(regionKey, 's3');
    return hmac(serviceKey, 'aws4_request');
  }

  private canonicalUri(key: string) {
    return '/' + awsEncode(this.bucket) + '/' + encodeKey(key);
  }

  private presign(method: 'GET' | 'PUT', key: string, expires: number) {
    const now = new Date();
    const amzDate = timestamp(now);
    const dateStamp = amzDate.slice(0, 8);
    const scope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const host = this.endpoint.host;
    const canonicalUri = this.canonicalUri(key);

    const query = new Map<string, string>([
      ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
      ['X-Amz-Credential', `${this.accessKey}/${scope}`],
      ['X-Amz-Date', amzDate],
      ['X-Amz-Expires', String(Math.min(Math.max(expires, 1), 604800))],
      ['X-Amz-SignedHeaders', 'host'],
    ]);

    const canonicalQuery = [...query.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, value]) => `${awsEncode(name)}=${awsEncode(value)}`)
      .join('&');

    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQuery,
      `host:${host}\n`,
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n');

    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      sha256(canonicalRequest),
    ].join('\n');

    const signature = createHmac('sha256', this.signingKey(dateStamp))
      .update(stringToSign)
      .digest('hex');

    return (
      this.endpoint.origin +
      canonicalUri +
      '?' +
      canonicalQuery +
      '&X-Amz-Signature=' +
      signature
    );
  }

  async generateUploadUrl(
    key: string,
    _mimeType: string,
    expiresInSeconds = 3600,
  ) {
    return {
      uploadUrl: this.presign('PUT', key, expiresInSeconds),
      key,
    };
  }

  async generateDownloadUrl(key: string, expiresInSeconds = 3600) {
    return this.presign('GET', key, expiresInSeconds);
  }

  async deleteFile(key: string) {
    const now = new Date();
    const amzDate = timestamp(now);
    const dateStamp = amzDate.slice(0, 8);
    const scope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const host = this.endpoint.host;
    const canonicalUri = this.canonicalUri(key);
    const payloadHash = sha256('');
    const canonicalHeaders =
      `host:${host}\n` +
      `x-amz-content-sha256:${payloadHash}\n` +
      `x-amz-date:${amzDate}\n`;
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

    const canonicalRequest = [
      'DELETE',
      canonicalUri,
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      sha256(canonicalRequest),
    ].join('\n');

    const signature = createHmac('sha256', this.signingKey(dateStamp))
      .update(stringToSign)
      .digest('hex');

    const authorization =
      `AWS4-HMAC-SHA256 Credential=${this.accessKey}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const response = await fetch(this.endpoint.origin + canonicalUri, {
      method: 'DELETE',
      headers: {
        authorization,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': amzDate,
      },
    });

    if (!response.ok && response.status !== 404) {
      throw new Error(
        `Object storage delete failed with HTTP ${response.status}`,
      );
    }
  }

  getPublicUrl(key: string): string | null {
    const publicBase = process.env.S3_PUBLIC_BASE_URL;
    if (!publicBase) return null;

    return publicBase.replace(/\/$/, '') + '/' + encodeKey(key);
  }
}
