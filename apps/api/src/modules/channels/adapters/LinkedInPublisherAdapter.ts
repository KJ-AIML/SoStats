import { SocialPublisherPort } from '../ports/SocialPublisherPort.js';

export class LinkedInPublisherAdapter implements SocialPublisherPort {
  readonly providerName = 'linkedin';

  async publishPost(
    content: string,
    accessToken: string,
  ): Promise<{ postId: string; url?: string }> {
    // Dummy implementation
    console.log(
      `[LinkedIn] Publishing post: ${content} with token: ${accessToken}`,
    );
    return {
      postId: `urn:li:share:${Math.floor(Math.random() * 1000000)}`,
      url: 'https://linkedin.com/post/dummy',
    };
  }

  getAuthUrl(redirectUri: string): string {
    // Dummy implementation
    return `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=dummy&redirect_uri=${encodeURIComponent(
      redirectUri,
    )}&state=dummy_state&scope=r_liteprofile%20r_emailaddress%20w_member_social`;
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
    // Dummy implementation
    return {
      accessToken: `dummy_access_token_for_${code}`,
      refreshToken: `dummy_refresh_token_for_${code}`,
      expiresAt: new Date(Date.now() + 3600 * 1000), // 1 hour from now
      providerAccountId: `li_acc_${Math.floor(Math.random() * 1000)}`,
      accountName: 'Dummy LinkedIn User',
    };
  }
}
