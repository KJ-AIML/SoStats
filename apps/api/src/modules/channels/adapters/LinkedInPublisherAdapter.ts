import {
  BadGatewayException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SocialPublisherPort } from '../ports/SocialPublisherPort.js';

type LinkedInUserInfo = {
  sub: string;
  name?: string;
  given_name?: string;
  family_name?: string;
};

export class LinkedInPublisherAdapter implements SocialPublisherPort {
  readonly providerName = 'linkedin';

  private clientId() {
    const value = process.env.LINKEDIN_CLIENT_ID;
    if (!value) throw new ServiceUnavailableException('LINKEDIN_CLIENT_ID is not configured');
    return value;
  }

  private clientSecret() {
    const value = process.env.LINKEDIN_CLIENT_SECRET;
    if (!value) throw new ServiceUnavailableException('LINKEDIN_CLIENT_SECRET is not configured');
    return value;
  }

  async publishPost(
    content: string,
    accessToken: string,
  ): Promise<{ postId: string; url?: string }> {
    const profile = await this.getUserInfo(accessToken);
    const response = await fetch('https://api.linkedin.com/rest/posts', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
        'linkedin-version': process.env.LINKEDIN_API_VERSION || '202601',
        'x-restli-protocol-version': '2.0.0',
      },
      body: JSON.stringify({
        author: `urn:li:person:${profile.sub}`,
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

    if (!response.ok) {
      const detail = await response.text();
      throw new BadGatewayException(
        `LinkedIn publish failed (${response.status}): ${detail.slice(0, 300)}`,
      );
    }

    const postId =
      response.headers.get('x-restli-id') ||
      response.headers.get('x-linkedin-id');

    if (!postId) {
      throw new BadGatewayException('LinkedIn did not return a post id');
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

    const response = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!response.ok) {
      throw new BadGatewayException(
        `LinkedIn token exchange failed with HTTP ${response.status}`,
      );
    }

    const token = (await response.json()) as {
      access_token: string;
      expires_in?: number;
      refresh_token?: string;
    };

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
