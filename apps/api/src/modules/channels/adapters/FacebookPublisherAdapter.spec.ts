import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FacebookPublisherAdapter } from './FacebookPublisherAdapter.js';
import { MetaGraphClient } from './MetaGraphClient.js';
import { testPublishContext } from '../../../../test/support/publish-context.js';

describe('FacebookPublisherAdapter', () => {
  const original = {
    appId: process.env.META_APP_ID,
    appSecret: process.env.META_APP_SECRET,
    apiVersion: process.env.META_GRAPH_API_VERSION,
    scopes: process.env.META_FACEBOOK_SCOPES,
  };

  beforeEach(() => {
    process.env.META_APP_ID = 'meta-app-id';
    process.env.META_APP_SECRET = 'meta-app-secret';
    process.env.META_GRAPH_API_VERSION = 'v26.0';
    delete process.env.META_FACEBOOK_SCOPES;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    const restore = (name: string, value: string | undefined) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };
    restore('META_APP_ID', original.appId);
    restore('META_APP_SECRET', original.appSecret);
    restore('META_GRAPH_API_VERSION', original.apiVersion);
    restore('META_FACEBOOK_SCOPES', original.scopes);
  });

  it('requests the Pages permissions used by the adapter', () => {
    const adapter = new FacebookPublisherAdapter(new MetaGraphClient());
    const url = new URL(
      adapter.getAuthUrl(
        'https://api.example.com/v1/channels/oauth/callback',
        'encrypted-state',
      ),
    );

    expect(url.pathname).toBe('/v26.0/dialog/oauth');
    expect(url.searchParams.get('scope')).toContain('pages_show_list');
    expect(url.searchParams.get('scope')).toContain('pages_manage_posts');
    expect(url.searchParams.get('scope')).toContain('read_insights');
  });

  it('publishes one attached image through the Page photos endpoint', async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe(
        'https://graph.facebook.com/v26.0/page-123/photos',
      );
      expect(init?.method).toBe('POST');
      const body = new URLSearchParams(String(init?.body));
      expect(body.get('caption')).toBe('Launch day');
      expect(body.get('url')).toBe('https://storage.example.com/asset.jpg');
      expect(body.get('access_token')).toBe('page-token');
      return new Response(
        JSON.stringify({ id: 'photo-1', post_id: 'page-123_post-456' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new FacebookPublisherAdapter(new MetaGraphClient());
    await expect(
      adapter.publishPost('Launch day', 'page-token', {
        ...testPublishContext(),
        providerAccountId: 'page-123',
        media: [
          {
            assetId: 1,
            fileType: 'image',
            mimeType: 'image/jpeg',
            fileName: 'asset.jpg',
            url: 'https://storage.example.com/asset.jpg',
          },
        ],
      }),
    ).resolves.toEqual({
      postId: 'page-123_post-456',
      url: 'https://www.facebook.com/page-123_post-456',
    });
  });

  it('returns real interaction and click metrics without deprecated impression metrics', async () => {
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return new Response(
          JSON.stringify({
            shares: { count: 3 },
            reactions: { summary: { total_count: 20 } },
            comments: { summary: { total_count: 4 } },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          data: [
            {
              name: 'post_clicks',
              values: [{ value: 11 }],
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new FacebookPublisherAdapter(new MetaGraphClient());
    await expect(
      adapter.fetchPostMetrics('page_post', 'page-token'),
    ).resolves.toEqual({
      shares: 3,
      reactions: 20,
      comments: 4,
      clicks: 11,
    });
  });

  describe('publish error semantics', () => {
    const meta = (status: number, error: Record<string, unknown>) =>
      new Response(JSON.stringify({ error }), { status });

    function publish(respond: () => Response, context = testPublishContext()) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => respond()),
      );
      return new FacebookPublisherAdapter(new MetaGraphClient())
        .publishPost('Hello', 'page-token', {
          ...context,
          providerAccountId: 'page-123',
        })
        .catch((caught: unknown) => caught);
    }

    it.each([
      [
        '500',
        () => meta(500, { message: 'down' }),
        {
          retryable: false,
          outcomeUnknown: true,
          errorClass: 'transient_provider',
        },
      ],
      [
        'is_transient 400',
        () => meta(400, { is_transient: true }),
        {
          retryable: false,
          outcomeUnknown: true,
          errorClass: 'transient_provider',
        },
      ],
      [
        'rate code 4',
        () => meta(400, { code: 4 }),
        { retryable: true, outcomeUnknown: false, errorClass: 'rate_limit' },
      ],
      [
        'HTTP 429',
        () => meta(429, { message: 'slow' }),
        { retryable: true, outcomeUnknown: false, errorClass: 'rate_limit' },
      ],
      [
        'token code 190',
        () => meta(400, { code: 190 }),
        {
          retryable: false,
          outcomeUnknown: false,
          errorClass: 'authentication',
        },
      ],
      [
        'permission code 200',
        () => meta(400, { code: 200 }),
        {
          retryable: false,
          outcomeUnknown: false,
          errorClass: 'authorization',
        },
      ],
      [
        'plain 400',
        () => meta(400, { message: 'bad' }),
        {
          retryable: false,
          outcomeUnknown: false,
          errorClass: 'invalid_request',
        },
      ],
      [
        'malformed 2xx',
        () => new Response('<html>', { status: 200 }),
        {
          retryable: false,
          outcomeUnknown: true,
          errorClass: 'unknown_outcome',
        },
      ],
      [
        '2xx without id',
        () => new Response('{}', { status: 200 }),
        {
          retryable: false,
          outcomeUnknown: true,
          errorClass: 'unknown_outcome',
        },
      ],
    ])('classifies %s', async (_label, respond, expected) => {
      const context = testPublishContext();
      expect(await publish(respond, context)).toMatchObject(expected);
      expect(context.beforeSideEffect).toHaveBeenCalledTimes(1);
    });

    it('treats a network failure after the marker as unknown', async () => {
      const context = testPublishContext();
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new TypeError('fetch failed');
        }),
      );
      const error = await new FacebookPublisherAdapter(new MetaGraphClient())
        .publishPost('Hello', 'page-token', {
          ...context,
          providerAccountId: 'page-123',
        })
        .catch((caught: unknown) => caught);
      expect(error).toMatchObject({
        retryable: false,
        outcomeUnknown: true,
        errorClass: 'network_transient',
      });
      expect(context.beforeSideEffect).toHaveBeenCalledTimes(1);
    });

    it('declares the checkpoint operation type per endpoint', async () => {
      const feed = testPublishContext();
      await publish(() => meta(400, {}), feed);
      expect(feed.beforeSideEffect).toHaveBeenCalledWith({
        operationType: 'facebook_page_feed',
      });
      const photo = testPublishContext();
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => meta(400, {})),
      );
      await new FacebookPublisherAdapter(new MetaGraphClient())
        .publishPost('Hi', 'page-token', {
          ...photo,
          providerAccountId: 'page-123',
          media: [
            {
              assetId: 1,
              fileType: 'image',
              mimeType: 'image/jpeg',
              fileName: 'a.jpg',
              url: 'https://storage.example.com/a.jpg',
            },
          ],
        })
        .catch(() => undefined);
      expect(photo.beforeSideEffect).toHaveBeenCalledWith({
        operationType: 'facebook_page_photo',
      });
    });

    it('rejects invalid input before the marker', async () => {
      const context = testPublishContext();
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const error = await new FacebookPublisherAdapter(new MetaGraphClient())
        .publishPost('', 'page-token', {
          ...context,
          providerAccountId: 'page-123',
        })
        .catch((caught: unknown) => caught);
      expect(error).toMatchObject({
        retryable: false,
        outcomeUnknown: false,
        errorClass: 'invalid_request',
      });
      expect(context.beforeSideEffect).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('sends nothing and surfaces the same error when the hook rejects', async () => {
      const hookError = new Error('marker rejected');
      const context = testPublishContext({
        beforeSideEffect: vi.fn(async () => {
          throw hookError;
        }),
      });
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      await expect(
        new FacebookPublisherAdapter(new MetaGraphClient()).publishPost(
          'Hello',
          'page-token',
          { ...context, providerAccountId: 'page-123' },
        ),
      ).rejects.toBe(hookError);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('is retryable and never calls the hook when the budget is already aborted', async () => {
      const budget = new AbortController();
      budget.abort();
      const context = testPublishContext({ signal: budget.signal });
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const error = await new FacebookPublisherAdapter(new MetaGraphClient())
        .publishPost('Hello', 'page-token', {
          ...context,
          providerAccountId: 'page-123',
        })
        .catch((caught: unknown) => caught);
      expect(error).toMatchObject({
        retryable: true,
        outcomeUnknown: false,
        errorClass: 'network_transient',
      });
      expect(context.beforeSideEffect).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('wires the publish budget into the post request signal', async () => {
      const budget = new AbortController();
      let captured: AbortSignal | undefined;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: string | URL, init?: RequestInit) => {
          captured = init?.signal ?? undefined;
          return new Response(JSON.stringify({ id: 'p-1' }), { status: 200 });
        }),
      );
      await new FacebookPublisherAdapter(new MetaGraphClient()).publishPost(
        'Hello',
        'page-token',
        {
          ...testPublishContext({ signal: budget.signal }),
          providerAccountId: 'page-123',
        },
      );
      expect(captured).toBeDefined();
      expect(captured!.aborted).toBe(false);
      budget.abort();
      expect(captured!.aborted).toBe(true);
    });

    it('classifies refresh as an authentication failure', async () => {
      const error = await new FacebookPublisherAdapter(new MetaGraphClient())
        .refreshAccessToken('x')
        .catch((caught: unknown) => caught);
      expect(error).toMatchObject({
        retryable: false,
        errorClass: 'authentication',
      });
    });
  });
});
