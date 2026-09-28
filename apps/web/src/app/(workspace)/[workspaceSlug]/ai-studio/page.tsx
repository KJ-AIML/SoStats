"use client";

import { useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  FileText,
  Image as ImageIcon,
  Layers3,
  Play,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PageHeading } from "@/components/sostats/page-heading";

const channelOptions = ["LinkedIn", "X", "Instagram", "TikTok"];
const ideas = [
  {
    type: "LinkedIn",
    title: "Why content automation should start with the workflow, not the prompt",
    body: "Most teams do not have a content problem. They have a handoff problem. SoStats connects idea → review → publish → learn in one loop.",
  },
  {
    type: "X",
    title: "One idea → an entire campaign",
    body: "AI content gets useful when it stops being a text box and starts becoming infrastructure.",
  },
  {
    type: "TikTok",
    title: "30-second founder hook",
    body: "Show the old 7-tab workflow, then collapse it into one automated SoStats pipeline.",
  },
];

export default function AiStudioPage() {
  const [brief, setBrief] = useState(
    "Launch SoStats to startup founders and small marketing teams. Focus on how one idea becomes a complete multi-channel content pipeline.",
  );
  const [selectedChannels, setSelectedChannels] = useState(["LinkedIn", "X", "TikTok"]);
  const [generated, setGenerated] = useState(true);

  const toggleChannel = (channel: string) => {
    setSelectedChannels((current) =>
      current.includes(channel)
        ? current.filter((item) => item !== channel)
        : [...current, channel],
    );
  };

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 p-4 md:p-6 xl:p-8">
      <PageHeading
        eyebrow="AI Studio"
        title="Build a campaign from one idea"
        description="SoStats combines your Brand Brain with channel-aware generation to create a structured campaign, not a pile of disconnected prompts."
        actions={
          <Button className="h-10 rounded-xl bg-[#ef2b2d] px-4 text-xs hover:bg-[#da2427]">
            <Sparkles className="mr-2 h-4 w-4" />
            New campaign
          </Button>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[390px_minmax(0,1fr)]">
        <aside className="sostats-card self-start overflow-hidden">
          <div className="border-b border-black/[0.055] px-5 py-4">
            <p className="text-sm font-semibold">Campaign brief</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              The AI uses Brand Brain automatically.
            </p>
          </div>

          <div className="space-y-5 p-5">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-[11px] font-semibold">What are we creating?</label>
                <span className="text-[9px] text-muted-foreground">{brief.length}/500</span>
              </div>
              <Textarea
                value={brief}
                onChange={(event) => setBrief(event.target.value)}
                className="min-h-36 resize-none rounded-xl border-black/[0.07] bg-neutral-50 text-[12px] leading-5 shadow-none focus-visible:ring-[#ef2b2d]/20"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              {[
                ["Goal", "Product launch"],
                ["Audience", "Founders"],
                ["Tone", "Clear + bold"],
                ["Length", "14 days"],
              ].map(([label, value]) => (
                <button
                  key={label}
                  className="rounded-xl border border-black/[0.06] bg-neutral-50 p-3 text-left transition hover:bg-neutral-100"
                >
                  <p className="text-[9px] font-medium text-muted-foreground">{label}</p>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <p className="truncate text-[10px] font-semibold">{value}</p>
                    <ChevronDown className="h-3 w-3 text-neutral-400" />
                  </div>
                </button>
              ))}
            </div>

            <div>
              <p className="mb-2 text-[11px] font-semibold">Channels</p>
              <div className="flex flex-wrap gap-2">
                {channelOptions.map((channel) => {
                  const active = selectedChannels.includes(channel);
                  return (
                    <button
                      key={channel}
                      onClick={() => toggleChannel(channel)}
                      className={
                        active
                          ? "rounded-lg border border-[#ef2b2d]/15 bg-[#fff0f0] px-2.5 py-1.5 text-[10px] font-semibold text-[#d92023]"
                          : "rounded-lg border border-black/[0.07] bg-white px-2.5 py-1.5 text-[10px] font-medium text-neutral-500"
                      }
                    >
                      {channel}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-xl border border-black/[0.05] bg-neutral-50 p-3">
              <div className="flex items-center gap-2">
                <div className="sostats-icon h-8 w-8">
                  <Sparkles className="h-3.5 w-3.5 text-[#ef2b2d]" />
                </div>
                <div>
                  <p className="text-[10px] font-semibold">Brand Brain attached</p>
                  <p className="text-[9px] text-muted-foreground">Voice, audience, products + 12 knowledge sources</p>
                </div>
              </div>
            </div>

            <Button
              onClick={() => setGenerated(true)}
              className="h-11 w-full rounded-xl bg-neutral-950 text-xs text-white hover:bg-neutral-800"
            >
              <WandSparkles className="mr-2 h-4 w-4" />
              Generate campaign
            </Button>
          </div>
        </aside>

        <main className="min-w-0 space-y-4">
          <div className="sostats-card overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-black/[0.055] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold">SoStats launch campaign</p>
                  <Badge className="border-0 bg-emerald-50 text-[9px] text-emerald-700 shadow-none">
                    Generated
                  </Badge>
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  14 days · 3 channels · 11 content pieces
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="h-9 rounded-xl text-[10px]">
                  Save draft
                </Button>
                <Button className="h-9 rounded-xl bg-[#ef2b2d] text-[10px] hover:bg-[#da2427]">
                  Send to content
                  <ArrowRight className="ml-2 h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {generated ? (
              <div className="grid gap-px bg-black/[0.05] lg:grid-cols-[1fr_300px]">
                <div className="space-y-5 bg-white p-5">
                  <div>
                    <p className="sostats-kicker">Campaign strategy</p>
                    <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em]">
                      Own the workflow, not just the prompt.
                    </h2>
                    <p className="mt-2 max-w-3xl text-[11px] leading-5 text-muted-foreground">
                      Position SoStats as the operating layer that connects planning, generation, review, distribution and analytics. Lead with workflow pain, then show the closed-loop advantage.
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    {[
                      ["01", "Workflow pain", "Show the fragmented before state."],
                      ["02", "Automation payoff", "Demonstrate idea → channel variants."],
                      ["03", "Learning loop", "Turn performance back into content."],
                    ].map(([number, title, body]) => (
                      <div key={number} className="rounded-xl border border-black/[0.055] p-3.5">
                        <span className="font-mono text-[9px] text-[#ef2b2d]">{number}</span>
                        <p className="mt-2 text-[10px] font-semibold">{title}</p>
                        <p className="mt-1 text-[9px] leading-4 text-muted-foreground">{body}</p>
                      </div>
                    ))}
                  </div>

                  <div>
                    <div className="mb-3 flex items-center justify-between">
                      <div>
                        <p className="text-[11px] font-semibold">Generated content</p>
                        <p className="text-[9px] text-muted-foreground">Platform-specific variants from one campaign narrative</p>
                      </div>
                      <button className="text-[10px] font-semibold text-[#d92023]">View all 11</button>
                    </div>
                    <div className="space-y-2.5">
                      {ideas.map((idea) => (
                        <div key={idea.title} className="rounded-xl border border-black/[0.055] p-4 transition hover:border-black/10 hover:bg-neutral-50/60">
                          <div className="flex items-start gap-3">
                            <div className="sostats-icon h-9 w-9 shrink-0">
                              <FileText className="h-4 w-4 text-neutral-500" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-md bg-neutral-100 px-2 py-1 text-[9px] font-semibold text-neutral-600">
                                  {idea.type}
                                </span>
                                <span className="text-[9px] text-muted-foreground">Draft</span>
                              </div>
                              <p className="mt-2 text-[11px] font-semibold">{idea.title}</p>
                              <p className="mt-1 text-[10px] leading-4 text-muted-foreground">{idea.body}</p>
                            </div>
                            <button className="rounded-lg border border-black/[0.06] px-2.5 py-1.5 text-[9px] font-semibold text-neutral-500">
                              Edit
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <aside className="space-y-4 bg-neutral-50 p-4">
                  <div className="rounded-xl bg-neutral-950 p-4 text-white">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-red-300" />
                      <p className="text-[10px] font-semibold">AI rationale</p>
                    </div>
                    <p className="mt-3 text-[10px] leading-4 text-white/55">
                      Educational hooks are prioritized early, then product proof is layered in after the audience understands the workflow problem.
                    </p>
                  </div>

                  <div className="rounded-xl border border-black/[0.055] bg-white p-4">
                    <p className="text-[10px] font-semibold">Media plan</p>
                    <div className="mt-3 space-y-2">
                      {[
                        { icon: ImageIcon, label: "3 product visuals" },
                        { icon: Play, label: "4 short-video scripts" },
                        { icon: Layers3, label: "2 carousel briefs" },
                      ].map((item) => (
                        <div key={item.label} className="flex items-center gap-2.5">
                          <div className="sostats-icon h-7 w-7">
                            <item.icon className="h-3 w-3 text-neutral-500" />
                          </div>
                          <p className="text-[9px] font-medium">{item.label}</p>
                          <Check className="ml-auto h-3 w-3 text-emerald-500" />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl border border-black/[0.055] bg-white p-4">
                    <p className="text-[10px] font-semibold">Content pillars</p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {["Education", "Founder story", "Product proof", "Automation"].map((pillar) => (
                        <span key={pillar} className="rounded-full bg-neutral-100 px-2.5 py-1 text-[9px] text-neutral-600">
                          {pillar}
                        </span>
                      ))}
                    </div>
                  </div>
                </aside>
              </div>
            ) : (
              <div className="flex min-h-[520px] items-center justify-center p-8 text-center">
                <div>
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#fff0f0]">
                    <Sparkles className="h-5 w-5 text-[#ef2b2d]" />
                  </div>
                  <p className="mt-4 text-sm font-semibold">Your campaign will appear here</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Configure the brief and generate a structured campaign.
                  </p>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
