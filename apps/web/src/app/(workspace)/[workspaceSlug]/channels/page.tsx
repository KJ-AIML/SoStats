import {
  CheckCircle2,
  ExternalLink,
  Link2,
  Plus,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeading } from "@/components/sostats/page-heading";

const channels = [
  ["in", "LinkedIn", "@sostats", "Connected", "2m ago", "5.8%"],
  ["𝕏", "X", "@sostatsapp", "Connected", "5m ago", "3.6%"],
  ["IG", "Instagram", "@sostats.ai", "Connected", "8m ago", "4.9%"],
  ["TT", "TikTok", "@sostats", "Attention", "1d ago", "6.2%"],
];

export default function ChannelsPage() {
  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 p-4 md:p-6 xl:p-8">
      <PageHeading
        eyebrow="Channels"
        title="Connect once, publish everywhere"
        description="Manage provider health, permissions and channel-specific publishing behavior behind one adapter layer."
        actions={
          <Button className="h-10 rounded-xl bg-[#ef2b2d] text-[10px] hover:bg-[#da2427]">
            <Plus className="mr-2 h-3.5 w-3.5" />
            Connect channel
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {channels.map(([mark, name, handle, status, sync, engagement]) => (
          <section key={name} className="sostats-card p-4">
            <div className="flex items-start justify-between">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-neutral-950 text-[11px] font-bold text-white">
                {mark}
              </div>
              <button className="sostats-icon h-8 w-8">
                <ExternalLink className="h-3.5 w-3.5 text-neutral-400" />
              </button>
            </div>
            <p className="mt-4 text-[12px] font-semibold">{name}</p>
            <p className="mt-0.5 text-[9px] text-muted-foreground">{handle}</p>

            <div className="mt-4 flex items-center justify-between rounded-xl bg-neutral-50 p-3">
              <div>
                <p className="text-[8px] text-muted-foreground">Status</p>
                <p className={status === "Connected" ? "mt-1 flex items-center gap-1 text-[9px] font-semibold text-emerald-600" : "mt-1 text-[9px] font-semibold text-amber-600"}>
                  {status === "Connected" && <CheckCircle2 className="h-3 w-3" />}
                  {status}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[8px] text-muted-foreground">Engagement</p>
                <p className="mt-1 text-[10px] font-semibold">{engagement}</p>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between text-[8px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <RefreshCw className="h-3 w-3" />
                Synced {sync}
              </span>
              <button className="font-semibold text-neutral-600">Manage</button>
            </div>
          </section>
        ))}
      </div>

      <section className="sostats-card overflow-hidden">
        <div className="border-b border-black/[0.055] px-5 py-4">
          <p className="text-sm font-semibold">Publishing capabilities</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">What SoStats can automate on each connected provider</p>
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[760px]">
            <div className="grid grid-cols-[1.3fr_repeat(5,1fr)] border-b border-black/[0.045] bg-neutral-50 px-5 py-3 text-[8px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              <span>Channel</span><span>Text</span><span>Images</span><span>Video</span><span>Schedule</span><span>Analytics</span>
            </div>
            {channels.map(([, name]) => (
              <div key={name} className="grid grid-cols-[1.3fr_repeat(5,1fr)] items-center border-b border-black/[0.045] px-5 py-3.5 text-[9px] last:border-b-0">
                <span className="font-semibold">{name}</span>
                {[1, 2, 3, 4, 5].map((item) => (
                  <span key={item}><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /></span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="flex items-center gap-2 text-[9px] text-muted-foreground">
        <Link2 className="h-3.5 w-3.5" />
        Provider capabilities are resolved through adapters, so unsupported actions stay out of the UI.
      </div>
    </div>
  );
}
