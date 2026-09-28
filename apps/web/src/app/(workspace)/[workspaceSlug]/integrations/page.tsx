import {
  Boxes,
  Cable,
  CheckCircle2,
  Globe2,
  Plus,
  Rss,
  Webhook,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeading } from "@/components/sostats/page-heading";

const integrations = [
  { icon: Globe2, title: "WordPress", description: "Turn published articles into social content.", status: "Connected" },
  { icon: Rss, title: "RSS", description: "Trigger workflows from new feed items.", status: "Connected" },
  { icon: Webhook, title: "Webhooks", description: "Send and receive workflow events.", status: "Configured" },
  { icon: Boxes, title: "More connectors", description: "Notion, Drive, Shopify and Slack later.", status: "Planned" },
];

export default function IntegrationsPage() {
  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-5 p-4 md:p-6 xl:p-8">
      <PageHeading
        eyebrow="Integrations"
        title="Bring outside signals into SoStats"
        description="Connect sources and actions through adapters so automations can grow without coupling the core product to vendor APIs."
        actions={
          <Button className="h-10 rounded-xl bg-[#ef2b2d] text-[10px] hover:bg-[#da2427]">
            <Plus className="mr-2 h-3.5 w-3.5" />
            Add integration
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-2">
        {integrations.map((item) => (
          <section key={item.title} className="sostats-card p-5">
            <div className="flex items-start gap-4">
              <div className="sostats-icon h-10 w-10 shrink-0">
                <item.icon className="h-4 w-4 text-neutral-500" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] font-semibold">{item.title}</p>
                  <span className={item.status === "Planned" ? "rounded-lg bg-neutral-100 px-2 py-1 text-[8px] font-semibold text-neutral-500" : "inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1 text-[8px] font-semibold text-emerald-700"}>
                    {item.status !== "Planned" && <CheckCircle2 className="h-3 w-3" />}
                    {item.status}
                  </span>
                </div>
                <p className="mt-1.5 text-[9px] leading-4 text-muted-foreground">{item.description}</p>
                <button className="mt-4 text-[9px] font-semibold text-[#d92023]">
                  Configure
                </button>
              </div>
            </div>
          </section>
        ))}
      </div>

      <div className="flex items-center gap-2 text-[9px] text-muted-foreground">
        <Cable className="h-3.5 w-3.5" />
        Integrations remain adapter-backed so the automation core stays provider-independent.
      </div>
    </div>
  );
}
