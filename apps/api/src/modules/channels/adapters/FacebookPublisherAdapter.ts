import {
  BadGatewayException,
  Injectable,
} from '@nestjs/common';
import {
  ProviderPublishError,
  type ProviderOAuthAccount,
  type PublishContext,
  type PublishResult,
  type RefreshedToken,
  type SocialPublisherPort,
} from '../ports/SocialPublisherPort.js';
import {
  ProviderAnalyticsError,
  type SocialAnalyticsPort,
  type SocialMetricTotals,
} from '../ports/SocialAnalyticsPort.js';
import { MetaGraphClient } from './MetaGraphClient.js';

type MetaErrorBody = {
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
    is_transient?: boolean;
  };
};

type FacebookPublishResponse = MetaErrorBody & {
  id?: string;
  post_id?: string;
};

type FacebookPostMetricsResponse = MetaErrorBody & {
  shares?: { count?: number };
  reactions?: { summary?: { total_count?: number } };
  comments?: { summary?: { total_count?: number } };
};

type FacebookInsightsResponse = MetaErrorBody & {
  data?: Array<{
    name?: string;
    values?: Array<{ value?: number }>;
  }>;
};

function retryableMetaError(status: number, body?: MetaErrorBody) {
  const code = body?.error?.code;
  return (
    status === 429 ||
    status >= 500 ||
    body?.error?.is_transient === true ||
    [4, 17, 32, 613].includes(code || 0)
  );
}

function metaMessage(
  prefix: string,
  status: number,
  body?: MetaErrorBody,
) {
  return `${prefix} (HTTP ${status}): ${body?.error?.message || 'Meta Graph API rejected the request'}`;
}

