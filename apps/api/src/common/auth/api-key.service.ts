import {
  BadRequestException,
  ConflictException,
  Injectable,
  Inject,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../../db/db.module.js';
import * as schema from '../../db/schema.js';
import { WorkspaceAccessService } from '../workspace/workspace-access.service.js';
import type { AuthenticatedUser } from './auth.types.js';

export const API_KEY_SCOPES = [
  'workspace:read',
  'workspace:write',
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

function apiKeyName(value: unknown) {
  if (typeof value !== 'string') {
    throw new BadRequestException('API key name is required');
  }
  const name = value.trim();
  if (!name || name.length > 120) {
    throw new BadRequestException(
      'API key name must be between 1 and 120 characters',
    );
  }
  return name;
}

export function validateApiKeyScopes(value: unknown): ApiKeyScope[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new BadRequestException('At least one API key scope is required');
  }

  const scopes = [...new Set(value)]
    .filter((scope): scope is string => typeof scope === 'string')
    .map((scope) => scope.trim());

  if (
    scopes.length === 0 ||
    scopes.some(
      (scope) => !API_KEY_SCOPES.includes(scope as ApiKeyScope),
    )
  ) {
    throw new BadRequestException(
      `API key scopes must be one or more of: ${API_KEY_SCOPES.join(', ')}`,
    );
  }

  return scopes as ApiKeyScope[];
}

function expiryDays(value: unknown) {
  if (value === undefined || value === null || value === '') return 90;
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : Number.NaN;

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 365) {
    throw new BadRequestException(
      'API key expiry must be between 1 and 365 days',
    );
  }
  return parsed;
}

