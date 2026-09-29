import {
  ConflictException,
  Injectable,
  Inject,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { and, desc, eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../../db/db.module.js';
import * as schema from '../../db/schema.js';

function fingerprint(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function sanitizeUserAgent(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 512) : null;
}

@Injectable()
export class SessionService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async touchJwtSession(input: {
    userId: number;
    token: string;
    expiresAt?: Date | null;
    userAgent?: string | null;
  }) {
    return this.touch({
      userId: input.userId,
      tokenKey: `jwt:${input.token}`,
      authMethod: 'jwt',
      expiresAt: input.expiresAt || null,
      userAgent: input.userAgent,
    });
  }

  async touchDevelopmentSession(input: {
    userId: number;
    email: string;
    userAgent?: string | null;
  }) {
    return this.touch({
      userId: input.userId,
      tokenKey: `development:${input.email.trim().toLowerCase()}`,
      authMethod: 'development',
      expiresAt: null,
      userAgent: input.userAgent,
    });
  }

  private async touch(input: {
    userId: number;
    tokenKey: string;
    authMethod: 'jwt' | 'development';
    expiresAt: Date | null;
    userAgent?: string | null;
  }) {
    const tokenHash = fingerprint(input.tokenKey);
    const existing = await this.db.query.authSessions.findFirst({
      where: eq(schema.authSessions.tokenHash, tokenHash),
    });

    if (existing) {
      if (existing.userId !== input.userId) {
        throw new UnauthorizedException('Session identity mismatch');
      }
      if (existing.revokedAt) {
        throw new UnauthorizedException('Session has been revoked');
      }
      if (
        existing.expiresAt &&
        existing.expiresAt.getTime() <= Date.now()
      ) {
        throw new UnauthorizedException('Session has expired');
      }

      const shouldRefresh =
        existing.lastSeenAt.getTime() < Date.now() - 5 * 60 * 1000;
      if (shouldRefresh) {
        const [updated] = await this.db
          .update(schema.authSessions)
          .set({
            lastSeenAt: new Date(),
            userAgent: sanitizeUserAgent(input.userAgent) || existing.userAgent,
            updatedAt: new Date(),
          })
          .where(eq(schema.authSessions.id, existing.id))
          .returning();
        return updated;
      }
      return existing;
    }

    await this.db
      .insert(schema.authSessions)
      .values({
        userId: input.userId,
        tokenHash,
        authMethod: input.authMethod,
        userAgent: sanitizeUserAgent(input.userAgent),
        expiresAt: input.expiresAt,
      })
      .onConflictDoNothing({ target: schema.authSessions.tokenHash });

    const created = await this.db.query.authSessions.findFirst({
      where: eq(schema.authSessions.tokenHash, tokenHash),
    });
    if (!created || created.userId !== input.userId) {
      throw new UnauthorizedException('Unable to establish session');
    }
    if (created.revokedAt) {
      throw new UnauthorizedException('Session has been revoked');
    }
    return created;
  }

  async listForUser(userId: number, currentSessionId?: number | null) {
    const sessions = await this.db.query.authSessions.findMany({
      where: eq(schema.authSessions.userId, userId),
      orderBy: [desc(schema.authSessions.lastSeenAt)],
      limit: 50,
    });

    return sessions.map((session) => ({
      id: session.id,
      authMethod: session.authMethod,
      userAgent: session.userAgent,
      status: session.revokedAt
        ? 'revoked'
        : session.expiresAt && session.expiresAt.getTime() <= Date.now()
          ? 'expired'
          : 'active',
      isCurrent: session.id === currentSessionId,
      expiresAt: session.expiresAt,
      lastSeenAt: session.lastSeenAt,
      revokedAt: session.revokedAt,
      createdAt: session.createdAt,
    }));
  }

  async revokeOtherSession(
    userId: number,
    sessionId: number,
    currentSessionId?: number | null,
  ) {
    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      throw new NotFoundException('Session not found');
    }
    if (currentSessionId && sessionId === currentSessionId) {
      throw new ConflictException(
        'The current session cannot be revoked from this Settings surface',
      );
    }

    const session = await this.db.query.authSessions.findFirst({
      where: and(
        eq(schema.authSessions.id, sessionId),
        eq(schema.authSessions.userId, userId),
      ),
    });
    if (!session) throw new NotFoundException('Session not found');
    if (session.revokedAt) {
      return {
        id: session.id,
        status: 'revoked',
        revokedAt: session.revokedAt,
      };
    }

    const now = new Date();
    const [updated] = await this.db
      .update(schema.authSessions)
      .set({ revokedAt: now, updatedAt: now })
      .where(
        and(
          eq(schema.authSessions.id, sessionId),
          eq(schema.authSessions.userId, userId),
        ),
      )
      .returning();

    return {
      id: updated.id,
      status: 'revoked',
      revokedAt: updated.revokedAt,
    };
  }
}
