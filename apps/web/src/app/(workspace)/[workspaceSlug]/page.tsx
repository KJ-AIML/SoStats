import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  FileText,
  Lightbulb,
  Play,
  Sparkles,
  WandSparkles,
  Workflow,
} from "lucide-react";
import { MetricCard } from "@/components/sostats/metric-card";
import { loadWorkspaceSnapshot } from "@/lib/sostats-api.server";

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
  const schedules = (snapshot?.calendar || [])
    .filter((item) => item.status === "scheduled")
    .sort(
      (a, b) =>
        new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
    )
    .slice(0, 4);
  const channels = snapshot?.channels || [];
  const automations = snapshot?.automations || [];
  const latestInsight = (snapshot?.insights || []).find((insight) =>
    ["pending", "failed", "informational"].includes(insight.status),
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
              ? `${counts.review} item${counts.review === 1 ? "" : "s"} need review and ${schedules.length} publication${schedules.length === 1 ? "" : "s"} are coming up.`
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
                [String(campaigns.filter((item) => item.status === "active").length), "Campaigns"],
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
          label="Content Created"
          value={String(content.length)}
          change="Persisted items"
          icon={FileText}
          bars={[35, 47, 51, 63, 69, 86]}
        />
        <MetricCard
          label="Scheduled"
          value={String(schedules.length)}
          change="Upcoming"
          icon={CalendarDays}
          bars={[45, 32, 54, 66, 56, 73]}
        />
        <MetricCard
          label="Published"
          value={String(counts.published)}
          change="Completed"
          icon={CheckCircle2}
          bars={[22, 42, 44, 55, 68, 78]}
        />
        <MetricCard
          label="Active Campaigns"
          value={String(campaigns.filter((item) => item.status === "active").length)}
          change="AI + manual"
          icon={Sparkles}
          bars={[28, 38, 58, 61, 74, 92]}
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
              <p className="text-sm font-semibold">Automations</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">Configured workflows</p>
            </div>
            <Workflow className="h-4 w-4 text-neutral-400" />
          </div>
          <div className="space-y-4 p-4">
            {automations.length ? (
              automations.slice(0, 3).map((automation) => (
                <div key={automation.id} className="flex items-start gap-3">
                  <div className="sostats-icon h-8 w-8 shrink-0">
                    <Play className="h-3.5 w-3.5 text-neutral-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[10px] font-semibold">{automation.name}</p>
                    <p className="mt-0.5 truncate text-[9px] text-muted-foreground">
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
            {schedules.length ? (
              schedules.map((item) => (
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
    </div>
  );
}
