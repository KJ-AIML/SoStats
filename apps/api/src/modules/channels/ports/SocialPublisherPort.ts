export type PublishResult = {
  postId: string;
  url?: string;
};

export type PublishContext = {
  providerAccountId?: string;
};

export type RefreshedToken = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
};

export type ProviderCapabilities = {
  text: boolean;
  images: boolean;
  video: boolean;
  carousel: boolean;
  analytics: boolean;
  nativeScheduling: boolean;
};

export class ProviderPublishError extends Error {
  readonly retryable: boolean;
  readonly outcomeUnknown: boolean;
  readonly statusCode?: number;

  constructor(
    message: string,
    options: {
      retryable?: boolean;
      outcomeUnknown?: boolean;
      statusCode?: number;
    } = {},
  ) {
    super(message);
    this.name = 'ProviderPublishError';
    this.retryable = options.retryable ?? false;
    this.outcomeUnknown = options.outcomeUnknown ?? false;
    this.statusCode = options.statusCode;
  }
}

export interface SocialPublisherPort {
  readonly providerName: string;
  readonly capabilities: ProviderCapabilities;

  publishPost(
    content: string,
    accessToken: string,
    context?: PublishContext,
  ): Promise<PublishResult>;

  getAuthUrl(redirectUri: string): string;

  exchangeToken(
    code: string,
    redirectUri: string,
  ): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
    providerAccountId: string;
    accountName: string;
  }>;

  refreshAccessToken(refreshToken: string): Promise<RefreshedToken>;
}
