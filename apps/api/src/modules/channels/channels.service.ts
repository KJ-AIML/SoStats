import {
  BadRequestException,
  Injectable,
  Inject,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../../db/db.module.js';
import * as schema from '../../db/schema.js';
import { encrypt } from '../../utils/encryption.util.js';
import { OAuthStateService } from './oauth-state.service.js';
import { ProviderRegistry } from './ProviderRegistry.js';
import { ChannelCredentialService } from './channel-credential.service.js';
import {
  ACTIVE_PUBLICATION_STATUSES,
  CREDENTIAL_DEPENDENT_PUBLICATION_STATUSES,
  isStatusIn,
} from '../publishing/publication-state.js';

@Injectable()
export class ChannelsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly providerRegistry: ProviderRegistry,
    private readonly oauthState: OAuthStateService,
    private readonly credentials: ChannelCredentialService,
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
        accessToken: true,
        refreshToken: true,
        expiresAt: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
      with: {
        brand: {
          columns: { id: true, name: true },
        },
        channelRules: true,
      },
      orderBy: (fields, { desc }) => [desc(fields.createdAt)],
    });

    const accountIds = records.map((record) => record.id);
    const schedules = accountIds.length
      ? await this.db.query.scheduledPublications.findMany({
          where: and(
            eq(schema.scheduledPublications.workspaceId, workspaceId),
            inArray(schema.scheduledPublications.socialAccountId, accountIds),
          ),
          columns: {
            id: true,
            socialAccountId: true,
            status: true,
            scheduledAt: true,
          },
          orderBy: (fields, { desc }) => [desc(fields.scheduledAt)],
          limit: 2000,
        })
      : [];

    const snapshots = accountIds.length
      ? await this.db.query.metricSnapshots.findMany({
          where: inArray(schema.metricSnapshots.socialAccountId, accountIds),
          columns: {
            id: true,
            socialAccountId: true,
            snapshotAt: true,
          },
          orderBy: (fields, { desc }) => [desc(fields.snapshotAt)],
          limit: 2000,
        })
      : [];

    const now = Date.now();
    const expiringSoonAt = now + 24 * 60 * 60 * 1000;

    return records.map((record) => {
      const provider = this.providerRegistry.describeProvider(record.provider);
      const accountSchedules = schedules.filter(
        (schedule) => schedule.socialAccountId === record.id,
      );
      const latestPublished = accountSchedules.find(
        (schedule) => schedule.status === 'published',
      );
      const activeSchedules = accountSchedules.filter((schedule) =>
        isStatusIn(schedule.status, ACTIVE_PUBLICATION_STATUSES),
      );
      const disconnectBlockingSchedules = accountSchedules.filter((schedule) =>
        isStatusIn(schedule.status, CREDENTIAL_DEPENDENT_PUBLICATION_STATUSES),
      );
      const latestSnapshot = snapshots.find(
        (snapshot) => snapshot.socialAccountId === record.id,
      );

      const expiresAtMs = record.expiresAt?.getTime();
      const hasAccessToken = Boolean(record.accessToken);
      const hasRefreshToken = Boolean(record.refreshToken);
      let credentialState:
        | 'active'
        | 'no_expiry'
        | 'expiring'
        | 'refresh_required'
        | 'expired'
        | 'disconnected'
        | 'missing_token';

      if (record.status === 'disconnected') {
        credentialState = 'disconnected';
      } else if (!hasAccessToken) {
        credentialState = 'missing_token';
      } else if (!expiresAtMs) {
        credentialState = 'no_expiry';
      } else if (expiresAtMs <= now) {
        credentialState = hasRefreshToken ? 'refresh_required' : 'expired';
      } else if (expiresAtMs <= expiringSoonAt) {
        credentialState = 'expiring';
      } else {
        credentialState = 'active';
      }

      const credentialUsable =
        record.status === 'active' &&
        hasAccessToken &&
        (!expiresAtMs || expiresAtMs > now);

      return {
        id: record.id,
        workspaceId: record.workspaceId,
        brandId: record.brandId,
        brand: record.brand,
        provider: record.provider,
        providerAccountId: record.providerAccountId,
        accountName: record.accountName,
        expiresAt: record.expiresAt,
        status: record.status,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        channelRules: record.channelRules,
        ...provider,
        credentialState,
        hasRefreshToken,
        publishingReady:
          provider.supported &&
          Boolean(provider.capabilities?.text) &&
          credentialUsable,
        analyticsReady:
          provider.supported &&
          Boolean(provider.capabilities?.analytics) &&
          credentialUsable,
        activeScheduleCount: activeSchedules.length,
        disconnectBlockingScheduleCount: disconnectBlockingSchedules.length,
        publishedCount: accountSchedules.filter(
          (schedule) => schedule.status === 'published',
        ).length,
        lastPublishedAt: latestPublished?.scheduledAt || null,
        latestAnalyticsAt: latestSnapshot?.snapshotAt || null,
      };
    });
  }

  providers() {
    return this.providerRegistry.listProviders().map((provider) => ({
      ...provider,
      oauth: {
        pkce: Boolean(
          this.providerRegistry.getProvider(provider.provider).oauthPkce,
        ),
      },
    }));
  }

  async refreshCredentials(workspaceId: number, accountId: number) {
    const account = await this.requireAccount(workspaceId, accountId);
    if (account.status === 'disconnected') {
      throw new BadRequestException(
        'Disconnected channels must be reconnected through OAuth',
      );
    }

    const adapter = this.providerRegistry.getProvider(account.provider);
    await this.credentials.getValidAccessToken(account, adapter);

    const refreshed = await this.requireAccount(workspaceId, accountId);
    return {
      id: refreshed.id,
      status: refreshed.status,
      expiresAt: refreshed.expiresAt,
      updatedAt: refreshed.updatedAt,
    };
  }

  async disconnect(workspaceId: number, accountId: number) {
    const account = await this.requireAccount(workspaceId, accountId);
    const activeSchedule = await this.db.query.scheduledPublications.findFirst({
      where: and(
        eq(schema.scheduledPublications.workspaceId, workspaceId),
        eq(schema.scheduledPublications.socialAccountId, accountId),
        inArray(schema.scheduledPublications.status, [
          ...CREDENTIAL_DEPENDENT_PUBLICATION_STATUSES,
        ]),
      ),
    });
    if (activeSchedule) {
      throw new BadRequestException(
        'Cancel or move active scheduled publications before disconnecting this channel',
      );
    }

    const [updated] = await this.db
      .update(schema.socialAccounts)
      .set({
        accessToken: null,
        refreshToken: null,
        expiresAt: null,
        status: 'disconnected',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.socialAccounts.id, accountId),
          eq(schema.socialAccounts.workspaceId, workspaceId),
        ),
      )
      .returning();

    return {
      id: updated.id,
      status: updated.status,
      updatedAt: updated.updatedAt,
    };
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
      ? createHash('sha256').update(codeVerifier).digest('base64url')
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
      authorizationUrl: adapter.getAuthUrl(redirectUri, state, codeChallenge),
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
    const tokenData = adapter.exchangeAccounts
      ? await adapter.exchangeAccounts(
          code,
          state.redirectUri,
          state.codeVerifier,
        )
      : [
          await adapter.exchangeToken(
            code,
            state.redirectUri,
            state.codeVerifier,
          ),
        ];

    if (!tokenData.length) {
      throw new BadRequestException(
        `${adapter.providerName} OAuth returned no connectable accounts`,
      );
    }

    const accounts: Array<typeof schema.socialAccounts.$inferSelect> = [];
    for (const connection of tokenData) {
      const encryptedAccessToken = encrypt(connection.accessToken);
      const encryptedRefreshToken = connection.refreshToken
        ? encrypt(connection.refreshToken)
        : null;

      const existing = await this.db.query.socialAccounts.findFirst({
        where: and(
          eq(schema.socialAccounts.workspaceId, state.workspaceId),
          eq(schema.socialAccounts.provider, adapter.providerName),
          eq(
            schema.socialAccounts.providerAccountId,
            connection.providerAccountId,
          ),
        ),
      });

      if (existing) {
        const [updated] = await this.db
          .update(schema.socialAccounts)
          .set({
            brandId: state.brandId,
            accountName: connection.accountName,
            accessToken: encryptedAccessToken,
            refreshToken: encryptedRefreshToken || existing.refreshToken,
            expiresAt: connection.expiresAt,
            status: 'active',
            updatedAt: new Date(),
          })
          .where(eq(schema.socialAccounts.id, existing.id))
          .returning();
        accounts.push(updated);
      } else {
        const [created] = await this.db
          .insert(schema.socialAccounts)
          .values({
            workspaceId: state.workspaceId,
            brandId: state.brandId,
            provider: adapter.providerName,
            providerAccountId: connection.providerAccountId,
            accountName: connection.accountName,
            accessToken: encryptedAccessToken,
            refreshToken: encryptedRefreshToken,
            expiresAt: connection.expiresAt,
            status: 'active',
          })
          .returning();
        accounts.push(created);
      }
    }

    return {
      accounts: accounts.map((account) => ({
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
      })),
      redirectUrl: this.returnUrl(state.returnTo, {
        connected: adapter.providerName,
        connectedCount: String(accounts.length),
      }),
    };
  }

  private async requireAccount(workspaceId: number, accountId: number) {
    const account = await this.db.query.socialAccounts.findFirst({
      where: and(
        eq(schema.socialAccounts.id, accountId),
        eq(schema.socialAccounts.workspaceId, workspaceId),
      ),
    });
    if (!account) throw new NotFoundException('Channel account not found');
    return account;
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

  private returnUrl(returnTo: string, params: Record<string, string>) {
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
