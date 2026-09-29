import {
  BarChart3,
  Clock3,
  Eye,
  Heart,
  MousePointerClick,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/sostats/metric-card";
import { PageHeading } from "@/components/sostats/page-heading";
import {
  type AiInsightRecord,
  loadWorkspaceSnapshot,
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

export default async function AnalyticsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  let totals: Record<string, number> = {};
  let daily: Array<{ date: string; metrics: Record<string, number> }> = [];
  let hasData = false;
  let brandId: number | undefined;
  let latestSnapshotAt: string | null = null;
  let trackedPosts = 0;
  let syncWindowDays = 30;
  let publishedCount = 0;
  let insights: AiInsightRecord[] = [];
  let published: Array<{
    id: number;
    title: string;
    channel: string;
  }> = [];
  let connectionError = false;

  try {
    const snapshot = await loadWorkspaceSnapshot(workspaceSlug);
    totals = snapshot.analytics.totals;
    daily = snapshot.analytics.daily;
    hasData = snapshot.analytics.hasData;
    latestSnapshotAt = snapshot.analytics.latestSnapshotAt || null;
    trackedPosts = snapshot.analytics.trackedPosts || 0;
    syncWindowDays = snapshot.analytics.syncWindowDays || 30;
    brandId = snapshot.brand?.id;
    insights = snapshot.insights;

    const publishedItems = snapshot.content.filter(
      (item) => item.status === "published",
    );
    publishedCount = publishedItems.length;
    published = publishedItems.slice(0, 5).map((item) => ({
      id: item.id,
      title: item.title,
      channel:
        item.variants?.map((variant) => variant.platform).filter(Boolean).join(" + ") ||
        "Published",
    }));
  } catch {
    connectionError = true;
  }

  const reach = firstMetric(totals, ["reach", "impressions", "views"]);
  const engagements =
    firstMetric(totals, ["engagements", "engagement"]) ||
    firstMetric(totals, ["reactions", "likes"]) +
      firstMetric(totals, ["comments"]) +
      firstMetric(totals, ["shares"]) +
      firstMetric(totals, ["clicks", "link_clicks"]);
  const clicks = firstMetric(totals, ["clicks", "link_clicks"]);
  const engagementRate = reach > 0 ? (engagements / reach) * 100 : 0;

  const chart = [...daily]
    .slice(-12)
    .map((row) =>
      firstMetric(row.metrics, ["reach", "impressions", "views", "reactions"]),
    );
  const maxChart = Math.max(...chart, 1);

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 p-4 md:p-6 xl:p-8">
      <PageHeading
        eyebrow="Analytics"
        title="Performance that leads to action"
        description="Provider metrics now flow back through the worker into snapshots, daily deltas and the AI insight loop."
        actions={
          <Button variant="outline" className="h-10 rounded-xl text-[10px]">
            Last 30 days
          </Button>
        }
      />

      {connectionError && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[10px] text-amber-800">
          Analytics is waiting for the API/database stack.
        </div>
      )}

      <section className="sostats-card flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
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
              {latestSnapshotAt ? "Provider analytics connected" : "Waiting for provider metrics"}
            </p>
            <p className="mt-0.5 text-[8px] text-muted-foreground">
              Latest snapshot · {formatSyncTime(latestSnapshotAt)}
            </p>
          </div>
        </div>
        <div className="flex gap-5 text-right">
          <div>
            <p className="text-[8px] text-muted-foreground">Tracked posts</p>
            <p className="mt-0.5 text-[11px] font-semibold">{trackedPosts}</p>
          </div>
          <div>
            <p className="text-[8px] text-muted-foreground">Active sync window</p>
            <p className="mt-0.5 text-[11px] font-semibold">{syncWindowDays} days</p>
          </div>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Reach / Views"
          value={formatCompact(reach)}
          change={hasData ? "Provider-synced deltas" : "No data yet"}
          icon={Eye}
          bars={[34, 45, 52, 49, 68, 88]}
        />
        <MetricCard
          label="Engagement Rate"
          value={`${engagementRate.toFixed(1)}%`}
          change={hasData ? "Reactions + comments + shares + clicks" : "No data yet"}
          icon={Heart}
          bars={[45, 49, 51, 58, 66, 73]}
        />
        <MetricCard
          label="Clicks"
          value={formatCompact(clicks)}
          change={hasData ? "Provider-synced metrics" : "No data yet"}
          icon={MousePointerClick}
          bars={[38, 33, 46, 57, 64, 79]}
        />
        <MetricCard
          label="Published Content"
          value={String(publishedCount)}
          change="Canonical content"
          icon={BarChart3}
          bars={[26, 39, 51, 48, 63, 84]}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <section className="sostats-card xl:col-span-8">
          <div className="flex items-center justify-between border-b border-black/[0.055] px-5 py-4">
            <div>
              <p className="text-sm font-semibold">Performance trend</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Daily metric deltas aggregated across connected channels
              </p>
            </div>
            <span className="text-[10px] font-semibold text-neutral-500">
              {chart.length} days
            </span>
          </div>
          <div className="p-5">
            <div className="flex h-[240px] items-end gap-2 rounded-xl bg-[linear-gradient(to_bottom,transparent_24%,rgba(0,0,0,0.04)_25%,transparent_26%,transparent_49%,rgba(0,0,0,0.04)_50%,transparent_51%,transparent_74%,rgba(0,0,0,0.04)_75%,transparent_76%)] px-2 pt-5">
              {(chart.length ? chart : Array.from({ length: 12 }, () => 0)).map(
                (value, index) => (
                  <div key={index} className="group flex h-full flex-1 items-end">
                    <div
                      className={
                        index === chart.length - 1 && chart.length > 0
                          ? "w-full rounded-t-lg bg-[#ef2b2d] transition"
                          : "w-full rounded-t-lg bg-neutral-200 transition group-hover:bg-neutral-300"
                      }
                      style={{
                        height: `${Math.max(4, (value / maxChart) * 100)}%`,
                      }}
                    />
                  </div>
                ),
              )}
            </div>
            {!hasData && (
              <p className="mt-3 text-[9px] text-muted-foreground">
                The first provider snapshot is collected after the post has had time to receive metrics.
              </p>
            )}
          </div>
        </section>

        <div className="xl:col-span-4">
          <AiInsightCard
            workspaceSlug={workspaceSlug}
            brandId={brandId}
            hasData={hasData}
            initialInsights={insights}
          />
        </div>
      </div>

      <section className="sostats-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-black/[0.055] px-5 py-4">
          <div>
            <p className="text-sm font-semibold">Recent published content</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Publication records that feed the analytics dispatcher
            </p>
          </div>
        </div>
        <div className="divide-y divide-black/[0.045]">
          {published.length ? (
            published.map((item, index) => (
              <div
                key={item.id}
                className="grid grid-cols-[28px_minmax(0,1fr)_120px] items-center gap-3 px-5 py-3.5"
              >
                <span className="font-mono text-[9px] text-neutral-400">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[10px] font-semibold">{item.title}</p>
                  <p className="mt-0.5 text-[8px] capitalize text-muted-foreground">
                    {item.channel}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[9px] font-semibold text-emerald-600">Published</p>
                </div>
              </div>
            ))
          ) : (
            <div className="px-5 py-8 text-center text-[10px] text-muted-foreground">
              No published content yet.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
