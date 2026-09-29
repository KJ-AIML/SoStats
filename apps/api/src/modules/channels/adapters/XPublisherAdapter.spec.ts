import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testPublishContext } from '../../../../test/support/publish-context.js';
import { XPublisherAdapter } from './XPublisherAdapter.js';

describe('XPublisherAdapter', () => {
  const original = {
    clientId: process.env.X_CLIENT_ID,
    clientSecret: process.env.X_CLIENT_SECRET,
    scopes: process.env.X_SCOPES,
  };

  beforeEach(() => {
    process.env.X_CLIENT_ID = 'x-client-id';
    process.env.X_CLIENT_SECRET = 'x-client-secret';
    process.env.X_SCOPES =
      'tweet.read tweet.write users.read offline.access';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    const restore = (name: string, value: string | undefined) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };
    restore('X_CLIENT_ID', original.clientId);
    restore('X_CLIENT_SECRET', original.clientSecret);
    restore('X_SCOPES', original.scopes);
  });

  it('builds an OAuth 2.0 PKCE authorization URL', () => {
    const adapter = new XPublisherAdapter();
    const url = new URL(
      adapter.getAuthUrl(
        'https://api.example.com/v1/channels/oauth/callback',
        'encrypted-state',
        'pkce-challenge',
      ),
    );

    expect(url.origin + url.pathname).toBe(
      'https://x.com/i/oauth2/authorize',
    );
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('x-client-id');
    expect(url.searchParams.get('state')).toBe('encrypted-state');
    expect(url.searchParams.get('code_challenge')).toBe('pkce-challenge');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toContain('tweet.write');
    expect(url.searchParams.get('scope')).toContain('offline.access');
  });

  it('publishes text through X API v2 and returns the provider post URL', async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe('https://api.x.com/2/tweets');
      expect(init?.method).toBe('POST');
      expect(new Headers(init?.headers).get('authorization')).toBe(
        'Bearer user-access-token',
      );
      expect(JSON.parse(String(init?.body))).toEqual({
        text: 'Launch day',
      });
      return new Response(
        JSON.stringify({ data: { id: '1234567890', text: 'Launch day' } }),
        {
          status: 201,
          headers: { 'content-type': 'application/json' },
        },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new XPublisherAdapter();
    await expect(
      adapter.publishPost(
        'Launch day',
        'user-access-token',
        testPublishContext(),
      ),
    ).resolves.toEqual({
      postId: '1234567890',
      url: 'https://x.com/i/web/status/1234567890',
    });
  });

  it('falls back to public metrics when private metrics are unavailable', async () => {
    let calls = 0;
    const fetchMock = vi.fn(async (url: string | URL) => {
      calls += 1;
      const parsed = new URL(String(url));
      if (calls === 1) {
        expect(parsed.searchParams.get('tweet.fields')).toContain(
          'non_public_metrics',
        );
        return new Response('forbidden', { status: 403 });
      }

      expect(parsed.searchParams.get('tweet.fields')).toBe('public_metrics');
      return new Response(
        JSON.stringify({
          data: {
            id: '1234567890',
            public_metrics: {
              impression_count: 900,
              like_count: 40,
              reply_count: 5,
              retweet_count: 8,
              quote_count: 2,
              bookmark_count: 7,
            },
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new XPublisherAdapter();
    await expect(
      adapter.fetchPostMetrics('1234567890', 'user-access-token'),
    ).resolves.toEqual({
      impressions: 900,
      reactions: 40,
      comments: 5,
      shares: 10,
      saves: 7,
      clicks: 0,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  describe('publish error semantics', () => {
    function publish(respond: () => Response | Promise<Response>) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => respond()),
      );
      return new XPublisherAdapter()
        .publishPost('Launch day', 'token', testPublishContext())
        .catch((caught: unknown) => caught);
    }

    it.each([
      [
        '429',
        () => new Response('{}', { status: 429 }),
        { retryable: true, outcomeUnknown: false, errorClass: 'rate_limit' },
      ],
      [
        '503',
        () => new Response('{}', { status: 503 }),
        { outcomeUnknown: true, errorClass: 'transient_provider' },
      ],
      [
        '403',
        () => new Response('{}', { status: 403 }),
        { retryable: false, outcomeUnknown: false, errorClass: 'authorization' },
      ],
      [
        'malformed 2xx',
        () => new Response('not json', { status: 201 }),
        { outcomeUnknown: true, errorClass: 'unknown_outcome' },
      ],
      [
        '2xx without id',
        () => new Response('{"data":{}}', { status: 201 }),
        { outcomeUnknown: true, errorClass: 'unknown_outcome' },
      ],
    ])('classifies %s', async (_label, respond, expected) => {
      expect(await publish(respond)).toMatchObject(expected);
    });

    it('marks the side effect once before the post, and sends nothing when refused', async () => {
      const order: string[] = [];
      const context = testPublishContext({
        beforeSideEffect: vi.fn(async () => {
          order.push('marker');
        }),
      });
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          order.push('post');
          return new Response('{"data":{"id":"1"}}', { status: 201 });
        }),
      );
      await new XPublisherAdapter().publishPost('Launch day', 'token', context);
      expect(order).toEqual(['marker', 'post']);
      expect(context.beforeSideEffect).toHaveBeenCalledTimes(1);
      expect(context.beforeSideEffect).toHaveBeenCalledWith({
        operationType: 'x_create_post',
      });

      const refused = vi.fn();
      vi.stubGlobal('fetch', refused);
      await expect(
        new XPublisherAdapter().publishPost(
          'Launch day',
          'token',
          testPublishContext({
            beforeSideEffect: vi.fn(async () => {
              throw new Error('lease lost');
            }),
          }),
        ),
      ).rejects.toThrow('lease lost');
      expect(refused).not.toHaveBeenCalled();
    });

    it('classifies a publish network failure as unknown', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new TypeError('fetch failed');
        }),
      );
      const error = await new XPublisherAdapter()
        .publishPost('Launch day', 'token', testPublishContext())
        .catch((caught: unknown) => caught);
      expect(error).toMatchObject({
        outcomeUnknown: true,
        errorClass: 'network_transient',
      });
    });

    it('classifies a refresh network failure as retryable, not unknown', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new TypeError('fetch failed');
        }),
      );
      const error = await new XPublisherAdapter()
        .refreshAccessToken('refresh')
        .catch((caught: unknown) => caught);
      expect(error).toMatchObject({
        retryable: true,
        outcomeUnknown: false,
        errorClass: 'network_transient',
      });
    });
  });
});
