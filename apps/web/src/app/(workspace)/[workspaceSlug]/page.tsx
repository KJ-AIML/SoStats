import Link from "next/link";
import {
  Activity,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  FileText,
  ImageIcon,
  Layers3,
  Lightbulb,
  Play,
  Sparkles,
  TrendingUp,
  WandSparkles,
  Workflow,
} from "lucide-react";
import { MetricCard } from "@/components/sostats/metric-card";
import { loadWorkspaceSnapshot } from "@/lib/sostats-api.server";

const DAY_MS = 24 * 60 * 60 * 1000;

function normalizeBars(values: number[]) {
  if (!values.length) return [];
  const max = Math.max(...values);
  if (max <= 0) return values.map(() => 4);
  return values.map((value) =>
    value <= 0 ? 4 : Math.max(12, Math.round((value / max) * 100)),
  );
}

function publicationBuckets(
  dates: string[],
  direction: "past" | "future",
  days = 6,
) {
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const buckets = Array.from({ length: days }, () => 0);

  for (const value of dates) {
    const date = new Date(value);
    const target = Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
    );
    const delta = Math.floor((target - today) / DAY_MS);
    const index = direction === "future" ? delta : days - 1 + delta;
    if (index >= 0 && index < days) buckets[index] += 1;
  }

  return buckets;
}

