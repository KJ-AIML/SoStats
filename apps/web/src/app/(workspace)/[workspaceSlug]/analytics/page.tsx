import Link from "next/link";
import {
  Activity,
  BarChart3,
  Clock3,
  Eye,
  Heart,
  MousePointerClick,
  RefreshCw,
} from "lucide-react";
import { MetricCard } from "@/components/sostats/metric-card";
import { PageHeading } from "@/components/sostats/page-heading";
import {
  type AiInsightRecord,
  type AnalyticsOverview,
  loadWorkspaceSnapshot,
  workspaceRequest,
} from "@/lib/sostats-api.server";
import { AiInsightCard } from "./ai-insight-card";

function firstMetric(
  totals: Record<string, number>,
  keys: string[],
): number {
  for (const key of keys) {
    if (typeof totals[key] === "number") return totals[key];
  }
  return 0;
}

function engagementTotal(metrics: Record<string, number>) {
  return (
    firstMetric(metrics, ["engagements", "engagement"]) ||
    firstMetric(metrics, ["reactions", "likes"]) +
      firstMetric(metrics, ["comments"]) +
      firstMetric(metrics, ["shares", "reshares"]) +
      firstMetric(metrics, ["clicks", "link_clicks"])
  );
}

function reachTotal(metrics: Record<string, number>) {
  return firstMetric(metrics, ["reach", "impressions", "views"]);
}

