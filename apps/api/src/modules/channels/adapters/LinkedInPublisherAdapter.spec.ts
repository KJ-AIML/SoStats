import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('classifies a network failure after the marker as unknown', async () => {
    const error = await publish(
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    ).catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      outcomeUnknown: true,
      errorClass: 'network_transient',
    });
  });

  it('sends nothing when the marker is refused', async () => {
    const fetchMock = vi.fn();
    const context = testPublishContext({
      beforeSideEffect: vi.fn(async () => {
        throw new Error('lease lost');
      }),
    });
    await expect(publish(fetchMock, context)).rejects.toThrow('lease lost');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('classifies a refresh network failure as retryable, not unknown', async () => {
    process.env.LINKEDIN_CLIENT_ID = 'id';
    process.env.LINKEDIN_CLIENT_SECRET = 'secret';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    const error = await new LinkedInPublisherAdapter()
      .refreshAccessToken('refresh')
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      retryable: true,
      outcomeUnknown: false,
      errorClass: 'network_transient',
    });
  });
});
