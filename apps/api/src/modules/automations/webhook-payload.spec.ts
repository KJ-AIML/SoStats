import { describe, expect, it } from 'vitest';
import { normalizeWebhookPayload } from './webhook-payload.js';

describe('webhook payload normalization', () => {
  it('normalizes a WordPress REST-style post payload', () => {
    const body = {
      post: {
        id: 42,
        type: 'post',
        status: 'publish',
        link: 'https://example.com/launch',
        date_gmt: '2026-09-29T03:00:00',
        title: { rendered: 'Launch &amp; Learn' },
        excerpt: { rendered: '<p>Short product update.</p>' },
      },
    };
    const rawBody = Buffer.from(JSON.stringify(body));

    expect(
      normalizeWebhookPayload({
        sourceType: 'wordpress',
        body,
        rawBody,
        eventId: 'wp-event-42',
      }),
    ).toEqual({
      externalId: 'wp-event-42',
      title: 'Launch & Learn',
      link: 'https://example.com/launch',
      publishedAt: '2026-09-29T03:00:00',
      summary: 'Short product update.',
      status: 'publish',
      postType: 'post',
    });
  });

  it('falls back to a body hash for generic events without an id', () => {
    const body = { title: 'Untitled event payload' };
    const rawBody = Buffer.from(JSON.stringify(body));
    const first = normalizeWebhookPayload({
      sourceType: 'generic',
      body,
      rawBody,
    });
    const second = normalizeWebhookPayload({
      sourceType: 'generic',
      body,
      rawBody,
    });

    expect(first.externalId).toHaveLength(64);
    expect(second.externalId).toBe(first.externalId);
  });
});
