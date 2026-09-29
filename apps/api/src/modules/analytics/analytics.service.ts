import {
  BadRequestException,
  Injectable,
  Inject,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  and,
  eq,
  gte,
  inArray,
  isNotNull,
  lt,
  sql,
} from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../../db/db.module.js';
import * as schema from '../../db/schema.js';
import { ProviderRegistry } from '../channels/ProviderRegistry.js';
import { ChannelCredentialService } from '../channels/channel-credential.service.js';
import { ProviderAnalyticsError } from '../channels/ports/SocialAnalyticsPort.js';
import { ProviderPublishError } from '../channels/ports/SocialPublisherPort.js';

type NumericMetrics = Record<string, number>;

type DispatchableAnalytics = {
  publicationResultId: number;
  contentItemId: number;
  socialAccountId: number;
  provider: string;
  platformPostId: string;
  expectedSnapshotAt: string | null;
  revision: string;
  dueAt: string;
};

type IngestResult =
  | {
      status: 'ingested';
      publicationResultId: number;
      snapshotId: number;
      metrics: NumericMetrics;
      delta: NumericMetrics;
    }
  | {
      status: 'stale' | 'not_due' | 'not_supported';
      publicationResultId: number;
    }
  | {
      status: 'failed_terminal';
      publicationResultId: number;
      reason: string;
      permissionDenied?: boolean;
    };

export function calendarDayInZone(
  timeZone: string,
  date = new Date(),
) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const value = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<string, number>;

  return new Date(Date.UTC(value.year, value.month - 1, value.day));
}

export function asNumericMetrics(value: unknown): NumericMetrics {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === 'number' && Number.isFinite(entry[1]),
    ),
  );
}

export function subtractMetrics(current: NumericMetrics, previous: NumericMetrics) {
  return Object.fromEntries(
    Object.entries(current).map(([key, value]) => [
      key,
      value - (previous[key] || 0),
    ]),
  );
}

export function addMetrics(current: NumericMetrics, delta: NumericMetrics) {
  const result = { ...current };
  for (const [key, value] of Object.entries(delta)) {
    result[key] = (result[key] || 0) + value;
  }
  return result;
}

export function analyticsIntervalMs(postAgeMs: number) {
  const hour = 60 * 60_000;
  const day = 24 * hour;

  if (postAgeMs < 24 * hour) return hour;
  if (postAgeMs < 7 * day) return 6 * hour;
  if (postAgeMs < 30 * day) return day;
  return null;
}

