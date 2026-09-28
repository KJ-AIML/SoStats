import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decrypt, encrypt } from './encryption.util.js';

describe('encryption.util', () => {
  const originalKey = process.env.ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY =
      'test-encryption-key-that-is-long-enough-for-stage-zero';
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalKey;
  });

  it('round-trips authenticated ciphertext', () => {
    const ciphertext = encrypt('secret-token-value');

    expect(ciphertext).not.toContain('secret-token-value');
    expect(decrypt(ciphertext)).toBe('secret-token-value');
  });

  it('rejects tampered ciphertext', () => {
    const ciphertext = encrypt('secret-token-value');
    const parts = ciphertext.split('.');
    parts[3] = parts[3].slice(0, -1) + (parts[3].endsWith('A') ? 'B' : 'A');

    expect(() => decrypt(parts.join('.'))).toThrow();
  });
});
