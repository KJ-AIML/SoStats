import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OAuthStateService } from './oauth-state.service.js';

describe('OAuthStateService', () => {
  const originalOauth = process.env.OAUTH_STATE_SECRET;
  const originalEncryption = process.env.ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.OAUTH_STATE_SECRET =
      'test-oauth-state-secret-with-more-than-thirty-two-bytes';
    delete process.env.ENCRYPTION_KEY;
  });

  afterEach(() => {
    const restore = (name: string, value: string | undefined) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };
    restore('OAUTH_STATE_SECRET', originalOauth);
    restore('ENCRYPTION_KEY', originalEncryption);
  });

  it('round-trips an encrypted PKCE state payload', () => {
    const service = new OAuthStateService();
    const sealed = service.seal({
      workspaceId: 12,
      brandId: 44,
      provider: 'x',
      redirectUri: 'https://api.example.com/v1/channels/oauth/callback',
      returnTo: '/acme/channels',
      codeVerifier: 'verifier-secret',
    });

    expect(sealed).not.toContain('verifier-secret');
    expect(sealed).not.toContain('/acme/channels');

    const opened = service.open(sealed);
    expect(opened.workspaceId).toBe(12);
    expect(opened.brandId).toBe(44);
    expect(opened.provider).toBe('x');
    expect(opened.codeVerifier).toBe('verifier-secret');
    expect(opened.returnTo).toBe('/acme/channels');
    expect(opened.exp).toBeGreaterThan(Date.now());
  });

  it('rejects tampered and expired state', () => {
    const service = new OAuthStateService();
    const sealed = service.seal({
      workspaceId: 1,
      brandId: 2,
      provider: 'linkedin',
      redirectUri: 'https://api.example.com/v1/channels/oauth/callback',
      returnTo: '/demo/channels',
    });

    const [version, iv, tag, ciphertext] = sealed.split('.');
    const tamperedBytes = Buffer.from(ciphertext, 'base64url');
    tamperedBytes[0] ^= 0x01;
    const tampered = [
      version,
      iv,
      tag,
      tamperedBytes.toString('base64url'),
    ].join('.');
    expect(() => service.open(tampered)).toThrow(/invalid or expired/i);

    const expired = service.seal(
      {
        workspaceId: 1,
        brandId: 2,
        provider: 'x',
        redirectUri: 'https://api.example.com/v1/channels/oauth/callback',
        returnTo: '/demo/channels',
        codeVerifier: 'secret',
      },
      -1,
    );
    expect(() => service.open(expired)).toThrow(/invalid or expired/i);
  });

  it('accepts only same-origin relative return paths', () => {
    const service = new OAuthStateService();
    expect(service.validReturnTo('/demo/channels')).toBe(true);
    expect(service.validReturnTo('//evil.example/steal')).toBe(false);
    expect(service.validReturnTo('https://evil.example')).toBe(false);
  });
});
