import {
  BookOpen,
  BrainCircuit,
  CheckCircle2,
  FileText,
  Globe2,
  MessageSquareText,
  Plus,
  ShieldCheck,
  Sparkles,
  Target,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeading } from "@/components/sostats/page-heading";

const sections = [
  { icon: MessageSquareText, title: "Brand voice", detail: "Confident, clear, practical", status: "Ready" },
  { icon: Target, title: "Audience", detail: "Founders + lean marketing teams", status: "Ready" },
  { icon: Sparkles, title: "Content pillars", detail: "Automation, education, founder POV", status: "Ready" },
  { icon: ShieldCheck, title: "Guardrails", detail: "Claims, banned phrases, CTA rules", status: "Ready" },
];

const sources = [
  { icon: Globe2, title: "sostats.app", type: "Website", count: "18 pages" },
  { icon: FileText, title: "Product messaging v2.pdf", type: "Document", count: "32 chunks" },
  { icon: BookOpen, title: "Approved LinkedIn posts", type: "Content", count: "46 examples" },
];

export default function BrandBrainPage() {
  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 p-4 md:p-6 xl:p-8">
      <PageHeading
        eyebrow="Brand Brain"
        title="Teach SoStats how your brand thinks"
        description="A shared intelligence layer for every campaign, automation and AI recommendation in your workspace."
        actions={
          <Button className="h-10 rounded-xl bg-[#ef2b2d] text-[10px] hover:bg-[#da2427]">
            <Plus className="mr-2 h-3.5 w-3.5" />
            Add knowledge
          </Button>
        }
      />

      <section className="relative overflow-hidden rounded-[22px] border border-black/[0.07] bg-neutral-950 p-5 text-white md:p-6">
        <div className="absolute -right-12 -top-20 h-56 w-56 rounded-full bg-[#ef2b2d] opacity-40 blur-3xl" />
        <div className="relative z-10 grid gap-5 lg:grid-cols-[1fr_330px] lg:items-center">
          <div>
            <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold text-red-200">
              <BrainCircuit className="h-4 w-4" />
              BRAND INTELLIGENCE
            </div>
            <h2 className="max-w-2xl text-[23px] font-semibold tracking-[-0.035em]">
              AI should sound like your brand before it sounds like AI.
            </h2>
            <p className="mt-2 max-w-xl text-[10px] leading-5 text-white/55">
              SoStats retrieves only the relevant brand context for each generation — voice, audience, product knowledge and approved examples.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[
              ["94%", "Profile complete"],
              ["12", "Knowledge sources"],
              ["46", "Approved examples"],
              ["4", "Content pillars"],
            ].map(([value, label]) => (
              <div key={label} className="rounded-xl border border-white/10 bg-white/[0.06] p-3">
                <p className="text-lg font-semibold">{value}</p>
                <p className="mt-0.5 text-[8px] text-white/45">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-12">
        <section className="sostats-card xl:col-span-7">
          <div className="border-b border-black/[0.055] px-5 py-4">
            <p className="text-sm font-semibold">Brand profile</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">Core context used across AI workflows</p>
          </div>
          <div className="grid gap-px bg-black/[0.045] sm:grid-cols-2">
            {sections.map((item) => (
              <button key={item.title} className="bg-white p-5 text-left transition hover:bg-neutral-50">
                <div className="flex items-start gap-3">
                  <div className="sostats-icon">
                    <item.icon className="h-4 w-4 text-neutral-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] font-semibold">{item.title}</p>
                      <span className="flex items-center gap-1 text-[8px] font-medium text-emerald-600">
                        <CheckCircle2 className="h-3 w-3" /> {item.status}
                      </span>
                    </div>
                    <p className="mt-1 text-[9px] leading-4 text-muted-foreground">{item.detail}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="sostats-card xl:col-span-5">
          <div className="flex items-center justify-between border-b border-black/[0.055] px-5 py-4">
            <div>
              <p className="text-sm font-semibold">Knowledge sources</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">Indexed for retrieval</p>
            </div>
            <button className="text-[10px] font-semibold text-[#d92023]">Manage</button>
          </div>
          <div className="space-y-2 p-4">
            {sources.map((item) => (
              <div key={item.title} className="flex items-center gap-3 rounded-xl border border-black/[0.055] p-3">
                <div className="sostats-icon h-8 w-8">
                  <item.icon className="h-3.5 w-3.5 text-neutral-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[9px] font-semibold">{item.title}</p>
                  <p className="mt-0.5 text-[8px] text-muted-foreground">{item.type} · {item.count}</p>
                </div>
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="sostats-card overflow-hidden">
        <div className="border-b border-black/[0.055] px-5 py-4">
          <p className="text-sm font-semibold">How SoStats should sound</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">Example guidance used by generation pipelines</p>
        </div>
        <div className="grid gap-px bg-black/[0.045] md:grid-cols-3">
          {[
            ["Do", "Explain the workflow with concrete examples and confident, compact language."],
            ["Prefer", "Use direct product language: create, adapt, schedule, publish, learn."],
            ["Avoid", "Generic AI hype, unsupported performance claims and overlong introductions."],
          ].map(([title, body]) => (
            <div key={title} className="bg-white p-5">
              <p className="text-[9px] font-semibold text-[#d92023]">{title}</p>
              <p className="mt-2 text-[10px] leading-5 text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