@Injectable()
export class FacebookPublisherAdapter
  implements SocialPublisherPort, SocialAnalyticsPort
{
  readonly providerName = 'facebook';
  readonly capabilities = {
    text: true,
    images: true,
    video: false,
    carousel: false,
    analytics: true,
    nativeScheduling: false,
    requiresMedia: false,
    mediaMimeTypes: [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
    ],
    maxMediaItems: 1,
  } as const;

  constructor(private readonly meta: MetaGraphClient) {}

  private scopes() {
    return (
      process.env.META_FACEBOOK_SCOPES ||
      [
        'pages_show_list',
        'pages_read_engagement',
        'pages_manage_posts',
        'read_insights',
      ].join(' ')
    );
  }

  getAuthUrl(
    redirectUri: string,
    state: string,
    _codeChallenge?: string,
  ) {
    return this.meta.getAuthUrl(redirectUri, state, this.scopes());
  }

  async exchangeAccounts(
    code: string,
    redirectUri: string,
    _codeVerifier?: string,
  ): Promise<ProviderOAuthAccount[]> {
    const userToken = await this.meta.exchangeCode(code, redirectUri);
    const pages = await this.meta.fetchManagedPages(userToken.accessToken);

    const accounts = pages
      .filter(
        (page): page is typeof page & { id: string; access_token: string } =>
          Boolean(page.id && page.access_token),
      )
      .map((page) => ({
        accessToken: page.access_token,
        providerAccountId: page.id,
        accountName: page.name || `Facebook Page ${page.id}`,
      }));

    if (!accounts.length) {
      throw new BadGatewayException(
        'Meta OAuth succeeded but no manageable Facebook Pages with access tokens were returned',
      );
    }

    return accounts;
  }

  async exchangeToken(
    code: string,
    redirectUri: string,
    codeVerifier?: string,
  ): Promise<ProviderOAuthAccount> {
    const accounts = await this.exchangeAccounts(
      code,
      redirectUri,
      codeVerifier,
    );
    return accounts[0]!;
  }

  async refreshAccessToken(
    _refreshToken: string,
  ): Promise<RefreshedToken> {
    throw new ProviderPublishError(
      'Facebook Page credentials do not expose a refresh token in this integration. Reconnect through Meta OAuth.',
      { retryable: false },
    );
  }

  async publishPost(
    content: string,
    accessToken: string,
    context?: PublishContext,
  ): Promise<PublishResult> {
    const pageId = context?.providerAccountId;
    if (!pageId) {
      throw new ProviderPublishError(
        'Facebook publishing requires a Page account id',
      );
    }

    const media = context?.media || [];
    if (media.length > 1) {
      throw new ProviderPublishError(
        'Facebook adapter v1 supports at most one attached image',
      );
    }

    const image = media[0];
    if (image && image.fileType !== 'image') {
      throw new ProviderPublishError(
        'Facebook adapter v1 does not support video publishing yet',
      );
    }
    if (
      image &&
      !this.capabilities.mediaMimeTypes.includes(
        image.mimeType as (typeof this.capabilities.mediaMimeTypes)[number],
      )
    ) {
      throw new ProviderPublishError(
        `Facebook image type ${image.mimeType} is not supported by this adapter`,
      );
    }
    if (!image && !content.trim()) {
      throw new ProviderPublishError(
        'Facebook publishing requires text or one image',
      );
    }

    const path = image ? `${pageId}/photos` : `${pageId}/feed`;
    const body = new URLSearchParams({
      access_token: accessToken,
    });
    if (image) {
      body.set('url', image.url);
      if (content.trim()) body.set('caption', content);
    } else {
      body.set('message', content);
    }

    let response: Response;
    try {
      response = await fetch(this.meta.graphUrl(path), {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
        },
        body,
      });
    } catch {
      throw new ProviderPublishError(
        'Facebook publish request ended without a confirmed provider response',
        { outcomeUnknown: true },
      );
    }

    const payload = (await response.json()) as FacebookPublishResponse;
    if (!response.ok) {
      throw new ProviderPublishError(
        metaMessage('Facebook publish failed', response.status, payload),
        {
          statusCode: response.status,
          retryable: retryableMetaError(response.status, payload),
          outcomeUnknown: response.status >= 500,
        },
      );
    }

    const postId = payload.post_id || payload.id;
    if (!postId) {
      throw new ProviderPublishError(
        'Facebook accepted the publish request but returned no post id',
        { outcomeUnknown: true },
      );
    }

    return {
      postId,
      url: `https://www.facebook.com/${postId}`,
    };
  }

  async fetchPostMetrics(
    platformPostId: string,
    accessToken: string,
  ): Promise<SocialMetricTotals> {
    const fields = [
      'shares',
      'reactions.limit(0).summary(true)',
      'comments.limit(0).summary(true)',
    ].join(',');
    const params = new URLSearchParams({
      fields,
      access_token: accessToken,
    });

    let response: Response;
    try {
      response = await fetch(
        `${this.meta.graphUrl(platformPostId)}?${params.toString()}`,
      );
    } catch {
      throw new ProviderAnalyticsError(
        'Facebook analytics request failed before a provider response was received',
        { retryable: true },
      );
    }

    const payload = (await response.json()) as FacebookPostMetricsResponse;
    if (!response.ok) {
      throw new ProviderAnalyticsError(
        metaMessage('Facebook post metrics failed', response.status, payload),
        {
          statusCode: response.status,
          retryable: retryableMetaError(response.status, payload),
          permissionDenied: response.status === 403,
        },
      );
    }

    const metrics: SocialMetricTotals = {
      shares: payload.shares?.count || 0,
      reactions: payload.reactions?.summary?.total_count || 0,
      comments: payload.comments?.summary?.total_count || 0,
    };

    const insights = new URLSearchParams({
      metric: 'post_clicks',
      period: 'lifetime',
      access_token: accessToken,
    });

    try {
      const clickResponse = await fetch(
        `${this.meta.graphUrl(`${platformPostId}/insights`)}?${insights.toString()}`,
      );
      const clickPayload =
        (await clickResponse.json()) as FacebookInsightsResponse;

      if (clickResponse.ok) {
        const clicks = clickPayload.data
          ?.find((item) => item.name === 'post_clicks')
          ?.values?.[0]?.value;
        if (typeof clicks === 'number') metrics.clicks = clicks;
      } else if (
        clickResponse.status === 403 ||
        retryableMetaError(clickResponse.status, clickPayload)
      ) {
        throw new ProviderAnalyticsError(
          metaMessage(
            'Facebook post click insights failed',
            clickResponse.status,
            clickPayload,
          ),
          {
            statusCode: clickResponse.status,
            retryable: retryableMetaError(
              clickResponse.status,
              clickPayload,
            ),
            permissionDenied: clickResponse.status === 403,
          },
        );
      }
    } catch (error) {
      if (error instanceof ProviderAnalyticsError) throw error;
      throw new ProviderAnalyticsError(
        'Facebook post click insights request failed before a provider response was received',
        { retryable: true },
      );
    }

    return metrics;
  }
}
