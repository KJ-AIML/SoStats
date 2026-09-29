import {
  BadRequestException,
  ConflictException,
  Injectable,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { and, eq, inArray, lt } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../../db/db.module.js';
import * as schema from '../../db/schema.js';
import { OBJECT_STORAGE_PORT } from './ports/object-storage.port.js';
import type { ObjectStoragePort } from './ports/object-storage.port.js';

const allowedMedia = new Map<
  string,
  { fileType: 'image' | 'video'; extension: string }
>([
  ['image/jpeg', { fileType: 'image', extension: '.jpg' }],
  ['image/png', { fileType: 'image', extension: '.png' }],
  ['image/webp', { fileType: 'image', extension: '.webp' }],
  ['image/gif', { fileType: 'image', extension: '.gif' }],
  ['video/mp4', { fileType: 'video', extension: '.mp4' }],
]);

function maxUploadBytes() {
  return Number.parseInt(
    process.env.MEDIA_MAX_UPLOAD_BYTES || String(100 * 1024 * 1024),
    10,
  );
}

function staleProcessingMs() {
  return Number.parseInt(
    process.env.MEDIA_PROCESSING_STALE_MS || String(15 * 60_000),
    10,
  );
}

@Injectable()
export class MediaService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    @Inject(OBJECT_STORAGE_PORT)
    private readonly storagePort: ObjectStoragePort,
  ) {}

  async listAssets(workspaceId: number, brandId?: number) {
    const conditions = [eq(schema.assets.workspaceId, workspaceId)];
    if (brandId) {
      conditions.push(eq(schema.assets.brandId, brandId));
    }

    const records = await this.db.query.assets.findMany({
      where: and(...conditions),
      with: { tags: true },
      orderBy: (fields, { desc }) => [desc(fields.createdAt)],
    });

    return Promise.all(
      records.map(async (asset) => ({
        ...asset,
        viewUrl:
          asset.status === 'ready'
            ? asset.publicUrl ||
              (await this.storagePort.generateDownloadUrl(
                asset.storageKey,
                15 * 60,
              ))
            : null,
      })),
    );
  }

  async getUploadUrl(
    workspaceId: number,
    fileName: string,
    fileType: string,
    mimeType: string,
    size: number,
    brandId?: number,
  ) {
    const media = allowedMedia.get(mimeType.toLowerCase());
    if (!media) {
      throw new BadRequestException(
        'Supported uploads are JPEG, PNG, WebP, GIF, and MP4',
      );
    }
    if (fileType && fileType !== media.fileType) {
      throw new BadRequestException('fileType does not match mimeType');
    }
    if (!Number.isInteger(size) || size <= 0 || size > maxUploadBytes()) {
      throw new BadRequestException(
        `Upload must be between 1 byte and ${maxUploadBytes()} bytes`,
      );
    }

    if (brandId) {
      const brand = await this.db.query.brands.findFirst({
        where: and(
          eq(schema.brands.id, brandId),
          eq(schema.brands.workspaceId, workspaceId),
        ),
      });
      if (!brand) throw new NotFoundException('Brand not found');
    }

    const key =
      `workspaces/${workspaceId}/assets/${randomUUID()}${media.extension}`;
    const { uploadUrl } = await this.storagePort.generateUploadUrl(
      key,
      mimeType,
      15 * 60,
    );

    const [asset] = await this.db
      .insert(schema.assets)
      .values({
        workspaceId,
        brandId,
        fileName: fileName.slice(0, 255),
        fileType: media.fileType,
        mimeType: mimeType.toLowerCase(),
        size,
        storageKey: key,
        publicUrl: this.storagePort.getPublicUrl(key),
        status: 'uploading',
      })
      .returning();

    return { uploadUrl, asset };
  }

  async completeUpload(workspaceId: number, assetId: number) {
    const asset = await this.requireAsset(workspaceId, assetId);
    if (asset.status === 'ready' || asset.status === 'uploaded') return asset;
    if (asset.status !== 'uploading') {
      throw new ConflictException(
        `Asset cannot complete upload from status ${asset.status}`,
      );
    }

    let stat;
    try {
      stat = await this.storagePort.statFile(asset.storageKey);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error
          ? error.message
          : 'Uploaded object could not be verified',
      );
    }

    if (stat.size !== asset.size) {
      await this.storagePort.deleteFile(asset.storageKey).catch(() => undefined);
      await this.db
        .update(schema.assets)
        .set({
          status: 'failed',
          processingError: `Uploaded size ${stat.size} did not match declared size ${asset.size}`,
          updatedAt: new Date(),
        })
        .where(eq(schema.assets.id, asset.id));
      throw new BadRequestException('Uploaded object size did not match request');
    }

    const contentType = stat.contentType?.split(';')[0]?.trim().toLowerCase();
    if (
      contentType &&
      contentType !== 'application/octet-stream' &&
      contentType !== asset.mimeType
    ) {
      await this.storagePort.deleteFile(asset.storageKey).catch(() => undefined);
      await this.db
        .update(schema.assets)
        .set({
          status: 'failed',
          processingError: `Uploaded content type ${contentType} did not match ${asset.mimeType}`,
          updatedAt: new Date(),
        })
        .where(eq(schema.assets.id, asset.id));
      throw new BadRequestException(
        'Uploaded object content type did not match request',
      );
    }

    const [uploaded] = await this.db
      .update(schema.assets)
      .set({
        status: 'uploaded',
        uploadCompletedAt: new Date(),
        processingError: null,
        processingToken: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.assets.id, asset.id))
      .returning();

    return uploaded;
  }

  async retryProcessing(workspaceId: number, assetId: number) {
    const asset = await this.requireAsset(workspaceId, assetId);
    if (asset.status !== 'failed') {
      throw new ConflictException('Only failed assets can be retried');
    }

    await this.storagePort.statFile(asset.storageKey);

    const [updated] = await this.db
      .update(schema.assets)
      .set({
        status: 'uploaded',
        processingToken: null,
        processingError: null,
        processedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.assets.id, asset.id))
      .returning();

    return updated;
  }

  async listDispatchable(limit = 250) {
    const safeLimit = Math.min(500, Math.max(1, limit));
    const staleBefore = new Date(Date.now() - staleProcessingMs());

    const rows = await this.db.query.assets.findMany({
      where: inArray(schema.assets.status, ['uploaded', 'processing']),
      orderBy: (fields, { asc }) => [asc(fields.updatedAt)],
      limit: safeLimit * 4,
    });

    return rows
      .filter(
        (asset) =>
          asset.status === 'uploaded' ||
          (asset.status === 'processing' && asset.updatedAt < staleBefore),
      )
      .slice(0, safeLimit)
      .map((asset) => ({
        assetId: asset.id,
        revision: String(asset.updatedAt.getTime()),
        status: asset.status,
      }));
  }

  async claimProcessing(assetId: number, existingToken?: string) {
    const asset = await this.db.query.assets.findFirst({
      where: eq(schema.assets.id, assetId),
    });
    if (!asset) throw new NotFoundException('Asset not found');

    if (asset.status === 'ready') {
      return { status: 'already_terminal' as const, assetId };
    }
    if (asset.status === 'failed' || asset.status === 'uploading') {
      return { status: 'not_ready' as const, assetId };
    }

    let token = existingToken;
    const stale =
      asset.status === 'processing' &&
      asset.updatedAt.getTime() < Date.now() - staleProcessingMs();

    if (
      asset.status === 'processing' &&
      existingToken &&
      existingToken === asset.processingToken
    ) {
      token = existingToken;
    } else if (asset.status === 'uploaded' || stale) {
      token = randomUUID();
      const [claimed] = await this.db
        .update(schema.assets)
        .set({
          status: 'processing',
          processingToken: token,
          processingError: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.assets.id, asset.id),
            eq(schema.assets.updatedAt, asset.updatedAt),
          ),
        )
        .returning();

      if (!claimed) {
        return { status: 'stale' as const, assetId };
      }
    } else {
      return { status: 'already_processing' as const, assetId };
    }

    return {
      status: 'claimed' as const,
      assetId,
      processingToken: token!,
      fileType: asset.fileType,
      mimeType: asset.mimeType,
      declaredSize: asset.size,
      sourceUrl: await this.storagePort.generateDownloadUrl(
        asset.storageKey,
        15 * 60,
      ),
    };
  }

  async completeProcessing(
    assetId: number,
    processingToken: string,
    metadata: { width?: number; height?: number; durationMs?: number },
  ) {
    const asset = await this.db.query.assets.findFirst({
      where: eq(schema.assets.id, assetId),
    });
    if (!asset) throw new NotFoundException('Asset not found');
    if (
      asset.status !== 'processing' ||
      !asset.processingToken ||
      asset.processingToken !== processingToken
    ) {
      return { status: 'stale' as const, assetId };
    }

    const width =
      typeof metadata.width === 'number' && metadata.width > 0
        ? Math.round(metadata.width)
        : null;
    const height =
      typeof metadata.height === 'number' && metadata.height > 0
        ? Math.round(metadata.height)
        : null;
    const durationMs =
      typeof metadata.durationMs === 'number' && metadata.durationMs >= 0
        ? Math.round(metadata.durationMs)
        : null;

    if (asset.fileType === 'image' && (!width || !height)) {
      throw new BadRequestException('Image metadata requires width and height');
    }
    if (
      asset.fileType === 'video' &&
      (!width || !height || durationMs === null)
    ) {
      throw new BadRequestException(
        'Video metadata requires width, height, and duration',
      );
    }

    const [ready] = await this.db
      .update(schema.assets)
      .set({
        status: 'ready',
        width,
        height,
        durationMs,
        processingToken: null,
        processingError: null,
        processedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.assets.id, assetId),
          eq(schema.assets.processingToken, processingToken),
        ),
      )
      .returning();

    return ready
      ? { status: 'ready' as const, asset: ready }
      : { status: 'stale' as const, assetId };
  }

  async failProcessing(
    assetId: number,
    processingToken: string,
    reason: string,
  ) {
    const [failed] = await this.db
      .update(schema.assets)
      .set({
        status: 'failed',
        processingToken: null,
        processingError: reason.slice(0, 2000),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.assets.id, assetId),
          eq(schema.assets.status, 'processing'),
          eq(schema.assets.processingToken, processingToken),
        ),
      )
      .returning();

    return failed
      ? { status: 'failed' as const, assetId }
      : { status: 'stale' as const, assetId };
  }

  async deleteAsset(workspaceId: number, assetId: number) {
    const asset = await this.requireAsset(workspaceId, assetId);

    await this.storagePort.deleteFile(asset.storageKey);

    await this.db
      .delete(schema.assets)
      .where(
        and(
          eq(schema.assets.id, assetId),
          eq(schema.assets.workspaceId, workspaceId),
        ),
      );

    return { success: true };
  }

  private async requireAsset(workspaceId: number, assetId: number) {
    const asset = await this.db.query.assets.findFirst({
      where: and(
        eq(schema.assets.id, assetId),
        eq(schema.assets.workspaceId, workspaceId),
      ),
    });
    if (!asset) throw new NotFoundException('Asset not found');
    return asset;
  }
}
