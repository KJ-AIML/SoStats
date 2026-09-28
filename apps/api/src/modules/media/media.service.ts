import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { DRIZZLE } from '../../db/db.module.js';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { OBJECT_STORAGE_PORT } from './ports/object-storage.port.js';
import type { ObjectStoragePort } from './ports/object-storage.port.js';
import { randomUUID } from 'crypto';

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
      with: {
        tags: true,
      },
      orderBy: (fields, { desc }) => [desc(fields.createdAt)],
    });

    return records;
  }

  async getUploadUrl(
    workspaceId: number,
    fileName: string,
    fileType: string,
    mimeType: string,
    size: number,
    brandId?: number,
  ) {
    const extension = fileName.split('.').pop() || '';
    const key = `workspaces/${workspaceId}/assets/${randomUUID()}.${extension}`;

    const { uploadUrl } = await this.storagePort.generateUploadUrl(
      key,
      mimeType,
    );
    const publicUrl = this.storagePort.getPublicUrl(key);

    const [asset] = await this.db
      .insert(schema.assets)
      .values({
        workspaceId,
        brandId,
        fileName,
        fileType,
        mimeType,
        size,
        storageKey: key,
        publicUrl,
      })
      .returning();

    return { uploadUrl, asset };
  }

  async deleteAsset(workspaceId: number, assetId: number) {
    const asset = await this.db.query.assets.findFirst({
      where: and(
        eq(schema.assets.id, assetId),
        eq(schema.assets.workspaceId, workspaceId),
      ),
    });

    if (!asset) {
      throw new NotFoundException('Asset not found');
    }

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
}
