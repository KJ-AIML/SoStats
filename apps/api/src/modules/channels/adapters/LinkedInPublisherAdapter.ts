import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ProviderPublishError,
  SocialPublisherPort,
  type PublishContext,
  type PublishResult,
  type RefreshedToken,
} from '../ports/SocialPublisherPort.js';

type LinkedInUserInfo = {
  sub: string;
  name?: string;
  given_name?: string;
  family_name?: string;
};

type LinkedInTokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
};

@Injectable()
export class LinkedInPublisherAdapter implements SocialPublisherPort {
  readonly providerName = 'linkedin';

  private clientId() {
    const value = process.env.LINKEDIN_CLIENT_ID;
    if (!value) {
      throw new ServiceUnavailableException(
        'LINKEDIN_CLIENT_ID is not configured',
      );
    }
    return value;
  }

  private clientSecret() {
    const value = process.env.LINKEDIN_CLIENT_SECRET;
    if (!value) {
      throw new ServiceUnavailableException(
        'LINKEDIN_CLIENT_SECRET is not configured',
      );
    }
    return value;
  }

  private apiVersion() {
    const value = process.env.LINKEDIN_API_VERSION;
    if (!value) {
      throw new ServiceUnavailableException(
        'LINKEDIN_API_VERSION is not configured',
      );
    }
    return value;
  }

  async publishPost(
    content: string,
    accessToken: string,
    context?: PublishContext,
  ): Promise<PublishResult> {
    const providerAccountId =
      context?.providerAccountId || (await this.getUserInfo(accessToken)).sub;

    let response: Response;
    try {
      response = await fetch('https://api.linkedin.com/rest/posts', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
          'linkedin-version': this.apiVersion(),
          'x-restli-protocol-version': '2.0.0',
        },
        body: JSON.stringify({
          author: `urn:li:person:${providerAccountId}`,
          commentary: content,
          visibility: 'PUBLIC',
          distribution: {
            feedDistribution: 'MAIN_FEED',
            targetEntities: [],
            thirdPartyDistributionChannels: [],
          },
          lifecycleState: 'PUBLISHED',
          isReshareDisabledByAuthor: false,
        }),
      });
    } catch {
      throw new ProviderPublishError(
        'LinkedIn publish request ended without a confirmed provider response',
        { outcomeUnknown: true },
      );
    }

    if (!response.ok) {
      const detail = await response.text();
      const isRateLimit = response.status === 429;
      const isServerError = response.status >= 500;

      throw new ProviderPublishError(
        `LinkedIn publish failed (HTTP ${response.status}): ${detail.slice(0, 300)}`,
        {
          statusCode: response.status,
          retryable: isRateLimit,
          outcomeUnknown: isServerError,
        },
      );
    }

    const postId =
      response.headers.get('x-restli-id') ||
      response.headers.get('x-linkedin-id');

    if (!postId) {
      throw new ProviderPublishError(
        'LinkedIn accepted the publish request but did not return a post id',
        { outcomeUnknown: true },
      );
    }

    return { postId };
  }

  getAuthUrl(redirectUri: string): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId(),
      redirect_uri: redirectUri,
      state: crypto.randomUUID(),
      scope: 'openid profile email w_member_social',
    });

    return `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
  }

  async exchangeToken(
    code: string,
    redirectUri: string,
  ): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
    providerAccountId: string;
    accountName: string;
  }> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: this.clientId(),
      client_secret: this.clientSecret(),
    });

    const response = await fetch(
      'https://www.linkedin.com/oauth/v2/accessToken',
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      },
    );

    if (!response.ok) {
      throw new BadGatewayException(
        `LinkedIn token exchange failed with HTTP ${response.status}`,
      );
    }

    const token = (await response.json()) as LinkedInTokenResponse;
    if (!token.access_token) {
      throw new BadGatewayException('LinkedIn token exchange returned no access token');
    }

    const profile = await this.getUserInfo(token.access_token);

    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: token.expires_in
        ? new Date(Date.now() + token.expires_in * 1000)
        : undefined,
      providerAccountId: profile.sub,
      accountName:
        profile.name ||
        [profile.given_name, profile.family_name].filter(Boolean).join(' ') ||
        'LinkedIn account',
    };
  }

  async refreshAccessToken(refreshToken: string): Promise<RefreshedToken> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.clientId(),
      client_secret: this.clientSecret(),
    });

    let response: Response;
    try {
      response = await fetch(
        'https://www.linkedin.com/oauth/v2/accessToken',
        {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body,
        },
      );
    } catch {
      throw new ProviderPublishError(
        'LinkedIn token refresh request failed before a provider response was received',
        { retryable: true },
      );
    }

    if (!response.ok) {
      const detail = await response.text();
      throw new ProviderPublishError(
        `LinkedIn token refresh failed (HTTP ${response.status}): ${detail.slice(0, 300)}`,
        {
          statusCode: response.status,
          retryable: response.status === 429 || response.status >= 500,
        },
      );
    }

    const token = (await response.json()) as LinkedInTokenResponse;
    if (!token.access_token) {
      throw new ProviderPublishError(
        'LinkedIn token refresh returned no access token',
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

  private async getUserInfo(accessToken: string): Promise<LinkedInUserInfo> {
    const response = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      throw new BadGatewayException(
        `LinkedIn userinfo failed with HTTP ${response.status}`,
      );
    }

    return (await response.json()) as LinkedInUserInfo;
  }
}
