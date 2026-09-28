import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileText,
  Lightbulb,
  Play,
  Send,
  Sparkles,
  WandSparkles,
  Workflow,
} from "lucide-react";
import { MetricCard } from "@/components/sostats/metric-card";

const queue = [
  { label: "Draft", count: 12, hint: "4 generated today" },
  { label: "Review", count: 5, hint: "2 need your attention" },
  { label: "Scheduled", count: 18, hint: "Across 4 channels" },
  { label: "Published", count: 89, hint: "This month" },
];

const schedule = [
  { time: "09:30", title: "Why AI workflows beat AI prompts", channel: "LinkedIn" },
  { time: "13:00", title: "3 automations I use every week", channel: "X" },
  { time: "18:30", title: "Behind the scenes: SoStats", channel: "Instagram" },
];

const channels = [
  { name: "LinkedIn", value: "5.8%", detail: "Engagement", width: "78%" },
  { name: "Instagram", value: "4.9%", detail: "Engagement", width: "64%" },
  { name: "X", value: "3.6%", detail: "Engagement", width: "48%" },
];

export default async function WorkspaceDashboardPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 p-4 md:p-6 xl:p-8">
      <section className="flex flex-col gap-4 pt-1 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="sostats-kicker mb-2">Overview · SoStats Studio</p>
          <h1 className="text-[30px] font-semibold tracking-[-0.045em] text-neutral-950 md:text-[36px]">
            Good morning 👋
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Your content engine is healthy. Two items need review before today&apos;s publishing window.
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
              Turn one idea into an entire content pipeline.
            </h2>
            <div className="mt-5 flex min-h-16 items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.08] p-2 pl-4 backdrop-blur">
              <WandSparkles className="h-4 w-4 shrink-0 text-red-300" />
              <span className="min-w-0 flex-1 text-[13px] text-white/55">
                Create a 2-week launch campaign for SoStats across LinkedIn, X and Instagram...
              </span>
              <Link
                href={`/${workspaceSlug}/ai-studio`}
                className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl bg-[#ef2b2d] px-4 text-[12px] font-semibold text-white transition hover:bg-[#da2427]"
              >
                Generate
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {["Generate posts", "Create campaign", "Repurpose content", "Analyze performance"].map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] text-white/55"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold text-white/80">Today&apos;s engine</p>
              <span className="flex items-center gap-1.5 text-[10px] text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Running
              </span>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {[
                ["7", "Generated"],
                ["3", "Queued"],
                ["2", "Published"],
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
        <MetricCard label="Content Created" value="124" change="+12% this month" icon={FileText} bars={[35, 47, 51, 63, 69, 86]} />
        <MetricCard label="Scheduled" value="24" change="+4 this week" icon={CalendarDays} bars={[45, 32, 54, 66, 56, 73]} />
        <MetricCard label="Published" value="89" change="+18% this month" icon={CheckCircle2} bars={[22, 42, 44, 55, 68, 78]} />
        <MetricCard label="AI Time Saved" value="42h" change="+5h this week" icon={Sparkles} bars={[28, 38, 58, 61, 74, 92]} />
      </section>

      <section className="grid gap-4 xl:grid-cols-12">
        <div className="sostats-card xl:col-span-5">
          <div className="flex items-center justify-between border-b border-black/[0.055] px-5 py-4">
            <div>
              <p className="text-sm font-semibold">Content pipeline</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">Everything moving through your workflow</p>
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
          <div className="p-4">
            <div className="rounded-xl bg-neutral-50 p-3">
              <div className="flex items-center gap-3">
                <div className="sostats-icon h-8 w-8">
                  <Clock3 className="h-3.5 w-3.5 text-neutral-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-semibold">Founder story — Why we built SoStats</p>
                  <p className="mt-0.5 text-[9px] text-muted-foreground">Needs review · LinkedIn + X</p>
                </div>
                <span className="rounded-lg bg-[#fff0f0] px-2 py-1 text-[9px] font-semibold text-[#d92023]">Review</span>
              </div>
            </div>
          </div>
        </div>

        <div className="sostats-card xl:col-span-4">
          <div className="flex items-center justify-between border-b border-black/[0.055] px-5 py-4">
            <div>
              <p className="text-sm font-semibold">AI recommendations</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">Stats → insight → action</p>
            </div>
            <Lightbulb className="h-4 w-4 text-[#ef2b2d]" />
          </div>
          <div className="space-y-3 p-4">
            <div className="rounded-xl border border-[#ef2b2d]/10 bg-[#fff7f7] p-3.5">
              <p className="text-[11px] font-semibold">Double down on educational carousels</p>
              <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">
                Saves are 2.4× higher than product-led posts over the last 30 days.
              </p>
              <button className="mt-3 inline-flex items-center gap-1.5 text-[10px] font-semibold text-[#d92023]">
                Generate 3 follow-ups <ArrowRight className="h-3 w-3" />
              </button>
            </div>
            <div className="rounded-xl border border-black/[0.055] p-3.5">
              <p className="text-[11px] font-semibold">Move Tuesday LinkedIn slot earlier</p>
              <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">
                Your audience is most responsive between 09:30–10:30.
              </p>
            </div>
          </div>
        </div>

        <div className="sostats-card xl:col-span-3">
          <div className="flex items-center justify-between border-b border-black/[0.055] px-5 py-4">
            <div>
              <p className="text-sm font-semibold">Automation activity</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">Last 24 hours</p>
            </div>
            <Workflow className="h-4 w-4 text-neutral-400" />
          </div>
          <div className="space-y-4 p-4">
            {[
              { icon: Play, title: "Weekly content plan", detail: "Generated 5 drafts", time: "8m" },
              { icon: Send, title: "Blog → Social", detail: "Scheduled 3 variants", time: "2h" },
              { icon: BarChart3, title: "Performance loop", detail: "Insight ready", time: "4h" },
            ].map((item) => (
              <div key={item.title} className="flex items-start gap-3">
                <div className="sostats-icon h-8 w-8 shrink-0">
                  <item.icon className="h-3.5 w-3.5 text-neutral-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[10px] font-semibold">{item.title}</p>
                  <p className="mt-0.5 truncate text-[9px] text-muted-foreground">{item.detail}</p>
                </div>
                <span className="text-[9px] text-muted-foreground">{item.time}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-12">
        <div className="sostats-card xl:col-span-7">
          <div className="flex items-center justify-between border-b border-black/[0.055] px-5 py-4">
            <div>
              <p className="text-sm font-semibold">Upcoming content</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">Today&apos;s publishing schedule</p>
            </div>
            <Link href={`/${workspaceSlug}/calendar`} className="text-[10px] font-semibold text-[#df272a]">
              Open calendar
            </Link>
          </div>
          <div className="divide-y divide-black/[0.045] px-4">
            {schedule.map((item) => (
              <div key={item.time} className="flex items-center gap-4 py-3.5">
                <span className="w-12 font-mono text-[10px] font-semibold text-neutral-400">{item.time}</span>
                <span className="h-7 w-[3px] rounded-full bg-[#ef2b2d]" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-semibold">{item.title}</p>
                  <p className="mt-0.5 text-[9px] text-muted-foreground">{item.channel}</p>
                </div>
                <span className="rounded-lg bg-neutral-100 px-2 py-1 text-[9px] font-medium text-neutral-500">Scheduled</span>
              </div>
            ))}
          </div>
        </div>

        <div className="sostats-card xl:col-span-5">
          <div className="border-b border-black/[0.055] px-5 py-4">
            <p className="text-sm font-semibold">Channel performance</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">Engagement rate · last 30 days</p>
          </div>
          <div className="space-y-4 p-5">
            {channels.map((channel) => (
              <div key={channel.name}>
                <div className="mb-2 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-semibold">{channel.name}</p>
                    <p className="text-[9px] text-muted-foreground">{channel.detail}</p>
                  </div>
                  <p className="text-[12px] font-semibold">{channel.value}</p>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100">
                  <div className="h-full rounded-full bg-neutral-900" style={{ width: channel.width }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
