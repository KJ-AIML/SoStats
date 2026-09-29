import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../../db/db.module.js';
import * as schema from '../../db/schema.js';
import { OBJECT_STORAGE_PORT } from '../media/ports/object-storage.port.js';
import type { ObjectStoragePort } from '../media/ports/object-storage.port.js';
import {
  fetchPublicKnowledgeUrl,
  KnowledgeFetchError,
} from './safe-knowledge-fetch.js';
import {
  CreateKnowledgeSourceDto,
  SearchKnowledgeDto,
} from './knowledge.dto.js';

type ProcessedKnowledge = {
  text_length: number;
  chunk_count: number;
  embedding_model: string;
  dimensions: number;
  chunks: Array<{
    index: number;
    content: string;
    embedding: number[];
  }>;
};

type QueryEmbedding = {
  embedding_model: string;
  dimensions: number;
  embedding: number[];
};

type KnowledgeChunkInput = {
  index: number;
  content: string;
  embedding: number[];
};

const allowedDocuments = new Map<
  string,
  { extension: string; label: string }
>([
  ['application/pdf', { extension: '.pdf', label: 'PDF' }],
  [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    { extension: '.docx', label: 'DOCX' },
  ],
]);

function aiServiceUrl() {
  return (process.env.AI_SERVICE_URL || 'http://localhost:8000').replace(
    /\/$/,
    '',
  );
}

function maxDocumentBytes() {
  return Number.parseInt(
    process.env.KNOWLEDGE_MAX_UPLOAD_BYTES ||
      String(15 * 1024 * 1024),
    10,
  );
}

function staleProcessingMs() {
  return Number.parseInt(
    process.env.KNOWLEDGE_PROCESSING_STALE_MS ||
      String(20 * 60_000),
    10,
  );
}

function assertEmbedding(value: unknown): number[] {
  if (
    !Array.isArray(value) ||
    value.length !== 1536 ||
    value.some((item) => typeof item !== 'number' || !Number.isFinite(item))
  ) {
    throw new BadGatewayException(
      'AI service returned an invalid knowledge embedding',
    );
  }
  return value as number[];
}

function publicSourceSelection() {
  return {
    id: schema.knowledgeSources.id,
    workspaceId: schema.knowledgeSources.workspaceId,
    brandId: schema.knowledgeSources.brandId,
    sourceType: schema.knowledgeSources.sourceType,
    title: schema.knowledgeSources.title,
    sourceUrl: schema.knowledgeSources.sourceUrl,
    mimeType: schema.knowledgeSources.mimeType,
    fileName: schema.knowledgeSources.fileName,
    fileSize: schema.knowledgeSources.fileSize,
    status: schema.knowledgeSources.status,
    activeVersion: schema.knowledgeSources.activeVersion,
    processingVersion: schema.knowledgeSources.processingVersion,
    embeddingModel: schema.knowledgeSources.embeddingModel,
    chunkCount: schema.knowledgeSources.chunkCount,
    metadata: schema.knowledgeSources.metadata,
    lastError: schema.knowledgeSources.lastError,
    uploadCompletedAt: schema.knowledgeSources.uploadCompletedAt,
    processedAt: schema.knowledgeSources.processedAt,
    createdAt: schema.knowledgeSources.createdAt,
    updatedAt: schema.knowledgeSources.updatedAt,
  };
}

