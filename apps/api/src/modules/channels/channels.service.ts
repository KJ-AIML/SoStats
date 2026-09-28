import {
  Injectable,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import { DRIZZLE } from '../../db/db.module.js';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';
import { and, eq } from 'drizzle-orm';
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
    workspaceId: number,
    brandId: number,
    code: string,
    redirectUri: string,
  ) {
    const brand = await this.db.query.brands.findFirst({
      where: and(
        eq(schema.brands.id, brandId),
        eq(schema.brands.workspaceId, workspaceId),
      ),
    });
    if (!brand) throw new NotFoundException('Brand not found');

    const adapter = this.providerRegistry.getProvider(provider);
    const tokenData = await adapter.exchangeToken(code, redirectUri);

    const encryptedAccessToken = encrypt(tokenData.accessToken);
    const encryptedRefreshToken = tokenData.refreshToken
      ? encrypt(tokenData.refreshToken)
      : null;

    const [socialAccount] = await this.db
      .insert(schema.socialAccounts)
      .values({
        workspaceId,
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

    return {
      id: socialAccount.id,
      workspaceId: socialAccount.workspaceId,
      brandId: socialAccount.brandId,
      provider: socialAccount.provider,
      providerAccountId: socialAccount.providerAccountId,
      accountName: socialAccount.accountName,
      expiresAt: socialAccount.expiresAt,
      status: socialAccount.status,
    };
  }
}