function formatCompact(value: number) {
  return new Intl.NumberFormat("en", {
    notation: value >= 1000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatSyncTime(value?: string | null) {
  if (!value) return "Waiting for first provider sync";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function freshnessLabel(value?: string | null) {
  if (!value) return "No snapshot";
  const ageMinutes = Math.max(
    0,
    Math.round((Date.now() - new Date(value).getTime()) / 60_000),
  );
  if (ageMinutes < 60) return `${ageMinutes}m ago`;
  const hours = Math.round(ageMinutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function providerLabel(value: string) {
  if (value.toLowerCase() === "x") return "X";
  if (value.toLowerCase() === "linkedin") return "LinkedIn";
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeSeries(values: number[]) {
  if (!values.length) return [];
  const max = Math.max(...values.map((value) => Math.max(0, value)), 1);
  return values.slice(-8).map((value) => (Math.max(0, value) / max) * 100);
}

function analyticsHref(
  workspaceSlug: string,
  days: number,
  channel: string,
) {
  const query = new URLSearchParams({ days: String(days) });
  if (channel !== "all") query.set("channel", channel);
  return `/${workspaceSlug}/analytics?${query.toString()}`;
}

export default async function AnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{
    days?: string | string[];
    channel?: string | string[];
  }>;
}) {
  const { workspaceSlug } = await params;
  const query = await searchParams;
  const rawDays = Array.isArray(query.days) ? query.days[0] : query.days;
  const requestedDays = Number.parseInt(rawDays || "30", 10);
  const days = [7, 30, 90].includes(requestedDays) ? requestedDays : 30;
  const rawChannel = Array.isArray(query.channel)
    ? query.channel[0]
    : query.channel;
  const channel = rawChannel?.trim().toLowerCase() || "all";

  let analytics: AnalyticsOverview = {
    workspaceId: 0,
    totals: {},
    daily: [],
    hasData: false,
    latestSnapshotAt: null,
    trackedPosts: 0,
    publishedCount: 0,
    syncWindowDays: 30,
    channelBreakdown: [],
    contentPerformance: [],
  };
  let brandId: number | undefined;
  let insights: AiInsightRecord[] = [];
  let workspaceHasEvidence = false;
  let connectionError = false;

  try {
    const snapshot = await loadWorkspaceSnapshot(workspaceSlug);
    brandId = snapshot.brand?.id;
    insights = snapshot.insights;
    workspaceHasEvidence = snapshot.analytics.hasData;

    if (days === 30 && channel === "all") {
      analytics = snapshot.analytics;
    } else {
      const analyticsQuery = new URLSearchParams({ days: String(days) });
      if (channel !== "all") analyticsQuery.set("channel", channel);
      analytics = await workspaceRequest<AnalyticsOverview>(
        workspaceSlug,
        `/v1/analytics/overview?${analyticsQuery.toString()}`,
      );
    }
  } catch {
    connectionError = true;
  }

  const totals = analytics.totals || {};
  const daily = analytics.daily || [];
  const hasData = analytics.hasData;
  const latestSnapshotAt = analytics.latestSnapshotAt || null;
  const trackedPosts = analytics.trackedPosts || 0;
  const syncWindowDays = analytics.syncWindowDays || 30;
  const publishedCount = analytics.publishedCount || 0;
  const availableChannels = analytics.availableChannels || [];
  const channelBreakdown = analytics.channelBreakdown || [];
  const contentPerformance = analytics.contentPerformance || [];

  const reach = reachTotal(totals);
  const engagements = engagementTotal(totals);
  const clicks = firstMetric(totals, ["clicks", "link_clicks"]);
  const engagementRate = reach > 0 ? (engagements / reach) * 100 : 0;

  const reachSeries = daily.map((row) => reachTotal(row.metrics));
  const clickSeries = daily.map((row) =>
    firstMetric(row.metrics, ["clicks", "link_clicks"]),
  );
  const engagementRateSeries = daily.map((row) => {
    const dailyReach = reachTotal(row.metrics);
    return dailyReach > 0
      ? (engagementTotal(row.metrics) / dailyReach) * 100
      : 0;
  });
  const chart = reachSeries;
  const maxChart = Math.max(...chart.map((value) => Math.max(0, value)), 1);

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 p-4 md:p-6 xl:p-8">
      <PageHeading
        eyebrow="Analytics"
        title="Performance that leads to action"
        description="Provider metrics flow through the analytics worker into real snapshots, daily deltas, channel performance and evidence-backed recommendations."
        actions={
          <div className="flex h-10 items-center rounded-xl border border-black/[0.06] bg-white p-1">
            {[7, 30, 90].map((range) => (
              <Link
                key={range}
                href={analyticsHref(workspaceSlug, range, channel)}
                className={
                  range === days
                    ? "flex h-8 items-center rounded-lg bg-neutral-950 px-3 text-[9px] font-semibold text-white"
                    : "flex h-8 items-center rounded-lg px-3 text-[9px] font-semibold text-neutral-500 hover:bg-neutral-50"
                }
              >
                {range}d
              </Link>
            ))}
          </div>
        }
      />

      {connectionError && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[10px] text-amber-800">
          Analytics is waiting for the API/database stack.
        </div>
      )}

      <section className="sostats-card flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="sostats-icon h-9 w-9">
            {latestSnapshotAt ? (
              <RefreshCw className="h-4 w-4 text-emerald-600" />
            ) : (
              <Clock3 className="h-4 w-4 text-amber-600" />
            )}
          </div>
          <div>
            <p className="text-[10px] font-semibold">
              {latestSnapshotAt
                ? "Provider analytics connected"
                : "Waiting for provider metrics"}
            </p>
            <p className="mt-0.5 text-[8px] text-muted-foreground">
              Latest snapshot · {formatSyncTime(latestSnapshotAt)}
              {latestSnapshotAt ? ` · ${freshnessLabel(latestSnapshotAt)}` : ""}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={analyticsHref(workspaceSlug, days, "all")}
            className={
              channel === "all"
                ? "rounded-lg bg-neutral-950 px-3 py-2 text-[8px] font-semibold text-white"
                : "rounded-lg border border-black/[0.06] bg-white px-3 py-2 text-[8px] font-semibold text-neutral-500"
            }
          >
            All channels
          </Link>
          {availableChannels.map((provider) => (
            <Link
              key={provider}
              href={analyticsHref(
                workspaceSlug,
                days,
                provider.toLowerCase(),
              )}
              className={
                channel === provider.toLowerCase()
                  ? "rounded-lg bg-neutral-950 px-3 py-2 text-[8px] font-semibold text-white"
                  : "rounded-lg border border-black/[0.06] bg-white px-3 py-2 text-[8px] font-semibold text-neutral-500"
              }
            >
              {providerLabel(provider)}
            </Link>
          ))}
        </div>

        <div className="flex gap-5 text-right">
          <div>
            <p className="text-[8px] text-muted-foreground">Tracked posts</p>
            <p className="mt-0.5 text-[11px] font-semibold">{trackedPosts}</p>
          </div>
          <div>
            <p className="text-[8px] text-muted-foreground">Collection window</p>
            <p className="mt-0.5 text-[11px] font-semibold">
              {syncWindowDays} days
            </p>
          </div>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Reach / Views"
          value={hasData ? formatCompact(reach) : "—"}
          change={hasData ? `Real provider deltas · ${days}d` : "No provider data"}
          icon={Eye}
          bars={normalizeSeries(reachSeries)}
        />
        <MetricCard
          label="Engagement Rate"
          value={hasData ? `${engagementRate.toFixed(1)}%` : "—"}
          change={
            hasData
              ? "Reactions + comments + shares + clicks"
              : "No provider data"
          }
          icon={Heart}
          bars={normalizeSeries(engagementRateSeries)}
        />
        <MetricCard
          label="Clicks"
          value={hasData ? formatCompact(clicks) : "—"}
          change={hasData ? `Real provider deltas · ${days}d` : "No provider data"}
          icon={MousePointerClick}
          bars={normalizeSeries(clickSeries)}
        />
        <MetricCard
          label="Published Posts"
          value={String(publishedCount)}
          change={`Lifecycle records · ${days}d`}
          icon={BarChart3}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <section className="sostats-card xl:col-span-8">
          <div className="flex items-center justify-between border-b border-black/[0.055] px-5 py-4">
            <div>
              <p className="text-sm font-semibold">Performance trend</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Daily reach/views deltas · {days} day window
              </p>
            </div>
            <span className="text-[10px] font-semibold text-neutral-500">
              {daily.length} metric days
            </span>
          </div>

          <div className="p-5">
            {hasData ? (
              <div className="flex h-[240px] items-end gap-1 rounded-xl bg-[linear-gradient(to_bottom,transparent_24%,rgba(0,0,0,0.04)_25%,transparent_26%,transparent_49%,rgba(0,0,0,0.04)_50%,transparent_51%,transparent_74%,rgba(0,0,0,0.04)_75%,transparent_76%)] px-2 pt-5">
                {chart.map((value, index) => (
                  <div
                    key={daily[index]?.date || index}
                    className="group flex h-full min-w-0 flex-1 items-end"
                    title={`${daily[index]?.date?.slice(0, 10) || ""}: ${formatCompact(value)}`}
                  >
                    <div
                      className={
                        index === chart.length - 1
                          ? "w-full rounded-t-sm bg-[#ef2b2d] transition"
                          : "w-full rounded-t-sm bg-neutral-200 transition group-hover:bg-neutral-300"
                      }
                      style={{
                        height: `${Math.max(2, (Math.max(0, value) / maxChart) * 100)}%`,
                      }}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid h-[240px] place-items-center rounded-xl border border-dashed border-black/[0.08] bg-neutral-50 text-center">
                <div className="max-w-sm">
                  <Activity className="mx-auto h-5 w-5 text-neutral-300" />
                  <p className="mt-2 text-[10px] font-semibold">
                    No provider metrics in this view
                  </p>
                  <p className="mt-1 text-[9px] leading-4 text-muted-foreground">
                    SoStats will not invent a trend. Metrics appear after a published post receives its first provider snapshot.
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>

        <div className="xl:col-span-4">
          <AiInsightCard
            workspaceSlug={workspaceSlug}
            brandId={brandId}
            hasData={workspaceHasEvidence}
            initialInsights={insights}
          />
          <p className="mt-2 px-1 text-[8px] leading-4 text-muted-foreground">
            AI recommendations use the workspace-wide 30-day evidence window, independent of the display filter above.
          </p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <section className="sostats-card overflow-hidden xl:col-span-5">
          <div className="border-b border-black/[0.055] px-5 py-4">
            <p className="text-sm font-semibold">Channel performance</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Aggregated provider deltas and snapshot freshness
            </p>
          </div>

          <div className="divide-y divide-black/[0.045]">
            {channelBreakdown.length ? (
              channelBreakdown.map((item) => {
                const itemReach = reachTotal(item.totals);
                const itemEngagements = engagementTotal(item.totals);
                const rate =
                  itemReach > 0 ? (itemEngagements / itemReach) * 100 : 0;
                return (
                  <div key={item.provider} className="px-5 py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-[10px] font-semibold">
                          {providerLabel(item.provider)}
                        </p>
                        <p className="mt-1 truncate text-[8px] text-muted-foreground">
                          {item.accountNames.length
                            ? item.accountNames.join(", ")
                            : `${item.accountCount} connected account${item.accountCount === 1 ? "" : "s"}`}
                        </p>
                      </div>
                      <span className="rounded-lg bg-neutral-100 px-2 py-1 text-[8px] font-semibold text-neutral-500">
                        {freshnessLabel(item.latestSnapshotAt)}
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <MiniMetric
                        label="Reach"
                        value={formatCompact(itemReach)}
                      />
                      <MiniMetric
                        label="Eng. rate"
                        value={itemReach > 0 ? `${rate.toFixed(1)}%` : "—"}
                      />
                      <MiniMetric
                        label="Tracked"
                        value={String(item.trackedPosts)}
                      />
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="px-5 py-8 text-center text-[10px] text-muted-foreground">
                No analytics-capable channel data in this range.
              </div>
            )}
          </div>
        </section>

        <section className="sostats-card overflow-hidden xl:col-span-7">
          <div className="border-b border-black/[0.055] px-5 py-4">
            <p className="text-sm font-semibold">Top measured content</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Latest provider snapshot per published post in the selected window
            </p>
          </div>

          <div className="divide-y divide-black/[0.045]">
            {contentPerformance.length ? (
              contentPerformance.slice(0, 10).map((item, index) => {
                const itemReach = reachTotal(item.metrics);
                const interactions = engagementTotal(item.metrics);
                const rate =
                  itemReach > 0 ? (interactions / itemReach) * 100 : 0;
                return (
                  <div
                    key={`${item.contentItemId}-${item.provider}-${item.platformPostId}`}
                    className="grid grid-cols-[28px_minmax(0,1fr)_80px_80px] items-center gap-3 px-5 py-3.5"
                  >
                    <span className="font-mono text-[9px] text-neutral-400">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="min-w-0">
                      <Link
                        href={`/${workspaceSlug}/content`}
                        className="block truncate text-[10px] font-semibold hover:text-[#df272a]"
                      >
                        {item.title}
                      </Link>
                      <p className="mt-0.5 truncate text-[8px] text-muted-foreground">
                        {providerLabel(item.provider)} · {item.accountName} · snapshot{" "}
                        {freshnessLabel(item.snapshotAt)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[8px] text-muted-foreground">Reach</p>
                      <p className="mt-0.5 text-[9px] font-semibold">
                        {formatCompact(itemReach)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[8px] text-muted-foreground">Eng.</p>
                      <p className="mt-0.5 text-[9px] font-semibold">
                        {itemReach > 0 ? `${rate.toFixed(1)}%` : "—"}
                      </p>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="px-5 py-8 text-center text-[10px] text-muted-foreground">
                No measured published content in this view.
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-neutral-50 p-2.5">
      <p className="text-[7px] uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-[10px] font-semibold">{value}</p>
    </div>
  );
}
