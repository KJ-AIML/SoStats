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
    const eventName = 'wordpress.post.published';
    const eventId = 'event-42';
    const signature = signWebhookPayload(
      secret,
      timestamp,
      eventName,
      eventId,
      body,
    );

    expect(
      verifyWebhookSignature({
        secret,
        timestamp,
        signature: `sha256=${signature}`,
        eventName,
        eventId,
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
    const eventName = 'content.published';
    const eventId = 'event-42';
    const signature = signWebhookPayload(
      secret,
      timestamp,
      eventName,
      eventId,
      original,
    );

    expect(
      verifyWebhookSignature({
        secret,
        timestamp,
        signature,
        eventName,
        eventId,
        rawBody: original,
        nowMs: 1790650800 * 1000 + 301_000,
      }).ok,
    ).toBe(false);

    expect(
      verifyWebhookSignature({
        secret,
        timestamp,
        signature,
        eventName,
        eventId,
        rawBody: Buffer.from('{"id":43}'),
        nowMs: 1790650800 * 1000,
      }).ok,
    ).toBe(false);

    expect(
      verifyWebhookSignature({
        secret,
        timestamp,
        signature,
        eventName,
        eventId: 'event-43',
        rawBody: original,
        nowMs: 1790650800 * 1000,
      }).ok,
    ).toBe(false);
  });
});