function hashSecret(secret: string) {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

export function parseApiKeyToken(token: string) {
  const match = /^sostats_sk_([A-Za-z0-9_-]{8,24})_([A-Za-z0-9_-]{40,80})$/.exec(
    token,
  );
  if (!match) return null;
  return {
    publicId: match[1]!,
    secret: match[2]!,
  };
}

function newCredential() {
  const publicId = randomBytes(9).toString('base64url');
  const secret = randomBytes(32).toString('base64url');
  return {
    publicId,
    secret,
    token: `sostats_sk_${publicId}_${secret}`,
    secretHash: hashSecret(secret),
  };
}

@Injectable()
export class ApiKeyService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly access: WorkspaceAccessService,
  ) {}

  private status(key: typeof schema.workspaceApiKeys.$inferSelect) {
    if (key.revokedAt) return 'revoked';
    if (key.expiresAt.getTime() <= Date.now()) return 'expired';
    return 'active';
  }

  private serialize(
    key: typeof schema.workspaceApiKeys.$inferSelect & {
      createdBy?: typeof schema.users.$inferSelect | null;
    },
  ) {
    return {
      id: key.id,
      workspaceId: key.workspaceId,
      name: key.name,
      publicId: key.publicId,
      displayPrefix: `sostats_sk_${key.publicId}_••••`,
      scopes: key.scopes,
      status: this.status(key),
      expiresAt: key.expiresAt,
      lastUsedAt: key.lastUsedAt,
      rotatedAt: key.rotatedAt,
      revokedAt: key.revokedAt,
      createdAt: key.createdAt,
      updatedAt: key.updatedAt,
      createdBy: key.createdBy
        ? {
            id: key.createdBy.id,
            name: key.createdBy.name,
            email: key.createdBy.email,
          }
        : null,
    };
  }

  async listForWorkspace(workspaceId: number, actorUserId: number) {
    await this.access.requireOwner(actorUserId, workspaceId);

    const keys = await this.db.query.workspaceApiKeys.findMany({
      where: eq(schema.workspaceApiKeys.workspaceId, workspaceId),
      with: { createdBy: true },
      orderBy: (fields, { desc }) => [desc(fields.createdAt)],
      limit: 100,
    });

    return keys.map((key) => this.serialize(key));
  }

  async create(
    workspaceId: number,
    actorUserId: number,
    input: {
      name?: unknown;
      scopes?: unknown;
      expiresInDays?: unknown;
    },
  ) {
    await this.access.requireOwner(actorUserId, workspaceId);

    const name = apiKeyName(input.name);
    const scopes = validateApiKeyScopes(input.scopes);
    const days = expiryDays(input.expiresInDays);
    const credential = newCredential();

    const [created] = await this.db
      .insert(schema.workspaceApiKeys)
      .values({
        workspaceId,
        createdByUserId: actorUserId,
        publicId: credential.publicId,
        name,
        secretHash: credential.secretHash,
        scopes,
        expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
      })
      .returning();

    return {
      apiKey: this.serialize(created),
      token: credential.token,
    };
  }

  async rotate(
    workspaceId: number,
    actorUserId: number,
    keyId: number,
    input: { expiresInDays?: unknown } = {},
  ) {
    await this.access.requireOwner(actorUserId, workspaceId);

    const current = await this.db.query.workspaceApiKeys.findFirst({
      where: and(
        eq(schema.workspaceApiKeys.id, keyId),
        eq(schema.workspaceApiKeys.workspaceId, workspaceId),
      ),
    });
    if (!current) throw new NotFoundException('API key not found');
    if (current.revokedAt) {
      throw new ConflictException('Revoked API keys cannot be rotated');
    }

    const days = expiryDays(input.expiresInDays);
    const credential = newCredential();
    const now = new Date();

    const [updated] = await this.db
      .update(schema.workspaceApiKeys)
      .set({
        publicId: credential.publicId,
        secretHash: credential.secretHash,
        expiresAt: new Date(now.getTime() + days * 24 * 60 * 60 * 1000),
        rotatedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.workspaceApiKeys.id, keyId),
          eq(schema.workspaceApiKeys.workspaceId, workspaceId),
        ),
      )
      .returning();

    return {
      apiKey: this.serialize(updated),
      token: credential.token,
    };
  }

  async revoke(
    workspaceId: number,
    actorUserId: number,
    keyId: number,
  ) {
    await this.access.requireOwner(actorUserId, workspaceId);

    const current = await this.db.query.workspaceApiKeys.findFirst({
      where: and(
        eq(schema.workspaceApiKeys.id, keyId),
        eq(schema.workspaceApiKeys.workspaceId, workspaceId),
      ),
    });
    if (!current) throw new NotFoundException('API key not found');
    if (current.revokedAt) return this.serialize(current);

    const now = new Date();
    const [updated] = await this.db
      .update(schema.workspaceApiKeys)
      .set({
        revokedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.workspaceApiKeys.id, keyId),
          eq(schema.workspaceApiKeys.workspaceId, workspaceId),
        ),
      )
      .returning();

    return this.serialize(updated);
  }

  async authenticate(token: string): Promise<AuthenticatedUser> {
    const parsed = parseApiKeyToken(token);
    if (!parsed) {
      throw new UnauthorizedException('Invalid API key');
    }

    const key = await this.db.query.workspaceApiKeys.findFirst({
      where: eq(schema.workspaceApiKeys.publicId, parsed.publicId),
      with: { createdBy: true },
    });

    if (
      !key ||
      !key.createdBy ||
      key.revokedAt ||
      key.expiresAt.getTime() <= Date.now()
    ) {
      throw new UnauthorizedException('Invalid or expired API key');
    }

    const actual = Buffer.from(hashSecret(parsed.secret), 'hex');
    const expected = Buffer.from(key.secretHash, 'hex');
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      throw new UnauthorizedException('Invalid API key');
    }

    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    if (!key.lastUsedAt || key.lastUsedAt.getTime() < fiveMinutesAgo) {
      await this.db
        .update(schema.workspaceApiKeys)
        .set({ lastUsedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.workspaceApiKeys.id, key.id));
    }

    return {
      id: key.createdBy.id,
      subject: key.createdBy.authSubject || `api-key-user:${key.createdBy.id}`,
      email: key.createdBy.email,
      name: key.createdBy.name,
      authMethod: 'api_key',
      apiKey: {
        id: key.id,
        workspaceId: key.workspaceId,
        scopes: key.scopes as ApiKeyScope[],
      },
    };
  }
}
