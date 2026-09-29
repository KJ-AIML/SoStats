import {
  BadRequestException,
  Injectable,
  Inject,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../../db/db.module.js';
import * as schema from '../../db/schema.js';
import { encrypt } from '../../utils/encryption.util.js';
import { OAuthStateService } from './oauth-state.service.js';
import { ProviderRegistry } from './ProviderRegistry.js';

@Injectable()
export class ChannelsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly providerRegistry: ProviderRegistry,
    private readonly oauthState: OAuthStateService,
  ) {}

  async findAll(workspaceId: number) {
    const records = await this.db.query.socialAccounts.findMany({
      where: eq(schema.socialAccounts.workspaceId, workspaceId),
      columns: {
        id: true,
        workspaceId: true,
        brandId: true,
        provider: true,
        providerAccountId: true,
        accountName: true,
        expiresAt: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
      with: {
        channelRules: true,
      },
      orderBy: (fields, { desc }) => [desc(fields.createdAt)],
    });

    return records.map((record) => ({
      ...record,
      ...this.providerRegistry.describeProvider(record.provider),
    }));
  }

  providers() {
    return this.providerRegistry.listProviders();
  }

  async startOAuth(
    provider: string,
    workspaceId: number,
    brandId: number,
    returnTo: string,
  ) {
    if (!this.oauthState.validReturnTo(returnTo)) {
      throw new BadRequestException('OAuth return path is invalid');
    }

    const brand = await this.db.query.brands.findFirst({
      where: and(
        eq(schema.brands.id, brandId),
        eq(schema.brands.workspaceId, workspaceId),
      ),
    });
    if (!brand) throw new NotFoundException('Brand not found');

    const adapter = this.providerRegistry.getProvider(provider);
    const redirectUri = this.callbackUrl();

    const codeVerifier = adapter.oauthPkce
      ? randomBytes(32).toString('base64url')
      : undefined;
    const codeChallenge = codeVerifier
      ? createHash('sha256')
          .update(codeVerifier)
          .digest('base64url')
      : undefined;

    const state = this.oauthState.seal({
      workspaceId,
      brandId,
      provider: adapter.providerName,
      redirectUri,
      returnTo,
      codeVerifier,
    });

    return {
      provider: adapter.providerName,
      authorizationUrl: adapter.getAuthUrl(
        redirectUri,
        state,
        codeChallenge,
      ),
      expiresInSeconds: 600,
    };
  }

  async completeOAuth(
    stateValue: string,
    code?: string,
    oauthError?: string,
    oauthErrorDescription?: string,
  ) {
    const state = this.oauthState.open(stateValue);

    if (oauthError) {
      return {
        redirectUrl: this.returnUrl(state.returnTo, {
          channelError: oauthErrorDescription || oauthError,
          provider: state.provider,
        }),
      };
    }

    if (!code) {
      throw new BadRequestException('OAuth callback is missing code');
    }

    const brand = await this.db.query.brands.findFirst({
      where: and(
        eq(schema.brands.id, state.brandId),
        eq(schema.brands.workspaceId, state.workspaceId),
      ),
    });
    if (!brand) throw new NotFoundException('Brand not found');

    const adapter = this.providerRegistry.getProvider(state.provider);
    const tokenData = await adapter.exchangeToken(
      code,
      state.redirectUri,
      state.codeVerifier,
    );

    const encryptedAccessToken = encrypt(tokenData.accessToken);
    const encryptedRefreshToken = tokenData.refreshToken
      ? encrypt(tokenData.refreshToken)
      : null;

    const existing = await this.db.query.socialAccounts.findFirst({
      where: and(
        eq(schema.socialAccounts.workspaceId, state.workspaceId),
        eq(schema.socialAccounts.provider, adapter.providerName),
        eq(
          schema.socialAccounts.providerAccountId,
          tokenData.providerAccountId,
        ),
      ),
    });

    let account: typeof schema.socialAccounts.$inferSelect;
    if (existing) {
      const [updated] = await this.db
        .update(schema.socialAccounts)
        .set({
          brandId: state.brandId,
          accountName: tokenData.accountName,
          accessToken: encryptedAccessToken,
          refreshToken:
            encryptedRefreshToken || existing.refreshToken,
          expiresAt: tokenData.expiresAt,
          status: 'active',
          updatedAt: new Date(),
        })
        .where(eq(schema.socialAccounts.id, existing.id))
        .returning();
      account = updated;
    } else {
      const [created] = await this.db
        .insert(schema.socialAccounts)
        .values({
          workspaceId: state.workspaceId,
          brandId: state.brandId,
          provider: adapter.providerName,
          providerAccountId: tokenData.providerAccountId,
          accountName: tokenData.accountName,
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          expiresAt: tokenData.expiresAt,
          status: 'active',
        })
        .returning();
      account = created;
    }

    return {
      account: {
        id: account.id,
        workspaceId: account.workspaceId,
        brandId: account.brandId,
        provider: account.provider,
        providerAccountId: account.providerAccountId,
        accountName: account.accountName,
        expiresAt: account.expiresAt,
        status: account.status,
        supported: true,
        capabilities: adapter.capabilities,
      },
      redirectUrl: this.returnUrl(state.returnTo, {
        connected: adapter.providerName,
      }),
    };
  }

  private callbackUrl() {
    const value =
      process.env.OAUTH_CALLBACK_URL ||
      (process.env.NODE_ENV !== 'production'
        ? 'http://localhost:4000/v1/channels/oauth/callback'
        : undefined);

    if (!value) {
      throw new ServiceUnavailableException(
        'OAUTH_CALLBACK_URL must be configured in production',
      );
    }

    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new ServiceUnavailableException(
        'OAUTH_CALLBACK_URL must use HTTP or HTTPS',
      );
    }
    return url.toString();
  }

  private webAppUrl() {
    const fallbackOrigin = (process.env.CORS_ORIGIN || '')
      .split(',')[0]
      ?.trim();
    const value =
      process.env.WEB_APP_URL ||
      fallbackOrigin ||
      (process.env.NODE_ENV !== 'production'
        ? 'http://localhost:3000'
        : undefined);

    if (!value) {
      throw new ServiceUnavailableException(
        'WEB_APP_URL must be configured in production',
      );
    }

    const url = new URL(value);
    return url.origin;
  }

  private returnUrl(
    returnTo: string,
    params: Record<string, string>,
  ) {
    if (!this.oauthState.validReturnTo(returnTo)) {
      throw new BadRequestException('OAuth return path is invalid');
    }

    const url = new URL(returnTo, this.webAppUrl());
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value.slice(0, 300));
    }
    return url.toString();
  }
}
