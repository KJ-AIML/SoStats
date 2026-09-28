import { Injectable, Inject } from '@nestjs/common';
import { DRIZZLE } from '../../db/db.module.js';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';
import { encrypt } from '../../utils/encryption.util.js';
import { ProviderRegistry } from './ProviderRegistry.js';

@Injectable()
export class ChannelsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly providerRegistry: ProviderRegistry,
  ) {}

  async connectProvider(
    provider: string,
    brandId: number,
    code: string,
    redirectUri: string,
  ) {
    const adapter = this.providerRegistry.getProvider(provider);

    // Exchange token using the provider adapter
    const tokenData = await adapter.exchangeToken(code, redirectUri);

    // Encrypt tokens
    const encryptedAccessToken = encrypt(tokenData.accessToken);
    const encryptedRefreshToken = tokenData.refreshToken
      ? encrypt(tokenData.refreshToken)
      : null;

    // Save to DB
    const [socialAccount] = await this.db
      .insert(schema.socialAccounts)
      .values({
        brandId,
        provider: adapter.providerName,
        providerAccountId: tokenData.providerAccountId,
        accountName: tokenData.accountName,
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        expiresAt: tokenData.expiresAt,
        status: 'active',
      })
      .returning();

    return socialAccount;
  }
}
