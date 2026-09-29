import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FacebookPublisherAdapter } from './FacebookPublisherAdapter.js';
import { MetaGraphClient } from './MetaGraphClient.js';

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
});
