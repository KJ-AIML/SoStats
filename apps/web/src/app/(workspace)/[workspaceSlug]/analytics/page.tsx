import {
  ArrowUpRight,
  BarChart3,
  Clock3,
  Eye,
  Heart,
  Lightbulb,
  MousePointerClick,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/sostats/metric-card";
import { PageHeading } from "@/components/sostats/page-heading";

const chart = [42, 50, 44, 63, 58, 72, 66, 83, 76, 88, 79, 94];
const topPosts = [
  ["Why AI workflows beat AI prompts", "LinkedIn", "18.4K", "7.2%"],
  ["One idea → five channel variants", "Instagram", "12.8K", "6.4%"],
  ["The content automation flywheel", "X", "9.6K", "5.8%"],
];

export default function AnalyticsPage() {
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

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total Reach" value="284K" change="+18.4%" icon={Eye} bars={[34, 45, 52, 49, 68, 88]} />
        <MetricCard label="Engagement" value="5.8%" change="+0.9 pts" icon={Heart} bars={[45, 49, 51, 58, 66, 73]} />
        <MetricCard label="Clicks" value="9.4K" change="+14.2%" icon={MousePointerClick} bars={[38, 33, 46, 57, 64, 79]} />
        <MetricCard label="Published" value="89" change="+18 this month" icon={BarChart3} bars={[26, 39, 51, 48, 63, 84]} />
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <section className="sostats-card xl:col-span-8">
          <div className="flex items-center justify-between border-b border-black/[0.055] px-5 py-4">
            <div>
              <p className="text-sm font-semibold">Performance trend</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">Reach across connected channels</p>
            </div>
            <span className="text-[10px] font-semibold text-emerald-600">+18.4%</span>
          </div>
          <div className="p-5">
            <div className="flex h-[240px] items-end gap-2 rounded-xl bg-[linear-gradient(to_bottom,transparent_24%,rgba(0,0,0,0.04)_25%,transparent_26%,transparent_49%,rgba(0,0,0,0.04)_50%,transparent_51%,transparent_74%,rgba(0,0,0,0.04)_75%,transparent_76%)] px-2 pt-5">
              {chart.map((height, index) => (
                <div key={index} className="group flex h-full flex-1 items-end">
                  <div
                    className={
                      index === chart.length - 1
                        ? "w-full rounded-t-lg bg-[#ef2b2d] transition"
                        : "w-full rounded-t-lg bg-neutral-200 transition group-hover:bg-neutral-300"
                    }
                    style={{ height: `${height}%` }}
                  />
                </div>
              ))}
            </div>
            <div className="mt-3 flex justify-between text-[8px] text-muted-foreground">
              {["Sep 1", "Sep 6", "Sep 11", "Sep 16", "Sep 21", "Sep 26"].map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>
          </div>
        </section>

        <section className="sostats-card overflow-hidden xl:col-span-4">
          <div className="flex items-center justify-between border-b border-black/[0.055] px-5 py-4">
            <div>
              <p className="text-sm font-semibold">AI insight</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">Recommended next move</p>
            </div>
            <Lightbulb className="h-4 w-4 text-[#ef2b2d]" />
          </div>
          <div className="p-5">
            <div className="rounded-2xl bg-neutral-950 p-5 text-white">
              <div className="flex items-center gap-2 text-[9px] font-semibold text-red-200">
                <Sparkles className="h-3.5 w-3.5" />
                PERFORMANCE PATTERN
              </div>
              <p className="mt-4 text-[14px] font-semibold leading-5">
                Educational carousels are your strongest save driver.
              </p>
              <p className="mt-2 text-[10px] leading-4 text-white/55">
                They generated 2.4× more saves than product-only posts in this period.
              </p>
              <button className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#ef2b2d] px-3 py-2 text-[9px] font-semibold">
                Generate 3 follow-ups
                <ArrowUpRight className="h-3 w-3" />
              </button>
            </div>
            <div className="mt-3 flex items-center gap-3 rounded-xl border border-black/[0.055] p-3">
              <Clock3 className="h-4 w-4 text-neutral-400" />
              <div>
                <p className="text-[9px] font-semibold">Best publishing window</p>
                <p className="mt-0.5 text-[8px] text-muted-foreground">Tue + Thu · 09:30–10:30</p>
              </div>
            </div>
          </div>
        </section>
      </div>

      <section className="sostats-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-black/[0.055] px-5 py-4">
          <div>
            <p className="text-sm font-semibold">Top content</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">Best-performing published variants</p>
          </div>
          <button className="text-[10px] font-semibold text-[#d92023]">See all</button>
        </div>
        <div className="divide-y divide-black/[0.045]">
          {topPosts.map(([title, channel, reach, rate], index) => (
            <div key={title} className="grid grid-cols-[28px_minmax(0,1fr)_100px_80px] items-center gap-3 px-5 py-3.5">
              <span className="font-mono text-[9px] text-neutral-400">0{index + 1}</span>
              <div className="min-w-0">
                <p className="truncate text-[10px] font-semibold">{title}</p>
                <p className="mt-0.5 text-[8px] text-muted-foreground">{channel}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-semibold">{reach}</p>
                <p className="text-[8px] text-muted-foreground">Reach</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-semibold">{rate}</p>
                <p className="text-[8px] text-muted-foreground">Eng.</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
