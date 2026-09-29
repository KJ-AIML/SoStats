import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { and, eq, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../../db/db.module.js';
import * as schema from '../../db/schema.js';
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

function aiServiceUrl() {
  return (process.env.AI_SERVICE_URL || 'http://localhost:8000').replace(
    /\/$/,
    '',
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

@Injectable()
export class KnowledgeService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async findAll(workspaceId: number, brandId?: number) {
    return this.db
      .select({
        id: schema.knowledgeSources.id,
        workspaceId: schema.knowledgeSources.workspaceId,
        brandId: schema.knowledgeSources.brandId,
        sourceType: schema.knowledgeSources.sourceType,
        title: schema.knowledgeSources.title,
        sourceUrl: schema.knowledgeSources.sourceUrl,
        mimeType: schema.knowledgeSources.mimeType,
        status: schema.knowledgeSources.status,
        embeddingModel: schema.knowledgeSources.embeddingModel,
        chunkCount: schema.knowledgeSources.chunkCount,
        metadata: schema.knowledgeSources.metadata,
        lastError: schema.knowledgeSources.lastError,
        processedAt: schema.knowledgeSources.processedAt,
        createdAt: schema.knowledgeSources.createdAt,
        updatedAt: schema.knowledgeSources.updatedAt,
      })
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
    const brand = await this.db.query.brands.findFirst({
      where: and(
        eq(schema.brands.id, dto.brandId),
        eq(schema.brands.workspaceId, workspaceId),
      ),
    });
    if (!brand) throw new NotFoundException('Brand not found');

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
          'Pasted text exceeds the 750 KiB request limit; use a public URL for larger documents',
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
            chunkIndex: chunk.index,
            content: chunk.content,
            embedding: assertEmbedding(chunk.embedding),
            metadata: {
              sourceTitle: title,
              sourceUrl,
              mimeType: mediaType,
            },
          })),
        );

        await tx
          .update(schema.knowledgeSources)
          .set({
            status: 'ready',
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

  async findOne(workspaceId: number, sourceId: number) {
    const [source] = await this.db
      .select({
        id: schema.knowledgeSources.id,
        workspaceId: schema.knowledgeSources.workspaceId,
        brandId: schema.knowledgeSources.brandId,
        sourceType: schema.knowledgeSources.sourceType,
        title: schema.knowledgeSources.title,
        sourceUrl: schema.knowledgeSources.sourceUrl,
        mimeType: schema.knowledgeSources.mimeType,
        status: schema.knowledgeSources.status,
        embeddingModel: schema.knowledgeSources.embeddingModel,
        chunkCount: schema.knowledgeSources.chunkCount,
        metadata: schema.knowledgeSources.metadata,
        lastError: schema.knowledgeSources.lastError,
        processedAt: schema.knowledgeSources.processedAt,
        createdAt: schema.knowledgeSources.createdAt,
        updatedAt: schema.knowledgeSources.updatedAt,
      })
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

  async search(
    workspaceId: number,
    input: SearchKnowledgeDto,
  ) {
    const query = String(input.query || '').trim();
    if (!query) throw new BadRequestException('Knowledge query is required');

    const brand = await this.db.query.brands.findFirst({
      where: and(
        eq(schema.brands.id, input.brandId),
        eq(schema.brands.workspaceId, workspaceId),
      ),
    });
    if (!brand) throw new NotFoundException('Brand not found');

    const readySource = await this.db.query.knowledgeSources.findFirst({
      where: and(
        eq(schema.knowledgeSources.workspaceId, workspaceId),
        eq(schema.knowledgeSources.brandId, input.brandId),
        eq(schema.knowledgeSources.status, 'ready'),
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
          eq(schema.knowledgeSources.status, 'ready'),
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
      throw new BadGatewayException(
        `AI knowledge processing returned HTTP ${response.status}: ${detail.slice(0, 300)}`,
      );
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
