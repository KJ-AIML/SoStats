import { createHmac } from 'crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from './auth.service.js';
import type { JwtClaims } from './auth.types.js';

function encode(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function sign(claims: JwtClaims, secret: string) {
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode(claims);
  const signature = createHmac('sha256', secret)
    .update(header + '.' + payload)
    .digest('base64url');

  return [header, payload, signature].join('.');
}

describe('AuthService.verifyJwt', () => {
  const originalSecret = process.env.AUTH_JWT_SECRET;
  const originalVerified = process.env.AUTH_REQUIRE_VERIFIED_EMAIL;
  const secret = '0123456789abcdef0123456789abcdef';
  const service = new AuthService({} as never);

  beforeEach(() => {
    process.env.AUTH_JWT_SECRET = secret;
    process.env.AUTH_REQUIRE_VERIFIED_EMAIL = 'true';
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.AUTH_JWT_SECRET;
    else process.env.AUTH_JWT_SECRET = originalSecret;

    if (originalVerified === undefined) {
      delete process.env.AUTH_REQUIRE_VERIFIED_EMAIL;
    } else {
      process.env.AUTH_REQUIRE_VERIFIED_EMAIL = originalVerified;
    }
  });

  it('accepts a valid verified-email token', () => {
    const token = sign(
      {
        sub: 'user-123',
        email: 'person@example.com',
        email_verified: true,
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      secret,
    );

    expect(service.verifyJwt(token).sub).toBe('user-123');
  });

  it('rejects an invalid signature', () => {
    const token = sign(
      {
        sub: 'user-123',
        email: 'person@example.com',
        email_verified: true,
      },
      'ffffffffffffffffffffffffffffffff',
    );

    expect(() => service.verifyJwt(token)).toThrow(
      'Invalid bearer token signature',
    );
  });

  it('rejects unverified email by default', () => {
    const token = sign(
      {
        sub: 'user-123',
        email: 'person@example.com',
        email_verified: false,
      },
      secret,
    );

    expect(() => service.verifyJwt(token)).toThrow(
      'A verified email claim is required',
    );
  });
});