@Injectable()
export class KnowledgeService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    @Inject(OBJECT_STORAGE_PORT)
    private readonly storage: ObjectStoragePort,
  ) {}

  async findAll(workspaceId: number, brandId?: number) {
    return this.db
      .select(publicSourceSelection())
      .from(schema.knowledgeSources)
      .where(
        brandId
          ? and(
              eq(schema.knowledgeSources.workspaceId, workspaceId),
              eq(schema.knowledgeSources.brandId, brandId),
            )
          : eq(schema.knowledgeSources.workspaceId, workspaceId),
      )
      .orderBy(sql`${schema.knowledgeSources.updatedAt} desc`);
  }

  async create(workspaceId: number, dto: CreateKnowledgeSourceDto) {
    await this.requireBrand(workspaceId, dto.brandId);

    const sourceType = dto.sourceType;
    if (!['text', 'url'].includes(sourceType)) {
      throw new BadRequestException('sourceType must be text or url');
    }

    const title = String(dto.title || '').trim().slice(0, 255);
    if (!title) throw new BadRequestException('Knowledge title is required');

    let sourceUrl: string | undefined;
    let sourceText: string | undefined;
    let mediaType = 'text/plain';
    let body: Buffer;

    if (sourceType === 'text') {
      sourceText = String(dto.text || '').trim();
      if (!sourceText) {
        throw new BadRequestException('Text knowledge requires text content');
      }
      body = Buffer.from(sourceText, 'utf8');
      if (body.length > 750 * 1024) {
        throw new BadRequestException(
          'Pasted text exceeds the 750 KiB request limit; use a URL or private document upload for larger content',
        );
      }
    } else {
      sourceUrl = String(dto.url || '').trim();
      if (!sourceUrl) {
        throw new BadRequestException('URL knowledge requires a URL');
      }
      try {
        const fetched = await fetchPublicKnowledgeUrl(sourceUrl);
        sourceUrl = fetched.url;
        mediaType = fetched.contentType;
        body = fetched.body;
      } catch (error) {
        if (error instanceof KnowledgeFetchError) {
          throw new BadRequestException(error.message);
        }
        throw error;
      }
    }

    const contentHash = createHash('sha256').update(body).digest('hex');
    const [source] = await this.db
      .insert(schema.knowledgeSources)
      .values({
        workspaceId,
        brandId: dto.brandId,
        sourceType,
        title,
        sourceUrl,
        sourceText,
        mimeType: mediaType,
        contentHash,
        status: 'processing',
        activeVersion: 0,
        processingVersion: 1,
      })
      .returning();

    try {
      const processed = await this.processSource(
        mediaType,
        sourceType === 'text' ? sourceText : undefined,
        sourceType === 'url' ? body : undefined,
      );

      await this.db.transaction(async (tx) => {
        await tx.insert(schema.knowledgeChunks).values(
          processed.chunks.map((chunk) => ({
            sourceId: source.id,
            workspaceId,
            brandId: dto.brandId,
            versionNumber: 1,
            chunkIndex: chunk.index,
            content: chunk.content,
            embedding: assertEmbedding(chunk.embedding),
            metadata: {
              sourceTitle: title,
              sourceUrl,
              mimeType: mediaType,
              version: 1,
            },
          })),
        );

        await tx
          .update(schema.knowledgeSources)
          .set({
            status: 'ready',
            activeVersion: 1,
            processingVersion: null,
            embeddingModel: processed.embedding_model,
            chunkCount: processed.chunk_count,
            processedAt: new Date(),
            lastError: null,
            updatedAt: new Date(),
          })
          .where(eq(schema.knowledgeSources.id, source.id));
      });

      return this.findOne(workspaceId, source.id);
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : 'Knowledge processing failed';
      await this.db
        .update(schema.knowledgeSources)
        .set({
          status: 'failed',
          lastError: reason.slice(0, 2000),
          processingVersion: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.knowledgeSources.id, source.id));

      if (
        error instanceof BadRequestException ||
        error instanceof BadGatewayException
      ) {
        throw error;
      }
      throw new BadGatewayException('Knowledge processing service unavailable');
    }
  }

  async createDocumentUpload(
    workspaceId: number,
    input: {
      brandId: number;
      title: string;
      fileName: string;
      mimeType: string;
      size: number;
    },
  ) {
    await this.requireBrand(workspaceId, input.brandId);

    const mimeType = String(input.mimeType || '').trim().toLowerCase();
    const document = allowedDocuments.get(mimeType);
    if (!document) {
      throw new BadRequestException(
        'Private knowledge uploads support PDF and DOCX files',
      );
    }

    const size = Number(input.size);
    if (
      !Number.isInteger(size) ||
      size <= 0 ||
      size > maxDocumentBytes()
    ) {
      throw new BadRequestException(
        `Knowledge document must be between 1 byte and ${maxDocumentBytes()} bytes`,
      );
    }

    const title = String(input.title || '').trim().slice(0, 255);
    const fileName = String(input.fileName || '').trim().slice(0, 255);
    if (!title || !fileName) {
      throw new BadRequestException(
        'Knowledge document title and file name are required',
      );
    }

    const key =
      `workspaces/${workspaceId}/knowledge/${randomUUID()}${document.extension}`;
    const { uploadUrl } = await this.storage.generateUploadUrl(
      key,
      mimeType,
      15 * 60,
    );

    const [source] = await this.db
      .insert(schema.knowledgeSources)
      .values({
        workspaceId,
        brandId: input.brandId,
        sourceType: 'file',
        title,
        mimeType,
        fileName,
        fileSize: size,
        storageKey: key,
        status: 'uploading',
        activeVersion: 0,
        processingVersion: 1,
      })
      .returning();

    return {
      uploadUrl,
      source: await this.findOne(workspaceId, source.id),
    };
  }

  async completeDocumentUpload(workspaceId: number, sourceId: number) {
    const source = await this.requireSource(workspaceId, sourceId);
    if (source.sourceType !== 'file' || !source.storageKey) {
      throw new BadRequestException('Knowledge source is not a private file');
    }
    if (source.status === 'uploaded' || source.status === 'processing') {
      return this.findOne(workspaceId, source.id);
    }
    if (source.status !== 'uploading') {
      throw new ConflictException(
        `Knowledge upload cannot complete from status ${source.status}`,
      );
    }

    const stat = await this.storage.statFile(source.storageKey);
    if (stat.size !== source.fileSize) {
      await this.storage.deleteFile(source.storageKey).catch(() => undefined);
      await this.db
        .update(schema.knowledgeSources)
        .set({
          status: 'failed',
          lastError: `Uploaded size ${stat.size} did not match declared size ${source.fileSize}`,
          updatedAt: new Date(),
        })
        .where(eq(schema.knowledgeSources.id, source.id));
      throw new BadRequestException(
        'Uploaded knowledge document size did not match request',
      );
    }

    const actualType = stat.contentType?.split(';')[0]?.trim().toLowerCase();
    if (
      actualType &&
      actualType !== 'application/octet-stream' &&
      actualType !== source.mimeType
    ) {
      await this.storage.deleteFile(source.storageKey).catch(() => undefined);
      await this.db
        .update(schema.knowledgeSources)
        .set({
          status: 'failed',
          lastError: `Uploaded content type ${actualType} did not match ${source.mimeType}`,
          updatedAt: new Date(),
        })
        .where(eq(schema.knowledgeSources.id, source.id));
      throw new BadRequestException(
        'Uploaded knowledge document content type did not match request',
      );
    }

    await this.db
      .update(schema.knowledgeSources)
      .set({
        status: 'uploaded',
        uploadCompletedAt: new Date(),
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.knowledgeSources.id, source.id));

    return this.findOne(workspaceId, source.id);
  }

  async retryDocument(workspaceId: number, sourceId: number) {
    const source = await this.requireSource(workspaceId, sourceId);
    if (
      source.sourceType !== 'file' ||
      !source.storageKey ||
      source.status !== 'failed'
    ) {
      throw new ConflictException(
        'Only failed private document sources can be retried',
      );
    }

    await this.storage.statFile(source.storageKey);
    const processingVersion =
      source.processingVersion ||
      Math.max(1, source.activeVersion + 1);

    await this.db
      .update(schema.knowledgeSources)
      .set({
        status: 'uploaded',
        processingVersion,
        processingToken: null,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.knowledgeSources.id, source.id));

    return this.findOne(workspaceId, source.id);
  }

  async reindexDocument(workspaceId: number, sourceId: number) {
    const source = await this.requireSource(workspaceId, sourceId);
    if (source.sourceType !== 'file' || !source.storageKey) {
      throw new BadRequestException('Only private documents can be re-indexed');
    }
    if (['uploading', 'uploaded', 'processing'].includes(source.status)) {
      throw new ConflictException('Knowledge document is already processing');
    }

    await this.storage.statFile(source.storageKey);
    const nextVersion =
      Math.max(source.activeVersion, source.processingVersion || 0) + 1;

    await this.db
      .update(schema.knowledgeSources)
      .set({
        status: 'uploaded',
        processingVersion: nextVersion,
        processingToken: null,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.knowledgeSources.id, source.id));

    return this.findOne(workspaceId, source.id);
  }

  async findOne(workspaceId: number, sourceId: number) {
    const [source] = await this.db
      .select(publicSourceSelection())
      .from(schema.knowledgeSources)
      .where(
        and(
          eq(schema.knowledgeSources.id, sourceId),
          eq(schema.knowledgeSources.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!source) throw new NotFoundException('Knowledge source not found');
    return source;
  }

  async remove(workspaceId: number, sourceId: number) {
    const source = await this.requireSource(workspaceId, sourceId);
    if (['uploaded', 'processing'].includes(source.status)) {
      throw new ConflictException(
        'Knowledge source cannot be deleted while background processing is active',
      );
    }
    if (source.storageKey) {
      await this.storage.deleteFile(source.storageKey);
    }

    const [deleted] = await this.db
      .delete(schema.knowledgeSources)
      .where(
        and(
          eq(schema.knowledgeSources.id, sourceId),
          eq(schema.knowledgeSources.workspaceId, workspaceId),
        ),
      )
      .returning({ id: schema.knowledgeSources.id });

    if (!deleted) throw new NotFoundException('Knowledge source not found');
    return { success: true, id: deleted.id };
  }

  async listDispatchable(limit = 250) {
    const safeLimit = Math.min(500, Math.max(1, limit));
    const staleBefore = new Date(Date.now() - staleProcessingMs());
    const rows = await this.db.query.knowledgeSources.findMany({
      where: and(
        eq(schema.knowledgeSources.sourceType, 'file'),
        inArray(schema.knowledgeSources.status, ['uploaded', 'processing']),
      ),
      orderBy: (fields, { asc }) => [asc(fields.updatedAt)],
      limit: safeLimit * 4,
    });

    return rows
      .filter(
        (source) =>
          source.status === 'uploaded' ||
          (source.status === 'processing' &&
            source.updatedAt < staleBefore),
      )
      .slice(0, safeLimit)
      .map((source) => ({
        sourceId: source.id,
        revision: String(source.updatedAt.getTime()),
        status: source.status,
      }));
  }

  async claimProcessing(sourceId: number, existingToken?: string) {
    const source = await this.db.query.knowledgeSources.findFirst({
      where: eq(schema.knowledgeSources.id, sourceId),
    });
    if (!source) throw new NotFoundException('Knowledge source not found');
    if (
      source.sourceType !== 'file' ||
      !source.storageKey ||
      !source.fileSize ||
      !source.mimeType
    ) {
      return { status: 'not_ready' as const, sourceId };
    }
    if (source.status === 'ready') {
      return { status: 'already_terminal' as const, sourceId };
    }
    if (source.status === 'failed' || source.status === 'uploading') {
      return { status: 'not_ready' as const, sourceId };
    }

    const version =
      source.processingVersion ||
      Math.max(1, source.activeVersion + 1);
    const stale =
      source.status === 'processing' &&
      source.updatedAt.getTime() < Date.now() - staleProcessingMs();

    let token = existingToken;
    let freshClaim = false;

    if (
      source.status === 'processing' &&
      existingToken &&
      existingToken === source.processingToken
    ) {
      token = existingToken;
    } else if (source.status === 'uploaded' || stale) {
      token = randomUUID();
      const [claimed] = await this.db
        .update(schema.knowledgeSources)
        .set({
          status: 'processing',
          processingVersion: version,
          processingToken: token,
          lastError: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.knowledgeSources.id, source.id),
            eq(schema.knowledgeSources.updatedAt, source.updatedAt),
          ),
        )
        .returning();

      if (!claimed) {
        return { status: 'stale' as const, sourceId };
      }
      freshClaim = true;
    } else {
      return { status: 'already_processing' as const, sourceId };
    }

    if (freshClaim) {
      await this.db
        .delete(schema.knowledgeChunks)
        .where(
          and(
            eq(schema.knowledgeChunks.sourceId, source.id),
            eq(schema.knowledgeChunks.versionNumber, version),
          ),
        );
    }

    return {
      status: 'claimed' as const,
      sourceId,
      processingToken: token!,
      versionNumber: version,
      mimeType: source.mimeType,
      declaredSize: source.fileSize,
      sourceUrl: await this.storage.generateDownloadUrl(
        source.storageKey,
        15 * 60,
      ),
    };
  }

  async appendProcessingChunks(
    sourceId: number,
    processingToken: string,
    versionNumber: number,
    chunks: KnowledgeChunkInput[],
  ) {
    const source = await this.db.query.knowledgeSources.findFirst({
      where: eq(schema.knowledgeSources.id, sourceId),
    });
    if (!source) throw new NotFoundException('Knowledge source not found');
    if (
      source.status !== 'processing' ||
      !source.processingToken ||
      source.processingToken !== processingToken ||
      source.processingVersion !== versionNumber
    ) {
      return { status: 'stale' as const, sourceId };
    }
    if (!chunks.length || chunks.length > 10) {
      throw new BadRequestException(
        'Knowledge chunk batches must contain between 1 and 10 chunks',
      );
    }

    const indexes = new Set<number>();
    const values = chunks.map((chunk) => {
      if (
        !Number.isInteger(chunk.index) ||
        chunk.index < 0 ||
        indexes.has(chunk.index) ||
        typeof chunk.content !== 'string' ||
        !chunk.content.trim() ||
        chunk.content.length > 30_000
      ) {
        throw new BadRequestException('Knowledge chunk payload is invalid');
      }
      indexes.add(chunk.index);
      return {
        sourceId,
        workspaceId: source.workspaceId,
        brandId: source.brandId,
        versionNumber,
        chunkIndex: chunk.index,
        content: chunk.content,
        embedding: assertEmbedding(chunk.embedding),
        metadata: {
          sourceTitle: source.title,
          fileName: source.fileName,
          mimeType: source.mimeType,
          version: versionNumber,
        },
      };
    });

    await this.db
      .insert(schema.knowledgeChunks)
      .values(values)
      .onConflictDoNothing({
        target: [
          schema.knowledgeChunks.sourceId,
          schema.knowledgeChunks.versionNumber,
          schema.knowledgeChunks.chunkIndex,
        ],
      });

    await this.db
      .update(schema.knowledgeSources)
      .set({ updatedAt: new Date() })
      .where(
        and(
          eq(schema.knowledgeSources.id, sourceId),
          eq(schema.knowledgeSources.processingToken, processingToken),
        ),
      );

    return {
      status: 'accepted' as const,
      sourceId,
      accepted: chunks.length,
    };
  }

  async completeProcessing(
    sourceId: number,
    processingToken: string,
    input: {
      versionNumber: number;
      chunkCount: number;
      embeddingModel: string;
      contentHash: string;
    },
  ) {
    const source = await this.db.query.knowledgeSources.findFirst({
      where: eq(schema.knowledgeSources.id, sourceId),
    });
    if (!source) throw new NotFoundException('Knowledge source not found');
    if (
      source.status !== 'processing' ||
      source.processingToken !== processingToken ||
      source.processingVersion !== input.versionNumber
    ) {
      return { status: 'stale' as const, sourceId };
    }
    if (
      !Number.isInteger(input.chunkCount) ||
      input.chunkCount < 1 ||
      input.chunkCount > 100
    ) {
      throw new BadRequestException('Knowledge chunk count is invalid');
    }
    if (!/^[a-f0-9]{64}$/i.test(input.contentHash)) {
      throw new BadRequestException('Knowledge content hash is invalid');
    }

    const [countRow] = await this.db
      .select({
        count: sql<number>`count(*)::int`,
        minIndex: sql<number | null>`min(${schema.knowledgeChunks.chunkIndex})::int`,
        maxIndex: sql<number | null>`max(${schema.knowledgeChunks.chunkIndex})::int`,
      })
      .from(schema.knowledgeChunks)
      .where(
        and(
          eq(schema.knowledgeChunks.sourceId, sourceId),
          eq(
            schema.knowledgeChunks.versionNumber,
            input.versionNumber,
          ),
        ),
      );

    if (
      Number(countRow?.count || 0) !== input.chunkCount ||
      Number(countRow?.minIndex) !== 0 ||
      Number(countRow?.maxIndex) !== input.chunkCount - 1
    ) {
      throw new ConflictException(
        'Knowledge chunk upload is incomplete or has invalid indexes',
      );
    }

    const [ready] = await this.db
      .update(schema.knowledgeSources)
      .set({
        status: 'ready',
        activeVersion: input.versionNumber,
        processingVersion: null,
        processingToken: null,
        embeddingModel: String(input.embeddingModel || '').slice(0, 100),
        chunkCount: input.chunkCount,
        contentHash: input.contentHash.toLowerCase(),
        lastError: null,
        processedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.knowledgeSources.id, sourceId),
          eq(schema.knowledgeSources.processingToken, processingToken),
        ),
      )
      .returning();

    return ready
      ? { status: 'ready' as const, sourceId, version: input.versionNumber }
      : { status: 'stale' as const, sourceId };
  }

  async failProcessing(
    sourceId: number,
    processingToken: string,
    reason: string,
  ) {
    const [failed] = await this.db
      .update(schema.knowledgeSources)
      .set({
        status: 'failed',
        processingToken: null,
        lastError: String(reason || 'Knowledge processing failed').slice(
          0,
          2000,
        ),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.knowledgeSources.id, sourceId),
          eq(schema.knowledgeSources.status, 'processing'),
          eq(schema.knowledgeSources.processingToken, processingToken),
        ),
      )
      .returning();

    return failed
      ? {
          status: 'failed' as const,
          sourceId,
          activeVersion: failed.activeVersion,
        }
      : { status: 'stale' as const, sourceId };
  }

  async search(workspaceId: number, input: SearchKnowledgeDto) {
    const query = String(input.query || '').trim();
    if (!query) throw new BadRequestException('Knowledge query is required');

    await this.requireBrand(workspaceId, input.brandId);

    const readySource = await this.db.query.knowledgeSources.findFirst({
      where: and(
        eq(schema.knowledgeSources.workspaceId, workspaceId),
        eq(schema.knowledgeSources.brandId, input.brandId),
        gt(schema.knowledgeSources.activeVersion, 0),
      ),
      columns: { id: true },
    });
    if (!readySource) return [];

    const embedded = await this.embedQuery(query.slice(0, 4000));
    const vector = assertEmbedding(embedded.embedding);
    const vectorLiteral = JSON.stringify(vector);
    const limit = Math.min(10, Math.max(1, Number(input.limit || 6)));
    const distance = sql<number>`
      ${schema.knowledgeChunks.embedding} <=> ${vectorLiteral}::vector
    `;

    const rows = await this.db
      .select({
        chunkId: schema.knowledgeChunks.id,
        sourceId: schema.knowledgeSources.id,
        sourceTitle: schema.knowledgeSources.title,
        sourceUrl: schema.knowledgeSources.sourceUrl,
        sourceType: schema.knowledgeSources.sourceType,
        versionNumber: schema.knowledgeChunks.versionNumber,
        content: schema.knowledgeChunks.content,
        similarity: sql<number>`1 - (${distance})`,
      })
      .from(schema.knowledgeChunks)
      .innerJoin(
        schema.knowledgeSources,
        eq(schema.knowledgeChunks.sourceId, schema.knowledgeSources.id),
      )
      .where(
        and(
          eq(schema.knowledgeChunks.workspaceId, workspaceId),
          eq(schema.knowledgeChunks.brandId, input.brandId),
          gt(schema.knowledgeSources.activeVersion, 0),
          eq(
            schema.knowledgeChunks.versionNumber,
            schema.knowledgeSources.activeVersion,
          ),
        ),
      )
      .orderBy(distance)
      .limit(limit);

    const minimum = Number.parseFloat(
      process.env.RAG_MIN_SIMILARITY || '0.2',
    );

    return rows
      .map((row) => ({
        ...row,
        similarity: Number(row.similarity),
      }))
      .filter(
        (row) =>
          Number.isFinite(row.similarity) &&
          row.similarity >= minimum,
      );
  }

  private async requireBrand(workspaceId: number, brandId: number) {
    const brand = await this.db.query.brands.findFirst({
      where: and(
        eq(schema.brands.id, brandId),
        eq(schema.brands.workspaceId, workspaceId),
      ),
      columns: { id: true },
    });
    if (!brand) throw new NotFoundException('Brand not found');
    return brand;
  }

  private async requireSource(workspaceId: number, sourceId: number) {
    const source = await this.db.query.knowledgeSources.findFirst({
      where: and(
        eq(schema.knowledgeSources.id, sourceId),
        eq(schema.knowledgeSources.workspaceId, workspaceId),
      ),
    });
    if (!source) throw new NotFoundException('Knowledge source not found');
    return source;
  }

  private async processSource(
    mediaType: string,
    content?: string,
    raw?: Buffer,
  ): Promise<ProcessedKnowledge> {
    const response = await fetch(aiServiceUrl() + '/v1/knowledge/process', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        media_type: mediaType,
        content,
        content_base64: raw?.toString('base64'),
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      const detail = await response.text();
      const message =
        `AI knowledge processing returned HTTP ${response.status}: ${detail.slice(0, 300)}`;
      if (response.status >= 400 && response.status < 500) {
        throw new BadRequestException(message);
      }
      throw new BadGatewayException(message);
    }

    const payload = (await response.json()) as ProcessedKnowledge;
    if (
      payload.dimensions !== 1536 ||
      !Array.isArray(payload.chunks) ||
      payload.chunks.length < 1 ||
      payload.chunks.length > 100 ||
      payload.chunk_count !== payload.chunks.length
    ) {
      throw new BadGatewayException(
        'AI knowledge processing returned an invalid payload',
      );
    }

    const indexes = new Set<number>();
    for (const chunk of payload.chunks) {
      if (
        !Number.isInteger(chunk.index) ||
        chunk.index < 0 ||
        indexes.has(chunk.index) ||
        typeof chunk.content !== 'string' ||
        !chunk.content.trim()
      ) {
        throw new BadGatewayException(
          'AI knowledge processing returned an invalid chunk',
        );
      }
      indexes.add(chunk.index);
      assertEmbedding(chunk.embedding);
    }

    return payload;
  }

  private async embedQuery(query: string): Promise<QueryEmbedding> {
    const response = await fetch(aiServiceUrl() + '/v1/knowledge/embed-query', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new BadGatewayException(
        `AI query embedding returned HTTP ${response.status}`,
      );
    }

    const payload = (await response.json()) as QueryEmbedding;
    if (payload.dimensions !== 1536) {
      throw new BadGatewayException(
        'AI query embedding dimensions do not match the vector store',
      );
    }
    assertEmbedding(payload.embedding);
    return payload;
  }
}
