import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstagramPublisherAdapter } from './InstagramPublisherAdapter.js';
import { MetaGraphClient } from './MetaGraphClient.js';
import { testPublishContext } from '../../../../test/support/publish-context.js';

describe('InstagramPublisherAdapter', () => {
  const original = {
    appId: process.env.META_APP_ID,
    appSecret: process.env.META_APP_SECRET,
    apiVersion: process.env.META_GRAPH_API_VERSION,
    scopes: process.env.META_INSTAGRAM_SCOPES,
  };

  beforeEach(() => {
    process.env.META_APP_ID = 'meta-app-id';
    process.env.META_APP_SECRET = 'meta-app-secret';
    process.env.META_GRAPH_API_VERSION = 'v26.0';
    delete process.env.META_INSTAGRAM_SCOPES;
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
    restore('META_INSTAGRAM_SCOPES', original.scopes);
  });

  it('declares media-required Instagram publishing and current scopes', () => {
    const adapter = new InstagramPublisherAdapter(new MetaGraphClient());
    expect(adapter.capabilities.requiresMedia).toBe(true);
    expect(adapter.capabilities.mediaMimeTypes).toEqual(['image/jpeg']);

    const url = new URL(
      adapter.getAuthUrl(
        'https://api.example.com/v1/channels/oauth/callback',
        'encrypted-state',
      ),
    );
    expect(url.searchParams.get('scope')).toContain('instagram_basic');
    expect(url.searchParams.get('scope')).toContain(
      'instagram_content_publish',
    );
    expect(url.searchParams.get('scope')).toContain(
      'instagram_manage_insights',
    );
  });

  it('publishes one JPEG with container -> status -> media_publish', async () => {
    let call = 0;
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      call += 1;
      const value = String(url);

      if (call === 1) {
        expect(value).toBe('https://graph.facebook.com/v26.0/ig-123/media');
        const body = new URLSearchParams(String(init?.body));
        expect(body.get('image_url')).toBe(
          'https://storage.example.com/asset.jpg',
        );
        expect(body.get('caption')).toBe('Hello Instagram');
        return new Response(JSON.stringify({ id: 'container-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (call === 2) {
        expect(value).toContain('/v26.0/container-1?');
        return new Response(
          JSON.stringify({
            id: 'container-1',
            status_code: 'FINISHED',
            status: 'Finished',
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      if (call === 3) {
        expect(value).toBe(
          'https://graph.facebook.com/v26.0/ig-123/media_publish',
        );
        const body = new URLSearchParams(String(init?.body));
        expect(body.get('creation_id')).toBe('container-1');
        return new Response(JSON.stringify({ id: 'media-999' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      expect(value).toContain('/v26.0/media-999?');
      return new Response(
        JSON.stringify({
          id: 'media-999',
          permalink: 'https://www.instagram.com/p/example/',
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new InstagramPublisherAdapter(new MetaGraphClient());
    await expect(
      adapter.publishPost('Hello Instagram', 'page-token', {
        ...testPublishContext(),
        providerAccountId: 'ig-123',
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
      postId: 'media-999',
      url: 'https://www.instagram.com/p/example/',
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('rejects text-only Instagram publishing before any network call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new InstagramPublisherAdapter(new MetaGraphClient());
    await expect(
      adapter.publishPost('Caption only', 'page-token', {
        ...testPublishContext(),
        providerAccountId: 'ig-123',
        media: [],
      }),
    ).rejects.toThrow('requires exactly one attached JPEG image');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['text-only', []],
    [
      'a non-JPEG image',
      [
        {
          assetId: 1,
          fileType: 'image',
          mimeType: 'image/png',
          fileName: 'a.png',
          url: 'https://storage.example.com/a.png',
        },
      ],
    ],
  ])(
    'classifies %s input as invalid_request without a network call',
    async (_label, media) => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const context = testPublishContext();
      const error = await new InstagramPublisherAdapter(new MetaGraphClient())
        .publishPost('Caption', 'page-token', {
          ...context,
          providerAccountId: 'ig-123',
          media,
        })
        .catch((caught: unknown) => caught);
      expect(error).toMatchObject({
        retryable: false,
        outcomeUnknown: false,
        errorClass: 'invalid_request',
      });
      expect(context.beforeSideEffect).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  describe('side-effect boundary and error semantics', () => {
    const image = {
      assetId: 1,
      fileType: 'image',
      mimeType: 'image/jpeg',
      fileName: 'a.jpg',
      url: 'https://storage.example.com/a.jpg',
    };
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status });

    function routeFetch(routes: {
      create?: () => Response;
      status?: () => Response;
      publish?: () => Response;
      permalink?: () => Response;
      onPublishInit?: (init?: RequestInit) => void;
    }) {
      const calls: string[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string | URL, init?: RequestInit) => {
          const target = String(url);
          if (target.endsWith('/ig-1/media')) {
            calls.push('create');
            return (routes.create ?? (() => json({ id: 'container-1' })))();
          }
          if (target.endsWith('/ig-1/media_publish')) {
            calls.push('publish');
            routes.onPublishInit?.(init);
            return (routes.publish ?? (() => json({ id: 'media-1' })))();
          }
          if (target.includes('container-1?')) {
            calls.push('status');
            return (
              routes.status ?? (() => json({ status_code: 'FINISHED' }))
            )();
          }
          calls.push('other');
          return (
            routes.permalink ??
            (() => json({ permalink: 'https://instagram.com/p/1' }))
          )();
        }),
      );
      return calls;
    }

    function publish(context = testPublishContext()) {
      return new InstagramPublisherAdapter(new MetaGraphClient())
        .publishPost('Hello', 'token', {
          ...context,
          providerAccountId: 'ig-1',
          media: [image],
        })
        .catch((caught: unknown) => caught);
    }

    it('persists the container id at the marker, before media_publish', async () => {
      const calls = routeFetch({});
      const context = testPublishContext({
        beforeSideEffect: vi.fn(async () => {
          calls.push('marker');
        }),
      });
      await expect(publish(context)).resolves.toMatchObject({
        postId: 'media-1',
      });
      expect(calls.slice(0, 4)).toEqual([
        'create',
        'status',
        'marker',
        'publish',
      ]);
      expect(context.beforeSideEffect).toHaveBeenCalledTimes(1);
      expect(context.beforeSideEffect).toHaveBeenCalledWith({
        operationType: 'instagram_media_publish',
        operationId: 'container-1',
      });
    });

    it('treats a container network failure as retryable and never marks', async () => {
      routeFetch({
        create: () => {
          throw new TypeError('fetch failed');
        },
      });
      const context = testPublishContext();
      expect(await publish(context)).toMatchObject({
        retryable: true,
        outcomeUnknown: false,
        errorClass: 'network_transient',
      });
      expect(context.beforeSideEffect).not.toHaveBeenCalled();
    });

    it('treats a container 500 as retryable, known, and never marks', async () => {
      routeFetch({ create: () => json({ error: { message: 'x' } }, 500) });
      const context = testPublishContext();
      expect(await publish(context)).toMatchObject({
        retryable: true,
        outcomeUnknown: false,
        errorClass: 'transient_provider',
      });
      expect(context.beforeSideEffect).not.toHaveBeenCalled();
    });

    it('treats a container 200 without an id as retryable and never marks', async () => {
      routeFetch({ create: () => json({}) });
      const context = testPublishContext();
      expect(await publish(context)).toMatchObject({
        retryable: true,
        outcomeUnknown: false,
        errorClass: 'transient_provider',
      });
      expect(context.beforeSideEffect).not.toHaveBeenCalled();
    });

    it('treats a container 400 as a permanent known failure', async () => {
      routeFetch({ create: () => json({ error: { message: 'bad' } }, 400) });
      const context = testPublishContext();
      expect(await publish(context)).toMatchObject({
        retryable: false,
        outcomeUnknown: false,
        errorClass: 'invalid_request',
      });
      expect(context.beforeSideEffect).not.toHaveBeenCalled();
    });

    it('treats a container ERROR status as content_rejected without marking', async () => {
      routeFetch({ status: () => json({ status_code: 'ERROR' }) });
      const context = testPublishContext();
      expect(await publish(context)).toMatchObject({
        retryable: false,
        outcomeUnknown: false,
        errorClass: 'content_rejected',
      });
      expect(context.beforeSideEffect).not.toHaveBeenCalled();
    });

    it('treats a status-poll 500 as retryable, known, and never marks', async () => {
      routeFetch({ status: () => json({ error: { message: 'x' } }, 500) });
      const context = testPublishContext();
      expect(await publish(context)).toMatchObject({
        retryable: true,
        outcomeUnknown: false,
        errorClass: 'transient_provider',
      });
      expect(context.beforeSideEffect).not.toHaveBeenCalled();
    });

    it('treats media_publish 200 without an id as unknown (C5)', async () => {
      routeFetch({ publish: () => json({}) });
      const context = testPublishContext();
      expect(await publish(context)).toMatchObject({
        retryable: false,
        outcomeUnknown: true,
        errorClass: 'unknown_outcome',
      });
      expect(context.beforeSideEffect).toHaveBeenCalledTimes(1);
    });

    it('treats a malformed media_publish 200 body as unknown', async () => {
      routeFetch({ publish: () => new Response('<html>', { status: 200 }) });
      expect(await publish()).toMatchObject({
        retryable: false,
        outcomeUnknown: true,
        errorClass: 'unknown_outcome',
      });
    });

    it('treats a media_publish 500 as unknown', async () => {
      routeFetch({ publish: () => json({ error: { message: 'down' } }, 500) });
      expect(await publish()).toMatchObject({
        retryable: false,
        outcomeUnknown: true,
        errorClass: 'transient_provider',
      });
    });

    it('treats a media_publish network failure as unknown after the marker', async () => {
      routeFetch({
        publish: () => {
          throw new TypeError('fetch failed');
        },
      });
      const context = testPublishContext();
      expect(await publish(context)).toMatchObject({
        retryable: false,
        outcomeUnknown: true,
        errorClass: 'network_transient',
      });
      expect(context.beforeSideEffect).toHaveBeenCalledTimes(1);
    });

    it('treats media_publish rate limit with is_transient as retryable and known', async () => {
      routeFetch({
        publish: () => json({ error: { code: 4, is_transient: true } }, 400),
      });
      expect(await publish()).toMatchObject({
        retryable: true,
        outcomeUnknown: false,
        errorClass: 'rate_limit',
      });
    });

    it('treats media_publish is_transient on a non-5xx response as unknown', async () => {
      routeFetch({
        publish: () => json({ error: { is_transient: true } }, 400),
      });
      expect(await publish()).toMatchObject({
        retryable: false,
        outcomeUnknown: true,
        errorClass: 'transient_provider',
      });
    });

    it('treats a media_publish 503 carrying a rate code as unknown', async () => {
      routeFetch({ publish: () => json({ error: { code: 4 } }, 503) });
      expect(await publish()).toMatchObject({
        retryable: false,
        outcomeUnknown: true,
        errorClass: 'transient_provider',
      });
    });

    it.each([
      [
        'rate limit (code 4)',
        () => json({ error: { code: 4 } }, 400),
        { retryable: true, outcomeUnknown: false, errorClass: 'rate_limit' },
      ],
      [
        'token error (code 190)',
        () => json({ error: { code: 190 } }, 400),
        {
          retryable: false,
          outcomeUnknown: false,
          errorClass: 'authentication',
        },
      ],
      [
        'is_transient',
        () => json({ error: { is_transient: true } }, 400),
        {
          retryable: true,
          outcomeUnknown: false,
          errorClass: 'transient_provider',
        },
      ],
    ])(
      'classifies container creation %s as known and pre-marker',
      async (_label, create, expected) => {
        routeFetch({ create });
        const context = testPublishContext();
        expect(await publish(context)).toMatchObject(expected);
        expect(context.beforeSideEffect).not.toHaveBeenCalled();
      },
    );

    it('treats a status-poll network failure as retryable and never marks', async () => {
      routeFetch({
        status: () => {
          throw new TypeError('fetch failed');
        },
      });
      const context = testPublishContext();
      expect(await publish(context)).toMatchObject({
        retryable: true,
        outcomeUnknown: false,
        errorClass: 'network_transient',
      });
      expect(context.beforeSideEffect).not.toHaveBeenCalled();
    });

    it('treats a container EXPIRED status as content_rejected without marking', async () => {
      routeFetch({ status: () => json({ status_code: 'EXPIRED' }) });
      const context = testPublishContext();
      expect(await publish(context)).toMatchObject({
        retryable: false,
        outcomeUnknown: false,
        errorClass: 'content_rejected',
      });
      expect(context.beforeSideEffect).not.toHaveBeenCalled();
    });

    it.each([
      ['unreadable', () => new Response('<html>', { status: 200 })],
      ['without a status_code', () => json({ id: 'container-1' })],
    ])(
      'fails fast on a status-poll 2xx body that is %s',
      async (_label, status) => {
        const calls = routeFetch({ status });
        const context = testPublishContext();
        expect(await publish(context)).toMatchObject({
          retryable: true,
          outcomeUnknown: false,
          errorClass: 'transient_provider',
        });
        expect(calls.filter((call) => call === 'status')).toHaveLength(1);
        expect(context.beforeSideEffect).not.toHaveBeenCalled();
      },
    );

    it('gives up after 6 status checks with a retryable transient_provider error', async () => {
      const calls = routeFetch({
        status: () => json({ status_code: 'IN_PROGRESS' }),
      });
      const context = testPublishContext();
      const error = await publish(context);
      expect(error).toMatchObject({
        retryable: true,
        outcomeUnknown: false,
        errorClass: 'transient_provider',
      });
      expect((error as Error).message).toContain('6 status checks');
      expect(calls.filter((call) => call === 'status')).toHaveLength(6);
      expect(calls).not.toContain('publish');
      expect(context.beforeSideEffect).not.toHaveBeenCalled();
    }, 15_000);

    it('treats media_publish rate limit as retryable and known', async () => {
      routeFetch({ publish: () => json({ error: { code: 4 } }, 400) });
      expect(await publish()).toMatchObject({
        retryable: true,
        outcomeUnknown: false,
        errorClass: 'rate_limit',
      });
    });

    it('treats media_publish token error as a known authentication failure', async () => {
      routeFetch({ publish: () => json({ error: { code: 190 } }, 400) });
      expect(await publish()).toMatchObject({
        retryable: false,
        outcomeUnknown: false,
        errorClass: 'authentication',
      });
    });

    it('treats media_publish permission error as a known authorization failure', async () => {
      routeFetch({ publish: () => json({ error: { code: 200 } }, 403) });
      expect(await publish()).toMatchObject({
        retryable: false,
        outcomeUnknown: false,
        errorClass: 'authorization',
      });
    });

    it('does not fail the publish when the permalink body is malformed', async () => {
      routeFetch({
        permalink: () => new Response('<html>', { status: 200 }),
      });
      expect(await publish()).toEqual({ postId: 'media-1' });
    });

    it('surfaces the same error and does not publish when the hook rejects', async () => {
      const hookError = new Error('marker rejected');
      const calls = routeFetch({});
      const context = testPublishContext({
        beforeSideEffect: vi.fn(async () => {
          throw hookError;
        }),
      });
      await expect(
        new InstagramPublisherAdapter(new MetaGraphClient()).publishPost(
          'Hello',
          'token',
          { ...context, providerAccountId: 'ig-1', media: [image] },
        ),
      ).rejects.toBe(hookError);
      expect(calls).not.toContain('publish');
    });

    it('is retryable and never calls the hook when the budget is already aborted', async () => {
      const budget = new AbortController();
      budget.abort();
      const calls = routeFetch({});
      const context = testPublishContext({ signal: budget.signal });
      expect(await publish(context)).toMatchObject({
        retryable: true,
        outcomeUnknown: false,
        errorClass: 'network_transient',
      });
      expect(context.beforeSideEffect).not.toHaveBeenCalled();
      expect(calls).not.toContain('publish');
    });

    it('wires the publish budget into the media_publish request signal', async () => {
      const budget = new AbortController();
      let captured: AbortSignal | undefined;
      routeFetch({
        onPublishInit: (init) => {
          captured = init?.signal ?? undefined;
        },
      });
      await expect(
        publish(testPublishContext({ signal: budget.signal })),
      ).resolves.toMatchObject({ postId: 'media-1' });
      expect(captured).toBeDefined();
      expect(captured!.aborted).toBe(false);
      budget.abort();
      expect(captured!.aborted).toBe(true);
    });

    it('stops polling on budget abort without marking or publishing (Review Focus 5)', async () => {
      const budget = new AbortController();
      const calls = routeFetch({
        status: () => {
          budget.abort();
          return json({ status_code: 'IN_PROGRESS' });
        },
      });
      const context = testPublishContext({ signal: budget.signal });
      expect(await publish(context)).toMatchObject({
        retryable: true,
        outcomeUnknown: false,
        errorClass: 'network_transient',
      });
      expect(context.beforeSideEffect).not.toHaveBeenCalled();
      expect(calls).not.toContain('publish');
      expect(calls.filter((call) => call === 'status')).toHaveLength(1);
    });

    it('classifies refresh as an authentication failure', async () => {
      const error = await new InstagramPublisherAdapter(new MetaGraphClient())
        .refreshAccessToken('x')
        .catch((caught: unknown) => caught);
      expect(error).toMatchObject({
        retryable: false,
        outcomeUnknown: false,
        errorClass: 'authentication',
      });
    });
  });

  describe('lookupPublication (32B-1 §4.4)', () => {
    const attempt = {
      operationType: 'instagram_media_publish',
      operationId: 'container-9',
    };
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    const lookup = (
      value: { operationType: string; operationId: string | null } = attempt,
      signal: AbortSignal = AbortSignal.timeout(5_000),
    ) =>
      new InstagramPublisherAdapter(new MetaGraphClient()).lookupPublication(
        value,
        'token',
        signal,
      );

    it('confirms only on status_code PUBLISHED, reading status_code alone', async () => {
      const fetchMock = vi.fn(async (_url: string | URL, _init?: RequestInit) =>
        json({ id: 'container-9', status_code: 'PUBLISHED', status: 'Published' }),
      );
      vi.stubGlobal('fetch', fetchMock);

      await expect(lookup()).resolves.toEqual({
        kind: 'confirmed',
        evidenceType: 'instagram_container_published',
      });
      const url = new URL(String(fetchMock.mock.calls[0]![0]));
      expect(url.pathname).toBe('/v26.0/container-9');
      expect(url.searchParams.get('fields')).toBe('status_code');
      expect(fetchMock.mock.calls[0]![1]?.method ?? 'GET').toBe('GET');
    });

    it.each(['FINISHED', 'IN_PROGRESS', 'ERROR', 'EXPIRED', 'SOMETHING_NEW'])(
      'treats %s as inconclusive and never reads the free-text status',
      async (statusCode) => {
        vi.stubGlobal(
          'fetch',
          vi.fn(async () => json({ status_code: statusCode, status: 'PUBLISHED' })),
        );
        await expect(lookup()).resolves.toEqual({
          kind: 'inconclusive',
          reason: 'container_not_published',
        });
      },
    );

    it('treats an unreadable body as lookup_failed', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 200 })));
      await expect(lookup()).resolves.toEqual({
        kind: 'inconclusive',
        reason: 'lookup_failed',
      });
    });

    it('maps 429 and Meta throttle codes to rate_limited', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => json({}, 429)));
      await expect(lookup()).resolves.toEqual({
        kind: 'inconclusive',
        reason: 'rate_limited',
      });
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          json({ error: { code: 4, message: 'Application request limit reached' } }, 400),
        ),
      );
      await expect(lookup()).resolves.toEqual({
        kind: 'inconclusive',
        reason: 'rate_limited',
      });
    });

    it('maps 5xx, 404 and network failures to lookup_failed', async () => {
      for (const status of [500, 404]) {
        vi.stubGlobal('fetch', vi.fn(async () => json({}, status)));
        await expect(lookup()).resolves.toEqual({
          kind: 'inconclusive',
          reason: 'lookup_failed',
        });
      }
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new TypeError('fetch failed');
        }),
      );
      await expect(lookup()).resolves.toEqual({
        kind: 'inconclusive',
        reason: 'lookup_failed',
      });
    });

    it('is bounded by the caller signal', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          (_url: string | URL, init?: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () =>
                reject(init.signal?.reason),
              );
            }),
        ),
      );
      const controller = new AbortController();
      const pending = lookup(attempt, controller.signal);
      controller.abort();
      await expect(pending).resolves.toEqual({
        kind: 'inconclusive',
        reason: 'lookup_failed',
      });
    });

    it('declines attempts that are not an Instagram media publish with a container id', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      await expect(
        lookup({ operationType: 'facebook_page_feed', operationId: 'x' }),
      ).resolves.toEqual({ kind: 'inconclusive', reason: 'lookup_unavailable' });
      await expect(
        lookup({ operationType: 'instagram_media_publish', operationId: null }),
      ).resolves.toEqual({ kind: 'inconclusive', reason: 'lookup_unavailable' });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
