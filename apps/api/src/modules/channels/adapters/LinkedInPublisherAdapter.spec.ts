import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testPublishContext } from '../../../../test/support/publish-context.js';
import { ProviderPublishError } from '../ports/SocialPublisherPort.js';
import { LinkedInPublisherAdapter } from './LinkedInPublisherAdapter.js';

describe('LinkedInPublisherAdapter.publishPost', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function publish(
    fetchMock: ReturnType<typeof vi.fn>,
    context = testPublishContext(),
  ) {
    vi.stubGlobal('fetch', fetchMock);
    return new LinkedInPublisherAdapter().publishPost('Launch day', 'token', {
      ...context,
      providerAccountId: 'member-1',
    });
  }

  it('marks the side effect once, before the post request, and returns the URN', async () => {
    const order: string[] = [];
    const context = testPublishContext({
      beforeSideEffect: vi.fn(async () => {
        order.push('marker');
      }),
    });
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      order.push('post');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response(null, {
        status: 201,
        headers: { 'x-restli-id': 'urn:li:share:1' },
      });
    });

    await expect(publish(fetchMock, context)).resolves.toEqual({
      postId: 'urn:li:share:1',
    });
    expect(order).toEqual(['marker', 'post']);
    expect(context.beforeSideEffect).toHaveBeenCalledTimes(1);
    expect(context.beforeSideEffect).toHaveBeenCalledWith({
      operationType: 'linkedin_create_post',
    });
  });

  it('resolves the member via a bounded userinfo call before the marker', async () => {
    const order: string[] = [];
    const context = testPublishContext({
      beforeSideEffect: vi.fn(async () => {
        order.push('marker');
      }),
    });
    let userinfoSignal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        if (String(url).endsWith('/v2/userinfo')) {
          order.push('userinfo');
          userinfoSignal = init?.signal ?? undefined;
          return new Response('{"sub":"member-9"}', { status: 200 });
        }
        order.push('post');
        return new Response(null, {
          status: 201,
          headers: { 'x-restli-id': 'urn:li:share:2' },
        });
      }),
    );

    await expect(
      new LinkedInPublisherAdapter().publishPost(
        'Launch day',
        'token',
        context,
      ),
    ).resolves.toEqual({ postId: 'urn:li:share:2' });
    expect(order).toEqual(['userinfo', 'marker', 'post']);
    expect(context.beforeSideEffect).toHaveBeenCalledTimes(1);
    expect(userinfoSignal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    [
      '429',
      () => new Response('slow', { status: 429 }),
      { retryable: true, outcomeUnknown: false, errorClass: 'rate_limit' },
    ],
    [
      '500',
      () => new Response('oops', { status: 500 }),
      {
        retryable: false,
        outcomeUnknown: true,
        errorClass: 'transient_provider',
      },
    ],
    [
      '401',
      () => new Response('no', { status: 401 }),
      { retryable: false, outcomeUnknown: false, errorClass: 'authentication' },
    ],
    [
      '422',
      () => new Response('bad', { status: 422 }),
      {
        retryable: false,
        outcomeUnknown: false,
        errorClass: 'invalid_request',
      },
    ],
    [
      '2xx without id',
      () => new Response(null, { status: 201 }),
      { retryable: false, outcomeUnknown: true, errorClass: 'unknown_outcome' },
    ],
  ])('classifies %s', async (_label, respond, expected) => {
    const error = await publish(vi.fn(async () => respond())).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ProviderPublishError);
    expect(error).toMatchObject(expected);
  });

  it('classifies a network failure as unknown, after the marker', async () => {
    const context = testPublishContext();
    const error = await publish(
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
      context,
    ).catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      retryable: false,
      outcomeUnknown: true,
      errorClass: 'network_transient',
    });
    expect(context.beforeSideEffect).toHaveBeenCalledTimes(1);
  });

  it('sends nothing and rethrows the identical error when the marker is refused', async () => {
    const hookError = new Error('lease lost');
    const fetchMock = vi.fn();
    const context = testPublishContext({
      beforeSideEffect: vi.fn(async () => {
        throw hookError;
      }),
    });
    await expect(publish(fetchMock, context)).rejects.toBe(hookError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails retryably without marking or sending when the budget is already exhausted', async () => {
    const controller = new AbortController();
    controller.abort();
    const context = testPublishContext({ signal: controller.signal });
    const fetchMock = vi.fn();
    const error = await publish(fetchMock, context).catch(
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({
      retryable: true,
      outcomeUnknown: false,
      errorClass: 'network_transient',
    });
    expect(context.beforeSideEffect).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('bounds the publish request by the parent budget signal', async () => {
    const controller = new AbortController();
    let sent: AbortSignal | undefined;
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      sent = init?.signal ?? undefined;
      return new Response(null, {
        status: 201,
        headers: { 'x-restli-id': 'urn:li:share:1' },
      });
    });
    await publish(fetchMock, testPublishContext({ signal: controller.signal }));
    expect(sent).toBeInstanceOf(AbortSignal);
    expect(sent?.aborted).toBe(false);
    controller.abort();
    expect(sent?.aborted).toBe(true);
  });
});

describe('LinkedInPublisherAdapter.refreshAccessToken', () => {
  const original = {
    id: process.env.LINKEDIN_CLIENT_ID,
    secret: process.env.LINKEDIN_CLIENT_SECRET,
  };

  beforeEach(() => {
    process.env.LINKEDIN_CLIENT_ID = 'id';
    process.env.LINKEDIN_CLIENT_SECRET = 'secret';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    const restore = (name: string, value: string | undefined) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };
    restore('LINKEDIN_CLIENT_ID', original.id);
    restore('LINKEDIN_CLIENT_SECRET', original.secret);
  });

  function refresh(respond: () => Response | Promise<Response>) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond()),
    );
    return new LinkedInPublisherAdapter()
      .refreshAccessToken('refresh')
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
      {
        retryable: true,
        outcomeUnknown: false,
        errorClass: 'transient_provider',
      },
    ],
    [
      '401',
      () => new Response('{}', { status: 401 }),
      { retryable: false, outcomeUnknown: false, errorClass: 'authentication' },
    ],
    [
      'malformed 2xx',
      () => new Response('not json', { status: 200 }),
      {
        retryable: true,
        outcomeUnknown: false,
        errorClass: 'transient_provider',
      },
    ],
    [
      'token-less 2xx',
      () => new Response('{}', { status: 200 }),
      {
        retryable: true,
        outcomeUnknown: false,
        errorClass: 'transient_provider',
      },
    ],
  ])('classifies %s', async (_label, respond, expected) => {
    expect(await refresh(respond)).toMatchObject(expected);
  });

  it('classifies a network failure as retryable, not unknown', async () => {
    const error = await refresh(() => {
      throw new TypeError('fetch failed');
    });
    expect(error).toMatchObject({
      retryable: true,
      outcomeUnknown: false,
      errorClass: 'network_transient',
    });
  });

  it('bounds the request with a per-request timeout signal', async () => {
    let sent: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string | URL, init?: RequestInit) => {
        sent = init?.signal ?? undefined;
        return new Response('{"access_token":"a"}', { status: 200 });
      }),
    );
    await new LinkedInPublisherAdapter().refreshAccessToken('refresh');
    expect(sent).toBeInstanceOf(AbortSignal);
    expect(sent?.aborted).toBe(false);
  });
});