@Injectable()
export class AnalyticsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly providerRegistry: ProviderRegistry,
    private readonly credentials: ChannelCredentialService,
  ) {}

  async getOverview(
    workspaceId: number,
    options: { days?: number; channel?: string } = {},
  ) {
    const days = options.days ?? 30;
    if (![7, 30, 90].includes(days)) {
      throw new BadRequestException('days must be one of 7, 30, or 90');
    }

    const selectedChannel = options.channel?.trim().toLowerCase() || 'all';
    const workspace = await this.db.query.workspaces.findFirst({
      where: eq(schema.workspaces.id, workspaceId),
      columns: { timezone: true },
    });
    const windowEnd = new Date();
    const start = calendarDayInZone(workspace?.timezone || 'UTC', windowEnd);
    start.setUTCDate(start.getUTCDate() - (days - 1));

    const accounts = await this.db.query.socialAccounts.findMany({
      where: eq(schema.socialAccounts.workspaceId, workspaceId),
      columns: {
        id: true,
        provider: true,
        accountName: true,
        status: true,
      },
    });

    const analyticsAccounts = accounts.filter((account) => {
      const provider = this.providerRegistry.describeProvider(account.provider);
      return Boolean(provider.capabilities?.analytics);
    });
    const availableChannels = [
      ...new Set(analyticsAccounts.map((account) => account.provider)),
    ].sort();

    if (
      selectedChannel !== 'all' &&
      !availableChannels.some(
        (provider) => provider.toLowerCase() === selectedChannel,
      )
    ) {
      throw new BadRequestException(
        'channel must reference a connected analytics-capable provider',
      );
    }

    const relevantAccounts =
      selectedChannel === 'all'
        ? analyticsAccounts
        : analyticsAccounts.filter(
            (account) => account.provider.toLowerCase() === selectedChannel,
          );
    const relevantAccountIds = relevantAccounts.map((account) => account.id);

    const rows = relevantAccountIds.length
      ? await this.db.query.analyticsDaily.findMany({
          where: and(
            eq(schema.analyticsDaily.workspaceId, workspaceId),
            gte(schema.analyticsDaily.date, start),
            inArray(schema.analyticsDaily.socialAccountId, relevantAccountIds),
          ),
          with: { socialAccount: true },
          orderBy: (fields, { asc }) => [asc(fields.date)],
        })
      : [];

    const grouped = new Map<
      string,
      { id: number; date: string; metrics: NumericMetrics }
    >();
    const channelTotals = new Map<string, NumericMetrics>();

    for (const row of rows) {
      const key = row.date.toISOString().slice(0, 10);
      const previous = grouped.get(key);
      const metrics = asNumericMetrics(row.metrics);
      grouped.set(key, {
        id: previous?.id || row.id,
        date: row.date.toISOString(),
        metrics: addMetrics(previous?.metrics || {}, metrics),
      });

      const provider = row.socialAccount?.provider || 'unknown';
      channelTotals.set(
        provider,
        addMetrics(channelTotals.get(provider) || {}, metrics),
      );
    }

    const daily = [...grouped.values()].sort((a, b) =>
      a.date.localeCompare(b.date),
    );
    const totals = daily.reduce<NumericMetrics>(
      (acc, row) => addMetrics(acc, row.metrics),
      {},
    );

    const recentSnapshots = relevantAccountIds.length
      ? await this.db.query.metricSnapshots.findMany({
          where: and(
            inArray(schema.metricSnapshots.socialAccountId, relevantAccountIds),
            gte(schema.metricSnapshots.snapshotAt, start),
          ),
          with: {
            contentItem: true,
            socialAccount: true,
          },
          orderBy: (fields, { desc: orderDesc }) => [
            orderDesc(fields.snapshotAt),
          ],
          limit: 3000,
        })
      : [];

    const latestSnapshot = relevantAccountIds.length
      ? await this.db.query.metricSnapshots.findFirst({
          where: inArray(
            schema.metricSnapshots.socialAccountId,
            relevantAccountIds,
          ),
          columns: { snapshotAt: true },
          orderBy: (fields, { desc: orderDesc }) => [
            orderDesc(fields.snapshotAt),
          ],
        })
      : undefined;

    const latestPost = new Map<
      string,
      (typeof recentSnapshots)[number]
    >();
    for (const snapshot of recentSnapshots) {
      if (
        !snapshot.platformPostId ||
        !snapshot.contentItem ||
        !snapshot.socialAccount
      ) {
        continue;
      }
      const key = `${snapshot.contentItemId}:${snapshot.socialAccountId}:${snapshot.platformPostId}`;
      if (!latestPost.has(key)) latestPost.set(key, snapshot);
    }

    const interactionScore = (metrics: NumericMetrics) =>
      (metrics.reactions || metrics.likes || 0) +
      (metrics.comments || 0) * 2 +
      (metrics.shares || metrics.reshares || 0) * 3 +
      (metrics.clicks || metrics.link_clicks || 0);

    const contentPerformance = [...latestPost.values()]
      .map((snapshot) => ({
        contentItemId: snapshot.contentItem!.id,
        title: snapshot.contentItem!.title,
        provider: snapshot.socialAccount!.provider,
        accountName:
          snapshot.socialAccount!.accountName ||
          snapshot.socialAccount!.provider,
        platformPostId: snapshot.platformPostId!,
        metrics: asNumericMetrics(snapshot.metrics),
        snapshotAt: snapshot.snapshotAt.toISOString(),
      }))
      .sort((a, b) => {
        const score = interactionScore(b.metrics) - interactionScore(a.metrics);
        if (score !== 0) return score;
        return (
          (b.metrics.reach ||
            b.metrics.impressions ||
            b.metrics.views ||
            0) -
          (a.metrics.reach ||
            a.metrics.impressions ||
            a.metrics.views ||
            0)
        );
      })
      .slice(0, 20);

    const trackedPostsByProvider = new Map<string, Set<string>>();
    const latestByProvider = new Map<string, Date>();
    for (const snapshot of recentSnapshots) {
      const provider = snapshot.socialAccount?.provider;
      if (!provider || !snapshot.platformPostId) continue;
      const tracked = trackedPostsByProvider.get(provider) || new Set<string>();
      tracked.add(snapshot.platformPostId);
      trackedPostsByProvider.set(provider, tracked);

      const current = latestByProvider.get(provider);
      if (!current || snapshot.snapshotAt > current) {
        latestByProvider.set(provider, snapshot.snapshotAt);
      }
    }

    const channelBreakdown = relevantAccounts
      .reduce<
        Array<{
          provider: string;
          accountIds: number[];
          accountNames: string[];
        }>
      >((result, account) => {
        const existing = result.find(
          (entry) => entry.provider === account.provider,
        );
        if (existing) {
          existing.accountIds.push(account.id);
          if (account.accountName) existing.accountNames.push(account.accountName);
        } else {
          result.push({
            provider: account.provider,
            accountIds: [account.id],
            accountNames: account.accountName ? [account.accountName] : [],
          });
        }
        return result;
      }, [])
      .map((entry) => ({
        provider: entry.provider,
        accountCount: entry.accountIds.length,
        accountNames: [...new Set(entry.accountNames)],
        totals: channelTotals.get(entry.provider) || {},
        trackedPosts: trackedPostsByProvider.get(entry.provider)?.size || 0,
        latestSnapshotAt:
          latestByProvider.get(entry.provider)?.toISOString() || null,
      }))
      .sort((a, b) => {
        const aReach =
          a.totals.reach || a.totals.impressions || a.totals.views || 0;
        const bReach =
          b.totals.reach || b.totals.impressions || b.totals.views || 0;
        return bReach - aReach;
      });

    const publishedSchedules = relevantAccountIds.length
      ? await this.db.query.scheduledPublications.findMany({
          where: and(
            eq(schema.scheduledPublications.workspaceId, workspaceId),
            eq(schema.scheduledPublications.status, 'published'),
            gte(schema.scheduledPublications.scheduledAt, start),
            inArray(
              schema.scheduledPublications.socialAccountId,
              relevantAccountIds,
            ),
          ),
          columns: { id: true },
          limit: 5000,
        })
      : [];

    return {
      workspaceId,
      windowStart: start.toISOString(),
      windowEnd: windowEnd.toISOString(),
      rangeDays: days,
      selectedChannel,
      availableChannels,
      totals,
      daily,
      hasData: rows.length > 0,
      latestSnapshotAt: latestSnapshot?.snapshotAt.toISOString() || null,
      trackedPosts: new Set(
        recentSnapshots
          .map((snapshot) => snapshot.platformPostId)
          .filter((value): value is string => Boolean(value)),
      ).size,
      publishedCount: publishedSchedules.length,
      syncWindowDays: 30,
      channelBreakdown,
      contentPerformance,
    };
  }

  async listDispatchable(limit = 250): Promise<DispatchableAnalytics[]> {
    const safeLimit = Math.min(500, Math.max(1, limit));
    const now = Date.now();
    const maxAge = 30 * 24 * 60 * 60_000;
    const initialDelay = 15 * 60_000;
    const dispatchable: DispatchableAnalytics[] = [];
    const batchSize = 500;
    const maxScan = 5_000;
    let cursor: number | undefined;
    let scanned = 0;

    while (dispatchable.length < safeLimit && scanned < maxScan) {
      const results = await this.db.query.publicationResults.findMany({
        where: cursor
          ? and(
              isNotNull(schema.publicationResults.platformPostId),
              lt(schema.publicationResults.id, cursor),
            )
          : isNotNull(schema.publicationResults.platformPostId),
        with: {
          job: {
            with: {
              scheduledPublication: {
                with: {
                  socialAccount: true,
                  workspace: true,
                },
              },
            },
          },
        },
        orderBy: (fields, { desc: orderDesc }) => [
          orderDesc(fields.id),
        ],
        limit: batchSize,
      });

      if (!results.length) break;
      scanned += results.length;
      cursor = results[results.length - 1]?.id;

      const candidates = results.filter((result) => {
        const publication = result.job.scheduledPublication;
        if (
          publication.status !== 'published' ||
          !result.platformPostId ||
          now - result.createdAt.getTime() > maxAge
        ) {
          return false;
        }

        const description = this.providerRegistry.describeProvider(
          publication.socialAccount.provider,
        );
        return Boolean(description.capabilities?.analytics);
      });

      const postIds = [
        ...new Set(
          candidates
            .map((result) => result.platformPostId)
            .filter((value): value is string => Boolean(value)),
        ),
      ];

      const snapshots = postIds.length
        ? await this.db.query.metricSnapshots.findMany({
            where: inArray(schema.metricSnapshots.platformPostId, postIds),
            orderBy: (fields, { desc: orderDesc }) => [
              orderDesc(fields.snapshotAt),
            ],
          })
        : [];

      const latestByKey = new Map<
        string,
        typeof schema.metricSnapshots.$inferSelect
      >();
      for (const snapshot of snapshots) {
        if (!snapshot.platformPostId || !snapshot.socialAccountId) continue;
        const key = `${snapshot.contentItemId}:${snapshot.socialAccountId}:${snapshot.platformPostId}`;
        if (!latestByKey.has(key)) latestByKey.set(key, snapshot);
      }

      for (const result of candidates) {
        const publication = result.job.scheduledPublication;
        const account = publication.socialAccount;
        const postId = result.platformPostId;
        if (!postId) continue;

        const key = `${publication.contentItemId}:${account.id}:${postId}`;
        const latest = latestByKey.get(key);
        const postAge = now - result.createdAt.getTime();
        const interval = analyticsIntervalMs(postAge);
        if (interval === null) continue;

        const dueAt = latest
          ? latest.snapshotAt.getTime() + interval
          : result.createdAt.getTime() + initialDelay;

        if (dueAt > now) continue;

        dispatchable.push({
          publicationResultId: result.id,
          contentItemId: publication.contentItemId,
          socialAccountId: account.id,
          provider: account.provider,
          platformPostId: postId,
          expectedSnapshotAt: latest?.snapshotAt.toISOString() || null,
          revision: latest
            ? String(latest.snapshotAt.getTime())
            : 'initial',
          dueAt: new Date(dueAt).toISOString(),
        });

        if (dispatchable.length >= safeLimit) break;
      }

      if (results.length < batchSize) break;
    }

    return dispatchable;
  }

  async ingestPublication(
    publicationResultId: number,
    expectedSnapshotAt?: string | null,
  ): Promise<IngestResult> {
    const result = await this.db.query.publicationResults.findFirst({
      where: eq(schema.publicationResults.id, publicationResultId),
      with: {
        job: {
          with: {
            scheduledPublication: {
              with: {
                socialAccount: true,
                workspace: true,
              },
            },
          },
        },
      },
    });

    if (!result?.platformPostId) {
      throw new NotFoundException('Published provider result not found');
    }

    const platformPostId = result.platformPostId;
    const publication = result.job.scheduledPublication;
    const account = publication.socialAccount;

    if (publication.status !== 'published') {
      return { status: 'not_due', publicationResultId };
    }

    const description = this.providerRegistry.describeProvider(account.provider);
    if (!description.capabilities?.analytics) {
      return { status: 'not_supported', publicationResultId };
    }

    const latest = await this.db.query.metricSnapshots.findFirst({
      where: and(
        eq(schema.metricSnapshots.contentItemId, publication.contentItemId),
        eq(schema.metricSnapshots.socialAccountId, account.id),
        eq(schema.metricSnapshots.platformPostId, platformPostId),
      ),
      orderBy: (fields, { desc: orderDesc }) => [
        orderDesc(fields.snapshotAt),
      ],
    });

    const latestVersion = latest?.snapshotAt.toISOString() || null;
    if ((expectedSnapshotAt || null) !== latestVersion) {
      return { status: 'stale', publicationResultId };
    }

    const postAge = Date.now() - result.createdAt.getTime();
    const interval = analyticsIntervalMs(postAge);
    if (interval === null) {
      return { status: 'not_due', publicationResultId };
    }

    const dueAt = latest
      ? latest.snapshotAt.getTime() + interval
      : result.createdAt.getTime() + 15 * 60_000;
    if (dueAt > Date.now() + 5_000) {
      return { status: 'not_due', publicationResultId };
    }

    try {
      const publisher = this.providerRegistry.getProvider(account.provider);
      const analytics = this.providerRegistry.getAnalyticsProvider(
        account.provider,
      );
      const accessToken = await this.credentials.getValidAccessToken(
        account,
        publisher,
      );
      const current = asNumericMetrics(
        await analytics.fetchPostMetrics(platformPostId, accessToken),
      );
      const day = calendarDayInZone(
        publication.workspace?.timezone || 'UTC',
      );

      let insertedSnapshotId = 0;
      let delta: NumericMetrics = {};
      let staleAfterLock = false;

      await this.db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(${publication.workspaceId}, ${account.id})`,
        );

        const lockedLatest = await tx.query.metricSnapshots.findFirst({
          where: and(
            eq(schema.metricSnapshots.contentItemId, publication.contentItemId),
            eq(schema.metricSnapshots.socialAccountId, account.id),
            eq(schema.metricSnapshots.platformPostId, platformPostId),
          ),
          orderBy: (fields, { desc: orderDesc }) => [
            orderDesc(fields.snapshotAt),
          ],
        });

        const lockedVersion =
          lockedLatest?.snapshotAt.toISOString() || null;
        if ((expectedSnapshotAt || null) !== lockedVersion) {
          staleAfterLock = true;
          return;
        }

        delta = subtractMetrics(
          current,
          asNumericMetrics(lockedLatest?.metrics),
        );

        const [snapshot] = await tx
          .insert(schema.metricSnapshots)
          .values({
            contentItemId: publication.contentItemId,
            socialAccountId: account.id,
            platformPostId,
            metrics: current,
            snapshotAt: new Date(),
          })
          .returning();
        insertedSnapshotId = snapshot.id;

        const daily = await tx.query.analyticsDaily.findFirst({
          where: and(
            eq(schema.analyticsDaily.workspaceId, publication.workspaceId),
            eq(schema.analyticsDaily.socialAccountId, account.id),
            eq(schema.analyticsDaily.date, day),
          ),
        });

        if (daily) {
          await tx
            .update(schema.analyticsDaily)
            .set({
              metrics: addMetrics(asNumericMetrics(daily.metrics), delta),
              updatedAt: new Date(),
            })
            .where(eq(schema.analyticsDaily.id, daily.id));
        } else {
          await tx.insert(schema.analyticsDaily).values({
            workspaceId: publication.workspaceId,
            socialAccountId: account.id,
            date: day,
            metrics: delta,
          });
        }
      });

      if (staleAfterLock) {
        return { status: 'stale', publicationResultId };
      }

      return {
        status: 'ingested',
        publicationResultId,
        snapshotId: insertedSnapshotId,
        metrics: current,
        delta,
      };
    } catch (error) {
      const retryable =
        (error instanceof ProviderAnalyticsError && error.retryable) ||
        (error instanceof ProviderPublishError && error.retryable);

      if (retryable) {
        throw new ServiceUnavailableException(
          error instanceof Error ? error.message : 'Analytics provider unavailable',
        );
      }

      if (
        error instanceof ProviderAnalyticsError ||
        error instanceof ProviderPublishError
      ) {
        return {
          status: 'failed_terminal',
          publicationResultId,
          reason: error.message,
          ...(error instanceof ProviderAnalyticsError
            ? { permissionDenied: error.permissionDenied }
            : {}),
        };
      }

      throw error;
    }
  }

  async getContentAnalytics(workspaceId: number, contentId: number) {
    const content = await this.db.query.contentItems.findFirst({
      where: and(
        eq(schema.contentItems.id, contentId),
        eq(schema.contentItems.workspaceId, workspaceId),
      ),
    });

    if (!content) throw new NotFoundException('Content item not found');

    const snapshots = await this.db.query.metricSnapshots.findMany({
      where: eq(schema.metricSnapshots.contentItemId, contentId),
      orderBy: (fields, { desc: orderDesc }) => [
        orderDesc(fields.snapshotAt),
      ],
    });

    return {
      contentId,
      latest: snapshots[0]?.metrics ?? null,
      snapshots,
      hasData: snapshots.length > 0,
    };
  }
}