function formatCompact(value: number) {
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function performanceMetric(totals: Record<string, number>) {
  const preferred = [
    "impressions",
    "reach",
    "views",
    "engagements",
    "engagement",
    "clicks",
    "likes",
    "shares",
    "reposts",
  ];

  const key =
    preferred.find((candidate) => typeof totals[candidate] === "number") ||
    Object.keys(totals).find((candidate) => typeof totals[candidate] === "number");

  if (!key) return null;

  return {
    key,
    label: key
      .replaceAll("_", " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase()),
  };
}

export default async function WorkspaceDashboardPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  let snapshot: Awaited<ReturnType<typeof loadWorkspaceSnapshot>> | null = null;

  try {
    snapshot = await loadWorkspaceSnapshot(workspaceSlug);
  } catch {
    snapshot = null;
  }

  const content = snapshot?.content || [];
  const campaigns = snapshot?.campaigns || [];
  const allSchedules = snapshot?.calendar || [];
  const currentTime = Date.now();
  const scheduledPublications = allSchedules.filter(
    (item) =>
      item.status === "scheduled" &&
      new Date(item.scheduledAt).getTime() >= currentTime,
  );
  const upcomingSchedules = [...scheduledPublications]
    .sort(
      (a, b) =>
        new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
    )
    .slice(0, 4);
  const publishedPublications = allSchedules.filter(
    (item) => item.status === "published",
  );
  const channels = snapshot?.channels || [];
  const automations = snapshot?.automations || [];
  const assets = snapshot?.assets || [];
  const knowledge = snapshot?.knowledge || [];
  const latestInsight = (snapshot?.insights || []).find((insight) =>
    ["pending", "informational", "failed"].includes(insight.status),
  );

  const counts = {
    draft: content.filter((item) => item.status === "draft").length,
    review: content.filter((item) =>
      ["in_review", "approved"].includes(item.status),
    ).length,
    scheduled: content.filter((item) => item.status === "scheduled").length,
    published: content.filter((item) => item.status === "published").length,
  };

  const queue = [
    { label: "Draft", count: counts.draft, hint: "Ready to refine" },
    { label: "Review", count: counts.review, hint: "Needs a decision" },
    { label: "Scheduled", count: counts.scheduled, hint: "In publishing queue" },
    { label: "Published", count: counts.published, hint: "Completed content" },
  ];

  const livePerformanceMetric = performanceMetric(snapshot?.analytics.totals || {});
  const performanceDaily = livePerformanceMetric
    ? (snapshot?.analytics.daily || []).map(
        (row) => row.metrics[livePerformanceMetric.key] || 0,
      )
    : [];
  const performanceBars = normalizeBars(performanceDaily.slice(-6));
  const contentBars = normalizeBars([
    counts.draft,
    counts.review,
    counts.scheduled,
    counts.published,
  ]);
  const scheduledBars = normalizeBars(
    publicationBuckets(
      scheduledPublications.map((item) => item.scheduledAt),
      "future",
    ),
  );
  const publishedBars = normalizeBars(
    publicationBuckets(
      publishedPublications.map((item) => item.scheduledAt),
      "past",
    ),
  );
  const activeCampaigns = campaigns.filter((item) => item.status === "active");
  const activeChannels = channels.filter((item) => item.status === "active");
  const activeAutomations = automations.filter((item) => item.status === "active");
  const readyAssets = assets.filter((item) => item.status === "ready");
  const readyKnowledge = knowledge.filter(
    (item) => item.activeVersion > 0 && item.status !== "uploading",
  );
  const automationRuns = automations
    .flatMap((automation) =>
      (automation.runs || []).map((run) => ({
        ...run,
        automationName: automation.name,
      })),
    )
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
    .slice(0, 3);

  const workspaceName = snapshot?.workspace.name || "SoStats Studio";

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 p-4 md:p-6 xl:p-8">
      <section className="flex flex-col gap-4 pt-1 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="sostats-kicker mb-2">Overview · {workspaceName}</p>
          <h1 className="text-[30px] font-semibold tracking-[-0.045em] text-neutral-950 md:text-[36px]">
            Content operations, in one loop
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {snapshot
              ? `${counts.review} item${counts.review === 1 ? "" : "s"} need review and ${scheduledPublications.length} publication${schedules.length === 1 ? "" : "s"} are coming up.`
              : "Start the API/database stack to load your live workspace."}
          </p>
        </div>
        <Link
          href={`/${workspaceSlug}/content`}
          className="inline-flex h-10 items-center gap-2 self-start rounded-xl border border-black/[0.07] bg-white px-4 text-[12px] font-semibold text-neutral-700 transition hover:bg-neutral-50 md:self-auto"
        >
          Review content
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </section>

      {!snapshot && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[10px] text-amber-800">
          Live workspace data is unavailable. The UI remains accessible, but generation and persistence need the API stack.
        </div>
      )}

      <section className="relative overflow-hidden rounded-[22px] border border-black/[0.07] bg-neutral-950 p-5 text-white shadow-[0_18px_48px_rgba(15,23,42,0.12)] md:p-6">
        <div className="pointer-events-none absolute -right-20 -top-28 h-64 w-64 rounded-full bg-[#ef2b2d] opacity-50 blur-3xl" />
        <div className="pointer-events-none absolute bottom-[-60px] right-[18%] h-36 w-36 rounded-full bg-orange-500 opacity-25 blur-3xl" />

        <div className="relative z-10 grid gap-5 lg:grid-cols-[1fr_320px] lg:items-end">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.07] px-3 py-1 text-[10px] font-semibold text-white/70">
              <Sparkles className="h-3 w-3 text-red-300" />
              AI COMMAND CENTER
            </div>
            <h2 className="max-w-2xl text-[22px] font-semibold tracking-[-0.035em] md:text-[27px]">
              Turn one idea into persisted, reviewable content.
            </h2>
            <div className="mt-5 flex min-h-16 items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.08] p-2 pl-4 backdrop-blur">
              <WandSparkles className="h-4 w-4 shrink-0 text-red-300" />
              <span className="min-w-0 flex-1 text-[13px] text-white/55">
                Brand Brain → AI campaign → content variants → review → schedule
              </span>
              <Link
                href={`/${workspaceSlug}/ai-studio`}
                className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl bg-[#ef2b2d] px-4 text-[12px] font-semibold text-white transition hover:bg-[#da2427]"
              >
                Generate
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold text-white/80">Workspace engine</p>
              <span className="flex items-center gap-1.5 text-[10px] text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                {snapshot ? "Connected" : "Offline"}
              </span>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {[
                [String(activeCampaigns.length), "Campaigns"],
                [String(counts.review), "Review"],
                [String(schedules.length), "Upcoming"],
              ].map(([value, label]) => (
                <div key={label} className="rounded-xl bg-black/20 p-3">
                  <p className="text-lg font-semibold">{value}</p>
                  <p className="text-[9px] text-white/45">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Content Items"
          value={String(content.length)}
          change="Live pipeline mix"
          icon={FileText}
          bars={contentBars}
        />
        <MetricCard
          label="Upcoming Publications"
          value={String(scheduledPublications.length)}
          change="Next 6 days"
          icon={CalendarDays}
          bars={scheduledBars}
        />
        <MetricCard
          label="Published Posts"
          value={String(publishedPublications.length)}
          change="Recent publishing cadence"
          icon={CheckCircle2}
          bars={publishedBars}
          tone="positive"
        />
        <MetricCard
          label={livePerformanceMetric ? `30d ${livePerformanceMetric.label}` : "30d Performance"}
          value={
            livePerformanceMetric
              ? formatCompact(
                  snapshot?.analytics.totals[livePerformanceMetric.key] || 0,
                )
              : "—"
          }
          change={
            snapshot?.analytics.hasData
              ? `${snapshot.analytics.trackedPosts || 0} tracked posts`
              : "Waiting for provider metrics"
          }
          icon={TrendingUp}
          bars={performanceBars}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-12">
        <div className="sostats-card xl:col-span-5">
          <div className="flex items-center justify-between border-b border-black/[0.055] px-5 py-4">
            <div>
              <p className="text-sm font-semibold">Content pipeline</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">Live workflow state</p>
            </div>
            <Link href={`/${workspaceSlug}/content`} className="text-[10px] font-semibold text-[#df272a]">
              Open board
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-px bg-black/[0.05] sm:grid-cols-4">
            {queue.map((item, index) => (
              <div key={item.label} className="bg-white p-4">
                <div className="flex items-center gap-2">
                  <span className={index === 1 ? "h-2 w-2 rounded-full bg-[#ef2b2d]" : "h-2 w-2 rounded-full bg-neutral-300"} />
                  <p className="text-[10px] font-medium text-muted-foreground">{item.label}</p>
                </div>
                <p className="mt-3 text-2xl font-semibold tracking-[-0.04em]">{item.count}</p>
                <p className="mt-1 text-[9px] text-muted-foreground">{item.hint}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="sostats-card xl:col-span-4">
          <div className="flex items-center justify-between border-b border-black/[0.055] px-5 py-4">
            <div>
              <p className="text-sm font-semibold">AI insight loop</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">Evidence first, then recommendation</p>
            </div>
            <Lightbulb className="h-4 w-4 text-[#ef2b2d]" />
          </div>
          <div className="space-y-3 p-4">
            <div className="rounded-xl border border-[#ef2b2d]/10 bg-[#fff7f7] p-3.5">
              <p className="text-[11px] font-semibold">
                {latestInsight
                  ? latestInsight.finding
                  : snapshot?.analytics.hasData
                    ? "Performance data is ready for AI recommendations"
                    : "Waiting for provider metrics"}
              </p>
              <p className="mt-1.5 line-clamp-3 text-[10px] leading-4 text-muted-foreground">
                {latestInsight
                  ? latestInsight.recommendation
                  : "SoStats turns persisted metrics and Brand Brain context into controlled next actions."}
              </p>
              <Link
                href={`/${workspaceSlug}/analytics`}
                className="mt-3 inline-flex items-center gap-1.5 text-[10px] font-semibold text-[#d92023]"
              >
                {latestInsight ? "Review recommendation" : "Open analytics"} <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </div>
        </div>

        <div className="sostats-card xl:col-span-3">
          <div className="flex items-center justify-between border-b border-black/[0.055] px-5 py-4">
            <div>
              <p className="text-sm font-semibold">Automation activity</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">Latest persisted runs</p>
            </div>
            <Workflow className="h-4 w-4 text-neutral-400" />
          </div>
          <div className="space-y-4 p-4">
            {automationRuns.length ? (
              automationRuns.map((run) => (
                <div key={run.id} className="flex items-start gap-3">
                  <div className="sostats-icon h-8 w-8 shrink-0">
                    <Play className="h-3.5 w-3.5 text-neutral-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[10px] font-semibold">
                      {run.automationName}
                    </p>
                    <p className="mt-0.5 truncate text-[9px] capitalize text-muted-foreground">
                      Run #{run.id} · {run.status}
                    </p>
                  </div>
                  <span
                    className={
                      run.status === "completed"
                        ? "text-[9px] font-semibold text-emerald-600"
                        : run.status === "failed"
                          ? "text-[9px] font-semibold text-[#df272a]"
                          : "text-[9px] font-semibold text-amber-600"
                    }
                  >
                    {run.status}
                  </span>
                </div>
              ))
            ) : automations.length ? (
              automations.slice(0, 3).map((automation) => (
                <div key={automation.id} className="flex items-start gap-3">
                  <div className="sostats-icon h-8 w-8 shrink-0">
                    <Workflow className="h-3.5 w-3.5 text-neutral-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[10px] font-semibold">
                      {automation.name}
                    </p>
                    <p className="mt-0.5 truncate text-[9px] capitalize text-muted-foreground">
                      {automation.triggerType} · {automation.status}
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <p className="py-6 text-center text-[9px] text-muted-foreground">
                No saved automations yet.
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-12">
        <div className="sostats-card xl:col-span-7">
          <div className="flex items-center justify-between border-b border-black/[0.055] px-5 py-4">
            <div>
              <p className="text-sm font-semibold">Upcoming content</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">Persisted publishing schedule</p>
            </div>
            <Link href={`/${workspaceSlug}/calendar`} className="text-[10px] font-semibold text-[#df272a]">
              Open calendar
            </Link>
          </div>
          <div className="divide-y divide-black/[0.045] px-4">
            {upcomingSchedules.length ? (
              upcomingSchedules.map((item) => (
                <div key={item.id} className="flex items-center gap-4 py-3.5">
                  <span className="w-14 font-mono text-[9px] font-semibold text-neutral-400">
                    {new Date(item.scheduledAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <span className="h-7 w-[3px] rounded-full bg-[#ef2b2d]" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] font-semibold">
                      {item.contentItem?.title || "Scheduled content"}
                    </p>
                    <p className="mt-0.5 text-[9px] capitalize text-muted-foreground">
                      {item.socialAccount?.provider || "channel"} ·{" "}
                      {new Date(item.scheduledAt).toLocaleDateString()}
                    </p>
                  </div>
                  <span className="rounded-lg bg-neutral-100 px-2 py-1 text-[9px] font-medium capitalize text-neutral-500">
                    {item.status}
                  </span>
                </div>
              ))
            ) : (
              <p className="py-8 text-center text-[10px] text-muted-foreground">
                No upcoming publications.
              </p>
            )}
          </div>
        </div>

        <div className="sostats-card xl:col-span-5">
          <div className="border-b border-black/[0.055] px-5 py-4">
            <p className="text-sm font-semibold">Connected channels</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">Provider account health</p>
          </div>
          <div className="space-y-3 p-5">
            {channels.length ? (
              channels.slice(0, 5).map((channel) => (
                <div key={channel.id} className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-950 text-[9px] font-bold uppercase text-white">
                    {channel.provider.slice(0, 2)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[10px] font-semibold capitalize">
                      {channel.accountName || channel.provider}
                    </p>
                    <p className="text-[8px] capitalize text-muted-foreground">{channel.provider}</p>
                  </div>
                  <span className={channel.status === "active" ? "text-[9px] font-semibold text-emerald-600" : "text-[9px] font-semibold text-amber-600"}>
                    {channel.status}
                  </span>
                </div>
              ))
            ) : (
              <p className="py-6 text-center text-[9px] text-muted-foreground">
                No channels connected.
              </p>
            )}
          </div>
        </div>
      </section>


      <section className="grid gap-4 xl:grid-cols-12">
        <div className="sostats-card xl:col-span-7">
          <div className="flex items-center justify-between border-b border-black/[0.055] px-5 py-4">
            <div>
              <p className="text-sm font-semibold">Performance pulse</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                30-day provider metrics aggregated from published posts
              </p>
            </div>
            <Activity className="h-4 w-4 text-[#ef2b2d]" />
          </div>
          <div className="p-5">
            {snapshot?.analytics.hasData && livePerformanceMetric ? (
              <>
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-medium text-muted-foreground">
                      {livePerformanceMetric.label}
                    </p>
                    <p className="mt-1 text-[30px] font-semibold tracking-[-0.05em] text-neutral-950">
                      {formatCompact(
                        snapshot.analytics.totals[livePerformanceMetric.key] || 0,
                      )}
                    </p>
                  </div>
                  <div className="text-right text-[9px] text-muted-foreground">
                    <p>{snapshot.analytics.trackedPosts || 0} tracked posts</p>
                    <p className="mt-1">
                      {snapshot.analytics.latestSnapshotAt
                        ? `Last sync ${new Date(
                            snapshot.analytics.latestSnapshotAt,
                          ).toLocaleString()}`
                        : "No completed snapshot yet"}
                    </p>
                  </div>
                </div>
                <div className="mt-6 flex h-28 items-end gap-1.5 rounded-xl border border-black/[0.05] bg-neutral-50 px-3 pb-3 pt-4">
                  {(snapshot.analytics.daily || []).slice(-14).map((row, index, series) => {
                    const values = series.map(
                      (item) => item.metrics[livePerformanceMetric.key] || 0,
                    );
                    const heights = normalizeBars(values);
                    const value = row.metrics[livePerformanceMetric.key] || 0;
                    return (
                      <div
                        key={row.date}
                        className="flex min-w-0 flex-1 items-end"
                        title={`${new Date(row.date).toLocaleDateString()}: ${value}`}
                      >
                        <span
                          className={
                            index === series.length - 1
                              ? "w-full rounded-t bg-[#ef2b2d]"
                              : "w-full rounded-t bg-neutral-200"
                          }
                          style={{ height: `${heights[index] || 4}%` }}
                        />
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="flex min-h-40 flex-col items-center justify-center rounded-xl border border-dashed border-black/[0.08] bg-neutral-50 text-center">
                <TrendingUp className="h-5 w-5 text-neutral-300" />
                <p className="mt-2 text-[10px] font-semibold text-neutral-600">
                  Performance appears after published posts collect metrics.
                </p>
                <Link
                  href={`/${workspaceSlug}/analytics`}
                  className="mt-2 text-[10px] font-semibold text-[#df272a]"
                >
                  Open analytics
                </Link>
              </div>
            )}
          </div>
        </div>

        <div className="sostats-card xl:col-span-5">
          <div className="flex items-center justify-between border-b border-black/[0.055] px-5 py-4">
            <div>
              <p className="text-sm font-semibold">Operating health</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Real connected product surfaces
              </p>
            </div>
            <Layers3 className="h-4 w-4 text-neutral-400" />
          </div>
          <div className="grid grid-cols-2 gap-px bg-black/[0.05]">
            {[
              [String(activeChannels.length), "Active channels", "Channels"],
              [String(activeAutomations.length), "Live automations", "Automations"],
              [String(readyKnowledge.length), "Knowledge sources", "Brand Brain"],
              [String(readyAssets.length), "Ready assets", "Media"],
            ].map(([value, label, area]) => (
              <div key={label} className="bg-white p-5">
                <p className="text-2xl font-semibold tracking-[-0.04em]">{value}</p>
                <p className="mt-1 text-[10px] font-semibold text-neutral-700">{label}</p>
                <p className="mt-0.5 text-[9px] text-muted-foreground">{area}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-12">
        <div className="sostats-card xl:col-span-7">
          <div className="flex items-center justify-between border-b border-black/[0.055] px-5 py-4">
            <div>
              <p className="text-sm font-semibold">Recent campaigns</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Latest campaign plans and persisted content
              </p>
            </div>
            <Link
              href={`/${workspaceSlug}/ai-studio`}
              className="text-[10px] font-semibold text-[#df272a]"
            >
              Open AI Studio
            </Link>
          </div>
          <div className="divide-y divide-black/[0.045] px-4">
            {campaigns.length ? (
              campaigns.slice(0, 4).map((campaign) => (
                <div key={campaign.id} className="flex items-center gap-4 py-3.5">
                  <div className="sostats-icon h-9 w-9 shrink-0">
                    <Sparkles className="h-4 w-4 text-[#ef2b2d]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] font-semibold">
                      {campaign.name}
                    </p>
                    <p className="mt-0.5 truncate text-[9px] text-muted-foreground">
                      {campaign.contentItems?.length || 0} content items ·{" "}
                      {campaign.channels?.length || 0} channels
                    </p>
                  </div>
                  <span className="rounded-lg bg-neutral-100 px-2 py-1 text-[9px] font-medium capitalize text-neutral-500">
                    {campaign.status}
                  </span>
                </div>
              ))
            ) : (
              <p className="py-8 text-center text-[10px] text-muted-foreground">
                No campaigns yet. Generate the first one in AI Studio.
              </p>
            )}
          </div>
        </div>

        <div className="sostats-card xl:col-span-5">
          <div className="flex items-center justify-between border-b border-black/[0.055] px-5 py-4">
            <div>
              <p className="text-sm font-semibold">Latest assets</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Private media processing state
              </p>
            </div>
            <Link
              href={`/${workspaceSlug}/media`}
              className="text-[10px] font-semibold text-[#df272a]"
            >
              Open media
            </Link>
          </div>
          <div className="space-y-3 p-4">
            {assets.length ? (
              assets.slice(0, 4).map((asset) => (
                <div key={asset.id} className="flex items-center gap-3 rounded-xl border border-black/[0.05] p-3">
                  <div className="sostats-icon h-9 w-9 shrink-0">
                    <ImageIcon className="h-4 w-4 text-neutral-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[10px] font-semibold">
                      {asset.fileName}
                    </p>
                    <p className="mt-0.5 text-[9px] text-muted-foreground">
                      {asset.fileType}
                      {asset.width && asset.height
                        ? ` · ${asset.width}×${asset.height}`
                        : ""}
                    </p>
                  </div>
                  <span
                    className={
                      asset.status === "ready"
                        ? "text-[9px] font-semibold text-emerald-600"
                        : asset.status === "failed"
                          ? "text-[9px] font-semibold text-[#df272a]"
                          : "text-[9px] font-semibold text-amber-600"
                    }
                  >
                    {asset.status}
                  </span>
                </div>
              ))
            ) : (
              <p className="py-8 text-center text-[10px] text-muted-foreground">
                No uploaded assets yet.
              </p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
