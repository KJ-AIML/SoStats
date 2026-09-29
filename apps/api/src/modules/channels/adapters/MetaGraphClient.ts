import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

type MetaTokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    is_transient?: boolean;
  };
};

export type MetaPageAccount = {
  id: string;
  name?: string;
  access_token?: string;
  tasks?: string[];
  instagram_business_account?: {
    id?: string;
  };
};

type MetaPageResponse = {
  data?: MetaPageAccount[];
  paging?: {
    next?: string;
  };
  error?: {
    message?: string;
    code?: number;
  };
};

type InstagramProfile = {
  id?: string;
  username?: string;
  name?: string;
  error?: {
    message?: string;
    code?: number;
  };
};

@Injectable()
export class MetaGraphClient {
  apiVersion() {
    return process.env.META_GRAPH_API_VERSION || 'v26.0';
  }

  appId() {
    const value =
      process.env.META_APP_ID || process.env.FACEBOOK_APP_ID;
    if (!value) {
      throw new ServiceUnavailableException(
        'META_APP_ID is not configured',
      );
    }
    return value;
  }

  appSecret() {
    const value =
      process.env.META_APP_SECRET || process.env.FACEBOOK_APP_SECRET;
    if (!value) {
      throw new ServiceUnavailableException(
        'META_APP_SECRET is not configured',
      );
    }
    return value;
  }

  graphUrl(path: string) {
    return `https://graph.facebook.com/${this.apiVersion()}/${path.replace(/^\//, '')}`;
  }

  getAuthUrl(
    redirectUri: string,
    state: string,
    scopes: string,
  ) {
    const params = new URLSearchParams({
      client_id: this.appId(),
      redirect_uri: redirectUri,
      state,
      response_type: 'code',
      scope: scopes,
    });

    return `https://www.facebook.com/${this.apiVersion()}/dialog/oauth?${params.toString()}`;
  }

  async exchangeCode(
    code: string,
    redirectUri: string,
  ): Promise<{ accessToken: string; expiresAt?: Date }> {
    const shortParams = new URLSearchParams({
      client_id: this.appId(),
      client_secret: this.appSecret(),
      redirect_uri: redirectUri,
      code,
    });

    const shortResponse = await fetch(
      `https://graph.facebook.com/${this.apiVersion()}/oauth/access_token?${shortParams.toString()}`,
    );
    const short = (await shortResponse.json()) as MetaTokenResponse;
    if (!shortResponse.ok || !short.access_token) {
      throw new BadGatewayException(
        `Meta OAuth token exchange failed: ${this.errorMessage(short, shortResponse.status)}`,
      );
    }

    const longParams = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: this.appId(),
      client_secret: this.appSecret(),
      fb_exchange_token: short.access_token,
    });

    const longResponse = await fetch(
      `https://graph.facebook.com/${this.apiVersion()}/oauth/access_token?${longParams.toString()}`,
    );
    const long = (await longResponse.json()) as MetaTokenResponse;
    if (!longResponse.ok || !long.access_token) {
      throw new BadGatewayException(
        `Meta long-lived token exchange failed: ${this.errorMessage(long, longResponse.status)}`,
      );
    }

    return {
      accessToken: long.access_token,
      expiresAt: long.expires_in
        ? new Date(Date.now() + long.expires_in * 1000)
        : undefined,
    };
  }

  async fetchManagedPages(userAccessToken: string) {
    const fields = [
      'id',
      'name',
      'access_token',
      'tasks',
      'instagram_business_account',
    ].join(',');

    let next: string | undefined =
      `${this.graphUrl('me/accounts')}?${new URLSearchParams({
        fields,
        limit: '100',
        access_token: userAccessToken,
      }).toString()}`;
    const pages: MetaPageAccount[] = [];
    let pageCount = 0;

    while (next && pageCount < 5) {
      const response = await fetch(next);
      const payload = (await response.json()) as MetaPageResponse;
      if (!response.ok) {
        throw new BadGatewayException(
          `Meta Page discovery failed: ${payload.error?.message || `HTTP ${response.status}`}`,
        );
      }

      pages.push(...(payload.data || []));
      next = payload.paging?.next;
      if (next) {
        const url = new URL(next);
        if (
          url.protocol !== 'https:' ||
          url.hostname !== 'graph.facebook.com'
        ) {
          throw new BadGatewayException(
            'Meta Page discovery returned an invalid pagination URL',
          );
        }
      }
      pageCount += 1;
    }

    return pages;
  }

  async fetchInstagramProfile(
    instagramAccountId: string,
    pageAccessToken: string,
  ) {
    const params = new URLSearchParams({
      fields: 'id,username,name',
      access_token: pageAccessToken,
    });
    const response = await fetch(
      `${this.graphUrl(instagramAccountId)}?${params.toString()}`,
    );
    const payload = (await response.json()) as InstagramProfile;
    if (!response.ok || !payload.id) {
      throw new BadGatewayException(
        `Instagram account discovery failed: ${payload.error?.message || `HTTP ${response.status}`}`,
      );
    }
    return payload;
  }

  private errorMessage(
    payload: MetaTokenResponse,
    status: number,
  ) {
    return payload.error?.message || `HTTP ${status}`;
  }
}
