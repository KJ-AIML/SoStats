import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { eq, or } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../../db/db.module.js';
import * as schema from '../../db/schema.js';
import type { AuthenticatedUser, JwtClaims } from './auth.types.js';

@Injectable()
export class AuthService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  private decodePart<T>(value: string): T {
    try {
      return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T;
    } catch {
      throw new UnauthorizedException('Malformed bearer token');
    }
  }

  verifyJwt(token: string): JwtClaims {
    const secret = process.env.AUTH_JWT_SECRET;
    if (!secret) {
      throw new ServiceUnavailableException(
        'Authentication is not configured. Set AUTH_JWT_SECRET.',
      );
    }

    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new UnauthorizedException('Malformed bearer token');
    }

    const [headerPart, payloadPart, signaturePart] = parts;
    const header = this.decodePart<{ alg?: string }>(headerPart);
    if (header.alg !== 'HS256') {
      throw new UnauthorizedException('Unsupported token algorithm');
    }

    const expected = createHmac('sha256', secret)
      .update(headerPart + '.' + payloadPart)
      .digest();
    const actual = Buffer.from(signaturePart, 'base64url');

    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new UnauthorizedException('Invalid bearer token signature');
    }

    const claims = this.decodePart<JwtClaims>(payloadPart);
    if (!claims.sub || !claims.email) {
      throw new UnauthorizedException('Token must include sub and email claims');
    }

    const now = Math.floor(Date.now() / 1000);
    if (claims.exp && claims.exp <= now) {
      throw new UnauthorizedException('Bearer token has expired');
    }
    if (claims.nbf && claims.nbf > now) {
      throw new UnauthorizedException('Bearer token is not active yet');
    }

    const issuer = process.env.AUTH_JWT_ISSUER;
    if (issuer && claims.iss !== issuer) {
      throw new UnauthorizedException('Invalid bearer token issuer');
    }

    const audience = process.env.AUTH_JWT_AUDIENCE;
    if (audience) {
      const values = Array.isArray(claims.aud)
        ? claims.aud
        : claims.aud
          ? [claims.aud]
          : [];
      if (!values.includes(audience)) {
        throw new UnauthorizedException('Invalid bearer token audience');
      }
    }

    return claims;
  }

  async resolveUser(claims: JwtClaims): Promise<AuthenticatedUser> {
    const email = claims.email!;
    const existing = await this.db.query.users.findFirst({
      where: or(
        eq(schema.users.authSubject, claims.sub),
        eq(schema.users.email, email),
      ),
    });

    if (existing) {
      if (existing.authSubject && existing.authSubject !== claims.sub) {
        throw new UnauthorizedException('Identity does not match existing user');
      }

      const user = existing.authSubject
        ? existing
        : (
            await this.db
              .update(schema.users)
              .set({
                authSubject: claims.sub,
                name: claims.name ?? existing.name,
                updatedAt: new Date(),
              })
              .where(eq(schema.users.id, existing.id))
              .returning()
          )[0];

      return {
        id: user.id,
        subject: user.authSubject ?? claims.sub,
        email: user.email,
        name: user.name,
      };
    }

    const [created] = await this.db
      .insert(schema.users)
      .values({
        authSubject: claims.sub,
        email,
        name: claims.name,
      })
      .returning();

    return {
      id: created.id,
      subject: created.authSubject ?? claims.sub,
      email: created.email,
      name: created.name,
    };
  }

  resolveDevelopmentClaims(email: string, name?: string): JwtClaims {
    if (process.env.NODE_ENV === 'production') {
      throw new UnauthorizedException('Development authentication is disabled');
    }
    return { sub: 'dev:' + email, email, name: name || 'Local Developer' };
  }
}
