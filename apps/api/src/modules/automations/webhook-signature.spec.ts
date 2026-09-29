import { describe, expect, it } from 'vitest';
import {
  signWebhookPayload,
  verifyWebhookSignature,
} from './webhook-signature.js';

describe('webhook signature', () => {
  it('verifies an HMAC over timestamp + exact raw body', () => {
    const secret = 'test-secret-with-enough-random-material';
    const body = Buffer.from('{"id":42,"title":"Launch"}');
    const timestamp = '1790650800';
    const signature = signWebhookPayload(secret, timestamp, body);

    expect(
      verifyWebhookSignature({
        secret,
        timestamp,
        signature: `sha256=${signature}`,
        rawBody: body,
        nowMs: 1790650800 * 1000,
      }),
    ).toEqual({
      ok: true,
      timestamp: 1790650800 * 1000,
    });
  });

  it('rejects replayed timestamps and tampered bodies', () => {
    const secret = 'test-secret';
    const original = Buffer.from('{"id":42}');
    const timestamp = '1790650800';
    const signature = signWebhookPayload(secret, timestamp, original);

    expect(
      verifyWebhookSignature({
        secret,
        timestamp,
        signature,
        rawBody: original,
        nowMs: 1790650800 * 1000 + 301_000,
      }).ok,
    ).toBe(false);

    expect(
      verifyWebhookSignature({
        secret,
        timestamp,
        signature,
        rawBody: Buffer.from('{"id":43}'),
        nowMs: 1790650800 * 1000,
      }).ok,
    ).toBe(false);
  });
});
