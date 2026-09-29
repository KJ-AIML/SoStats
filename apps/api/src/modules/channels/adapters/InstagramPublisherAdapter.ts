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

type ContainerResponse = MetaErrorBody & {
  id?: string;
};

type ContainerStatusResponse = MetaErrorBody & {
  id?: string;
  status_code?: string;
  status?: string;
};

type PublishResponse = MetaErrorBody & {
  id?: string;
};

type PermalinkResponse = MetaErrorBody & {
  id?: string;
  permalink?: string;
};

type InstagramInsightsResponse = MetaErrorBody & {
  data?: Array<{
    name?: string;
    value?: number;
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class InstagramPublisherAdapter
  implements SocialPublisherPort, SocialAnalyticsPort
{
  readonly providerName = 'instagram';
  readonly capabilities = {
    text: true,
    images: true,
    video: false,
    carousel: false,
    analytics: true,
    nativeScheduling: false,
    requiresMedia: true,
    mediaMimeTypes: ['image/jpeg'],
    maxMediaItems: 1,
  } as const;

  constructor(private readonly meta: MetaGraphClient) {}

  private scopes() {
    return (
      process.env.META_INSTAGRAM_SCOPES ||
      [
        'pages_show_list',
        'pages_read_engagement',
        'instagram_basic',
        'instagram_content_publish',
        'instagram_manage_insights',
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
    const accounts: ProviderOAuthAccount[] = [];
    const seen = new Set<string>();

    for (const page of pages) {
      const instagramId = page.instagram_business_account?.id;
      if (!instagramId || !page.access_token || seen.has(instagramId)) {
        continue;
      }

      const profile = await this.meta.fetchInstagramProfile(
        instagramId,
        page.access_token,
      );
      seen.add(instagramId);
      accounts.push({
        accessToken: page.access_token,
        providerAccountId: instagramId,
        accountName:
          profile.username ||
          profile.name ||
          `Instagram ${instagramId}`,
      });
    }

    if (!accounts.length) {
      throw new BadGatewayException(
        'Meta OAuth succeeded but no linked Instagram Professional account was returned. Connect a Business or Creator account to a Facebook Page and grant the requested permissions.',
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
      'Instagram Page credentials do not expose a refresh token in this integration. Reconnect through Meta OAuth.',
      { retryable: false },
    );
  }

  async publishPost(
    content: string,
    accessToken: string,
    context?: PublishContext,
  ): Promise<PublishResult> {
    const instagramId = context?.providerAccountId;
    if (!instagramId) {
      throw new ProviderPublishError(
        'Instagram publishing requires a Professional account id',
      );
    }

    const media = context?.media || [];
    if (media.length !== 1) {
      throw new ProviderPublishError(
        'Instagram adapter v1 requires exactly one attached JPEG image',
      );
    }

    const image = media[0]!;
    if (image.fileType !== 'image' || image.mimeType !== 'image/jpeg') {
      throw new ProviderPublishError(
        'Instagram adapter v1 supports one JPEG image. Re-encode PNG/WebP/GIF assets to JPEG before scheduling.',
      );
    }

    const createBody = new URLSearchParams({
      image_url: image.url,
      caption: content,
      access_token: accessToken,
    });

    let createResponse: Response;
    try {
      createResponse = await fetch(
        this.meta.graphUrl(`${instagramId}/media`),
        {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: createBody,
        },
      );
    } catch {
      throw new ProviderPublishError(
        'Instagram media container request failed before a provider response was received',
        { retryable: true },
      );
    }

    const created = (await createResponse.json()) as ContainerResponse;
    if (!createResponse.ok || !created.id) {
      throw new ProviderPublishError(
        metaMessage(
          'Instagram media container creation failed',
          createResponse.status,
          created,
        ),
        {
          statusCode: createResponse.status,
          retryable: retryableMetaError(createResponse.status, created),
        },
      );
    }

    await this.waitForContainer(created.id, accessToken);

    const publishBody = new URLSearchParams({
      creation_id: created.id,
      access_token: accessToken,
    });

    let publishResponse: Response;
    try {
      publishResponse = await fetch(
        this.meta.graphUrl(`${instagramId}/media_publish`),
        {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: publishBody,
        },
      );
    } catch {
      throw new ProviderPublishError(
        'Instagram media_publish ended without a confirmed provider response',
        { outcomeUnknown: true },
      );
    }

    const published = (await publishResponse.json()) as PublishResponse;
    if (!publishResponse.ok || !published.id) {
      throw new ProviderPublishError(
        metaMessage(
          'Instagram media publish failed',
          publishResponse.status,
          published,
        ),
        {
          statusCode: publishResponse.status,
          retryable:
            publishResponse.status < 500 &&
            retryableMetaError(publishResponse.status, published),
          outcomeUnknown: publishResponse.status >= 500,
        },
      );
    }

    const url = await this.permalink(published.id, accessToken);
    return {
      postId: published.id,
      ...(url ? { url } : {}),
    };
  }

  async fetchPostMetrics(
    platformPostId: string,
    accessToken: string,
  ): Promise<SocialMetricTotals> {
    const params = new URLSearchParams({
      metric: [
        'views',
        'reach',
        'likes',
        'comments',
        'saved',
        'shares',
        'total_interactions',
      ].join(','),
      access_token: accessToken,
    });

    let response: Response;
    try {
      response = await fetch(
        `${this.meta.graphUrl(`${platformPostId}/insights`)}?${params.toString()}`,
      );
    } catch {
      throw new ProviderAnalyticsError(
        'Instagram media insights request failed before a provider response was received',
        { retryable: true },
      );
    }

    const payload = (await response.json()) as InstagramInsightsResponse;
    if (!response.ok) {
      throw new ProviderAnalyticsError(
        metaMessage('Instagram media insights failed', response.status, payload),
        {
          statusCode: response.status,
          retryable: retryableMetaError(response.status, payload),
          permissionDenied: response.status === 403,
        },
      );
    }

    const value = (name: string) => {
      const row = payload.data?.find((item) => item.name === name);
      if (typeof row?.value === 'number') return row.value;
      const candidate = row?.values?.[0]?.value;
      return typeof candidate === 'number' ? candidate : undefined;
    };

    const likes = value('likes');
    const views = value('views');

    return {
      ...(views !== undefined ? { views, impressions: views } : {}),
      ...(value('reach') !== undefined ? { reach: value('reach') } : {}),
      ...(likes !== undefined ? { likes, reactions: likes } : {}),
      ...(value('comments') !== undefined
        ? { comments: value('comments') }
        : {}),
      ...(value('saved') !== undefined ? { saves: value('saved') } : {}),
      ...(value('shares') !== undefined ? { shares: value('shares') } : {}),
    };
  }

  private async waitForContainer(
    containerId: string,
    accessToken: string,
  ) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const params = new URLSearchParams({
        fields: 'status_code,status',
        access_token: accessToken,
      });
      let response: Response;
      try {
        response = await fetch(
          `${this.meta.graphUrl(containerId)}?${params.toString()}`,
        );
      } catch {
        throw new ProviderPublishError(
          'Instagram container status request failed before a provider response was received',
          { retryable: true },
        );
      }

      const payload = (await response.json()) as ContainerStatusResponse;
      if (!response.ok) {
        throw new ProviderPublishError(
          metaMessage(
            'Instagram container status failed',
            response.status,
            payload,
          ),
          {
            statusCode: response.status,
            retryable: retryableMetaError(response.status, payload),
          },
        );
      }

      if (payload.status_code === 'FINISHED') return;
      if (payload.status_code === 'ERROR' || payload.status_code === 'EXPIRED') {
        throw new ProviderPublishError(
          `Instagram media container could not be published: ${payload.status || payload.status_code}`,
        );
      }

      await sleep(1000);
    }

    throw new ProviderPublishError(
      'Instagram media container was not ready before the worker timeout',
      { retryable: true },
    );
  }

  private async permalink(
    mediaId: string,
    accessToken: string,
  ) {
    const params = new URLSearchParams({
      fields: 'permalink',
      access_token: accessToken,
    });

    try {
      const response = await fetch(
        `${this.meta.graphUrl(mediaId)}?${params.toString()}`,
      );
      if (!response.ok) return undefined;
      const payload = (await response.json()) as PermalinkResponse;
      return payload.permalink || undefined;
    } catch {
      return undefined;
    }
  }
}
