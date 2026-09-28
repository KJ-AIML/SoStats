import {
  BarChart3,
  Eye,
  Heart,
  MousePointerClick,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/sostats/metric-card";
import { PageHeading } from "@/components/sostats/page-heading";
import { loadWorkspaceSnapshot } from "@/lib/sostats-api.server";
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
    brandId = snapshot.brand?.id;
    published = snapshot.content
      .filter((item) => item.status === "published")
      .slice(0, 5)
      .map((item) => ({
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
    firstMetric(totals, ["likes"]) +
      firstMetric(totals, ["comments"]) +
      firstMetric(totals, ["shares"]);
  const clicks = firstMetric(totals, ["clicks", "link_clicks"]);
  const engagementRate = reach > 0 ? (engagements / reach) * 100 : 0;

  const chart = [...daily]
    .reverse()
    .slice(-12)
    .map((row) =>
      firstMetric(row.metrics, ["reach", "impressions", "views", "engagements"]),
    );
  const maxChart = Math.max(...chart, 1);

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 p-4 md:p-6 xl:p-8">
      <PageHeading
        eyebrow="Analytics"
        title="Performance that leads to action"
        description="Measure what happened, understand why it happened and feed the result directly into the next content cycle."
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

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Reach / Views" value={formatCompact(reach)} change={hasData ? "Persisted metrics" : "No data yet"} icon={Eye} bars={[34, 45, 52, 49, 68, 88]} />
        <MetricCard label="Engagement Rate" value={`${engagementRate.toFixed(1)}%`} change={hasData ? "Calculated from totals" : "No data yet"} icon={Heart} bars={[45, 49, 51, 58, 66, 73]} />
        <MetricCard label="Clicks" value={formatCompact(clicks)} change={hasData ? "Persisted metrics" : "No data yet"} icon={MousePointerClick} bars={[38, 33, 46, 57, 64, 79]} />
        <MetricCard label="Published Content" value={String(published.length)} change="Loaded from content" icon={BarChart3} bars={[26, 39, 51, 48, 63, 84]} />
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <section className="sostats-card xl:col-span-8">
          <div className="flex items-center justify-between border-b border-black/[0.055] px-5 py-4">
            <div>
              <p className="text-sm font-semibold">Performance trend</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Latest persisted daily metric
              </p>
            </div>
            <span className="text-[10px] font-semibold text-neutral-500">
              {chart.length} points
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
                The chart will populate when the analytics worker persists provider metrics.
              </p>
            )}
          </div>
        </section>

        <div className="xl:col-span-4">
          <AiInsightCard
            workspaceSlug={workspaceSlug}
            brandId={brandId}
            hasData={hasData}
          />
        </div>
      </div>

      <section className="sostats-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-black/[0.055] px-5 py-4">
          <div>
            <p className="text-sm font-semibold">Recent published content</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Real content records currently marked published
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
