import {
  Play,
  Plus,
  Rss,
  Sparkles,
  Youtube,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeading } from "@/components/sostats/page-heading";
import { WorkflowCanvas } from "@/components/automations/workflow-canvas";

export default function AutomationsPage() {
  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 p-4 md:p-6 xl:p-8">
      <PageHeading
        eyebrow="Automations"
        title="Design the content engine"
        description="Chain triggers, AI transformations, human review and publishing actions into reusable workflows."
        actions={
          <>
            <Button variant="outline" className="h-10 rounded-xl text-[10px]">
              <Play className="mr-2 h-3.5 w-3.5" />
              Test run
            </Button>
            <Button className="h-10 rounded-xl bg-[#ef2b2d] text-[10px] hover:bg-[#da2427]">
              <Plus className="mr-2 h-3.5 w-3.5" />
              Publish workflow
            </Button>
          </>
        }
      />

      <div className="grid gap-3 md:grid-cols-3">
        {[
          { icon: Rss, title: "Blog → Social", copy: "Turn a new article into channel-specific drafts." },
          { icon: Sparkles, title: "Weekly AI Plan", copy: "Generate ideas every Monday using performance data." },
          { icon: Youtube, title: "Video Repurpose", copy: "Find highlights, create clips and schedule variants." },
        ].map((item) => (
          <button
            key={item.title}
            className="sostats-card flex items-center gap-3 p-3.5 text-left transition hover:-translate-y-0.5 hover:border-[#ef2b2d]/15"
          >
            <div className="sostats-icon">
              <item.icon className="h-4 w-4 text-neutral-500" />
            </div>
            <div>
              <p className="text-[10px] font-semibold">{item.title}</p>
              <p className="mt-0.5 text-[9px] text-muted-foreground">{item.copy}</p>
            </div>
          </button>
        ))}
      </div>

      <WorkflowCanvas />
    </div>
  );
}
