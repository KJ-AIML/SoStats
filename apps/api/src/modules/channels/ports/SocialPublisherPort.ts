export type PublishResult = {
  postId: string;
  url?: string;
};

export type PublishMedia = {
  assetId: number;
  fileType: "image" | "video" | string;
  mimeType: string;
  fileName: string;
  url: string;
};

export type PublishContext = {
  providerAccountId?: string;
  media?: PublishMedia[];
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
  requiresMedia?: boolean;
  mediaMimeTypes?: string[];
  maxMediaItems?: number;
};

export type ProviderOAuthAccount = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  providerAccountId: string;
  accountName: string;
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
  readonly oauthPkce?: boolean;

  publishPost(
    content: string,
    accessToken: string,
    context?: PublishContext,
  ): Promise<PublishResult>;

  getAuthUrl(
    redirectUri: string,
    state: string,
    codeChallenge?: string,
  ): string;

  exchangeToken(
    code: string,
    redirectUri: string,
    codeVerifier?: string,
  ): Promise<ProviderOAuthAccount>;

  exchangeAccounts?(
    code: string,
    redirectUri: string,
    codeVerifier?: string,
  ): Promise<ProviderOAuthAccount[]>;

  refreshAccessToken(refreshToken: string): Promise<RefreshedToken>;
}
