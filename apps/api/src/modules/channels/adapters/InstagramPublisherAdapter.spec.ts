import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstagramPublisherAdapter } from './InstagramPublisherAdapter.js';
import { MetaGraphClient } from './MetaGraphClient.js';

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
        expect(value).toBe(
          'https://graph.facebook.com/v26.0/ig-123/media',
        );
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
        providerAccountId: 'ig-123',
        signal: new AbortController().signal,
        beforeSideEffect: () => Promise.resolve(),
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
        providerAccountId: 'ig-123',
        signal: new AbortController().signal,
        beforeSideEffect: () => Promise.resolve(),
        media: [],
      }),
    ).rejects.toThrow('requires exactly one attached JPEG image');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
