export interface SocialPublisherPort {
  readonly providerName: string;

  publishPost(
    content: string,
    accessToken: string,
  ): Promise<{ postId: string; url?: string }>;

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
}
