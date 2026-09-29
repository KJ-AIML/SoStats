import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ProviderPublishError,
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
import { httpErrorClass, providerSignal, readJson } from './provider-http.js';

type XTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
};

type XUserResponse = {
  data?: {
    id?: string;
    name?: string;
    username?: string;
  };
};

type XPostResponse = {
  data?: {
    id?: string;
    text?: string;
  };
};

type XMetricsResponse = {
  data?: {
    public_metrics?: {
      retweet_count?: number;
      reply_count?: number;
      like_count?: number;
      quote_count?: number;
      bookmark_count?: number;
      impression_count?: number;
    };
    non_public_metrics?: {
      url_link_clicks?: number;
      user_profile_clicks?: number;
      engagements?: number;
    };
  };
};

@Injectable()
export class XPublisherAdapter
  implements SocialPublisherPort, SocialAnalyticsPort
{
  readonly providerName = 'x';
  readonly oauthPkce = true;
  readonly capabilities = {
    text: true,
    images: false,
    video: false,
    carousel: false,
    analytics: true,
    nativeScheduling: false,
  } as const;

  private clientId() {
    const value = process.env.X_CLIENT_ID;
    if (!value) {
      throw new ServiceUnavailableException('X_CLIENT_ID is not configured');
    }
    return value;
  }

  private clientSecret() {
    const value = process.env.X_CLIENT_SECRET;
    if (!value) {
      throw new ServiceUnavailableException(
        'X_CLIENT_SECRET is not configured',
      );
    }
    return value;
  }

  private scopes() {
    return (
      process.env.X_SCOPES ||
      'tweet.read tweet.write users.read offline.access'
    );
  }

  private basicAuth() {
    return (
      'Basic ' +
      Buffer.from(
        `${this.clientId()}:${this.clientSecret()}`,
        'utf8',
      ).toString('base64')
    );
  }

  getAuthUrl(
    redirectUri: string,
    state: string,
    codeChallenge?: string,
  ) {
    if (!codeChallenge) {
      throw new ServiceUnavailableException(
        'X OAuth requires a PKCE code challenge',
      );
    }

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId(),
      redirect_uri: redirectUri,
      scope: this.scopes(),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    return `https://x.com/i/oauth2/authorize?${params.toString()}`;
  }

  async exchangeToken(
    code: string,
    redirectUri: string,
    codeVerifier?: string,
  ) {
    if (!codeVerifier) {
      throw new BadGatewayException(
        'X OAuth callback is missing the PKCE verifier',
      );
    }

    const body = new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    });

    const response = await fetch('https://api.x.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        authorization: this.basicAuth(),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new BadGatewayException(
        `X token exchange failed (HTTP ${response.status}): ${detail.slice(0, 300)}`,
      );
    }

    const token = (await response.json()) as XTokenResponse;
    if (!token.access_token) {
      throw new BadGatewayException(
        'X token exchange returned no access token',
      );
    }

    const profile = await this.getUser(token.access_token);
    if (!profile.id) {
      throw new BadGatewayException('X user lookup returned no account id');
    }

    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: token.expires_in
        ? new Date(Date.now() + token.expires_in * 1000)
        : undefined,
      providerAccountId: profile.id,
      accountName: profile.username
        ? `@${profile.username}`
        : profile.name || 'X account',
    };
  }

  async refreshAccessToken(refreshToken: string): Promise<RefreshedToken> {
    const body = new URLSearchParams({
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });

    let response: Response;
    try {
      response = await fetch('https://api.x.com/2/oauth2/token', {
        method: 'POST',
        headers: {
          authorization: this.basicAuth(),
          'content-type': 'application/x-www-form-urlencoded',
        },
        body,
        signal: providerSignal(),
      });
    } catch {
      throw new ProviderPublishError(
        'X token refresh request failed before a provider response was received',
        { retryable: true, errorClass: 'network_transient' },
      );
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new ProviderPublishError(
        `X token refresh failed (HTTP ${response.status}): ${detail.slice(0, 300)}`,
        {
          statusCode: response.status,
          errorClass: httpErrorClass(response.status),
          retryable: response.status === 429 || response.status >= 500,
        },
      );
    }

    const token = await readJson<XTokenResponse>(response);
    if (!token?.access_token) {
      throw new ProviderPublishError(
        'X token refresh returned no access token',
        { retryable: true, errorClass: 'transient_provider' },
      );
    }

    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: token.expires_in
        ? new Date(Date.now() + token.expires_in * 1000)
        : undefined,
    };
  }

  async publishPost(
    content: string,
    accessToken: string,
    context: PublishContext,
  ): Promise<PublishResult> {
    await context.beforeSideEffect({ operationType: 'x_create_post' });

    let response: Response;
    try {
      response = await fetch('https://api.x.com/2/tweets', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ text: content }),
        signal: providerSignal(context.signal),
      });
    } catch {
      throw new ProviderPublishError(
        'X publish request ended without a confirmed provider response',
        { outcomeUnknown: true, errorClass: 'network_transient' },
      );
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new ProviderPublishError(
        `X publish failed (HTTP ${response.status}): ${detail.slice(0, 300)}`,
        {
          statusCode: response.status,
          errorClass: httpErrorClass(response.status),
          retryable: response.status === 429,
          outcomeUnknown: response.status >= 500,
        },
      );
    }

    const payload = await readJson<XPostResponse>(response);
    const postId = payload?.data?.id;
    if (!postId) {
      throw new ProviderPublishError(
        'X accepted the publish request but returned no readable post id',
        { outcomeUnknown: true, errorClass: 'unknown_outcome' },
      );
    }

    return { postId, url: `https://x.com/i/web/status/${postId}` };
  }

  async fetchPostMetrics(
    platformPostId: string,
    accessToken: string,
  ): Promise<SocialMetricTotals> {
    if (!/^\d{1,30}$/.test(platformPostId)) {
      throw new ProviderAnalyticsError('X post id is invalid');
    }

    let response = await this.fetchMetrics(
      platformPostId,
      accessToken,
      'public_metrics,non_public_metrics',
    );

    if (response.status === 400 || response.status === 403) {
      response = await this.fetchMetrics(
        platformPostId,
        accessToken,
        'public_metrics',
      );
    }

    if (!response.ok) {
      const detail = await response.text();
      throw new ProviderAnalyticsError(
        `X analytics failed (HTTP ${response.status}): ${detail.slice(0, 300)}`,
        {
          statusCode: response.status,
          retryable: response.status === 429 || response.status >= 500,
          permissionDenied: response.status === 401 || response.status === 403,
        },
      );
    }

    const payload = (await response.json()) as XMetricsResponse;
    const publicMetrics = payload.data?.public_metrics || {};
    const privateMetrics = payload.data?.non_public_metrics || {};

    return {
      impressions: publicMetrics.impression_count || 0,
      reactions: publicMetrics.like_count || 0,
      comments: publicMetrics.reply_count || 0,
      shares:
        (publicMetrics.retweet_count || 0) +
        (publicMetrics.quote_count || 0),
      saves: publicMetrics.bookmark_count || 0,
      clicks: privateMetrics.url_link_clicks || 0,
    };
  }

  private fetchMetrics(
    postId: string,
    accessToken: string,
    fields: string,
  ) {
    const params = new URLSearchParams({ 'tweet.fields': fields });
    return fetch(
      `https://api.x.com/2/tweets/${postId}?${params.toString()}`,
      {
        headers: { authorization: `Bearer ${accessToken}` },
      },
    );
  }

  private async getUser(accessToken: string) {
    const response = await fetch(
      'https://api.x.com/2/users/me?user.fields=name,username',
      {
        headers: { authorization: `Bearer ${accessToken}` },
      },
    );
    if (!response.ok) {
      const detail = await response.text();
      throw new BadGatewayException(
        `X user lookup failed (HTTP ${response.status}): ${detail.slice(0, 300)}`,
      );
    }
    const payload = (await response.json()) as XUserResponse;
    return payload.data || {};
  }
}
