"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronDown,
  FileText,
  Image as ImageIcon,
  Layers3,
  LoaderCircle,
  Play,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PageHeading } from "@/components/sostats/page-heading";

type Campaign = {
  id: number;
  name: string;
  description?: string | null;
  goal?: string | null;
  status: string;
  generationContext?: {
    knowledgeEvidence?: Array<{
      chunkId: number;
      sourceId: number;
      sourceTitle: string;
      sourceUrl?: string | null;
      versionNumber?: number;
      similarity: number;
    }>;
  };
  channels?: Array<{ id: number; platform: string }>;
  pillars?: Array<{ id: number; pillar: string }>;
  contentItems?: Array<{
    id: number;
    title: string;
    description?: string | null;
    variants?: Array<{ id: number; platform?: string | null; content: string }>;
  }>;
};

const channelOptions = ["LinkedIn", "X", "Instagram", "TikTok"];

export default function AiStudioPage() {
  const params = useParams<{ workspaceSlug: string }>();
  const workspaceSlug = params.workspaceSlug;
  const [brief, setBrief] = useState(
    "Launch SoStats to startup founders and small marketing teams. Focus on how one idea becomes a complete multi-channel content pipeline.",
  );
  const [audience, setAudience] = useState("Founders + lean marketing teams");
  const [selectedChannels, setSelectedChannels] = useState(["LinkedIn", "X", "TikTok"]);
  const [brandId, setBrandId] = useState<number | undefined>();
  const [brandName, setBrandName] = useState("Brand Brain");
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/state`)
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as {
          brand?: { id: number; name: string } | null;
        };
      })
      .then((state) => {
        if (!active || !state?.brand) return;
        setBrandId(state.brand.id);
        setBrandName(state.brand.name);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [workspaceSlug]);

  const contentIdeas = campaign?.contentItems || [];
  const pillars = useMemo(
    () => campaign?.pillars?.map((item) => item.pillar) || [],
    [campaign],
  );
  const knowledgeEvidence =
    campaign?.generationContext?.knowledgeEvidence || [];
  const knowledgeSources = Array.from(
    new Map(
      knowledgeEvidence.map((item) => [item.sourceId, item]),
    ).values(),
  );

  const toggleChannel = (channel: string) => {
    setSelectedChannels((current) =>
      current.includes(channel)
        ? current.filter((item) => item !== channel)
        : [...current, channel],
    );
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/campaigns`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            brandId,
            name: "AI Content Automation Campaign",
            description: brief,
            goal: brief,
            channels: selectedChannels.map((channel) => channel.toLowerCase()),
            topic: brief,
            instructions: audience,
          }),
        },
      );
      const payload = (await response.json()) as Campaign & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Campaign generation failed");
      }
      setCampaign(payload);
    } catch (generationError) {
      setError(
        generationError instanceof Error
          ? generationError.message
          : "Campaign generation failed",
      );
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 p-4 md:p-6 xl:p-8">
      <PageHeading
        eyebrow="AI Studio"
        title="Build a campaign from one idea"
        description="SoStats combines your Brand Brain with channel-aware generation to create a structured campaign, not a pile of disconnected prompts."
        actions={
          <Button
            onClick={() => setCampaign(null)}
            className="h-10 rounded-xl bg-[#ef2b2d] px-4 text-xs hover:bg-[#da2427]"
          >
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
              <button className="rounded-xl border border-black/[0.06] bg-neutral-50 p-3 text-left">
                <p className="text-[9px] font-medium text-muted-foreground">Goal</p>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <p className="truncate text-[10px] font-semibold">Product launch</p>
                  <ChevronDown className="h-3 w-3 text-neutral-400" />
                </div>
              </button>
              <label className="rounded-xl border border-black/[0.06] bg-neutral-50 p-3 text-left">
                <span className="text-[9px] font-medium text-muted-foreground">Audience</span>
                <input
                  value={audience}
                  onChange={(event) => setAudience(event.target.value)}
                  className="mt-1 w-full bg-transparent text-[10px] font-semibold outline-none"
                />
              </label>
              <button className="rounded-xl border border-black/[0.06] bg-neutral-50 p-3 text-left">
                <p className="text-[9px] font-medium text-muted-foreground">Tone</p>
                <p className="mt-1 truncate text-[10px] font-semibold">From Brand Brain</p>
              </button>
              <button className="rounded-xl border border-black/[0.06] bg-neutral-50 p-3 text-left">
                <p className="text-[9px] font-medium text-muted-foreground">Length</p>
                <p className="mt-1 truncate text-[10px] font-semibold">Campaign plan</p>
              </button>
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
                  <p className="text-[10px] font-semibold">{brandName} attached</p>
                  <p className="text-[9px] text-muted-foreground">
                    Voice, audience, products, pillars and guardrails flow into generation.
                  </p>
                </div>
              </div>
            </div>

            {error && (
              <div className="flex gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-[9px] leading-4 text-red-700">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {error}
              </div>
            )}

            <Button
              onClick={handleGenerate}
              disabled={isGenerating || selectedChannels.length === 0 || !brief.trim()}
              className="h-11 w-full rounded-xl bg-neutral-950 text-xs text-white hover:bg-neutral-800"
            >
              {isGenerating ? (
                <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <WandSparkles className="mr-2 h-4 w-4" />
              )}
              {isGenerating ? "Generating with Brand Brain..." : "Generate campaign"}
            </Button>
          </div>
        </aside>

        <main className="min-w-0 space-y-4">
          <div className="sostats-card overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-black/[0.055] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold">
                    {campaign?.name || "Campaign workspace"}
                  </p>
                  {campaign && (
                    <Badge className="border-0 bg-emerald-50 text-[9px] text-emerald-700 shadow-none">
                      Saved to SoStats
                    </Badge>
                  )}
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {campaign
                    ? `${campaign.channels?.length || 0} channels · ${contentIdeas.length} content pieces`
                    : "Generate a campaign to create persisted content items and channel variants."}
                </p>
              </div>
              {campaign && (
                <Button className="h-9 rounded-xl bg-[#ef2b2d] text-[10px] hover:bg-[#da2427]">
                  Content created
                  <Check className="ml-2 h-3.5 w-3.5" />
                </Button>
              )}
            </div>

            {campaign ? (
              <div className="grid gap-px bg-black/[0.05] lg:grid-cols-[1fr_300px]">
                <div className="space-y-5 bg-white p-5">
                  <div>
                    <p className="sostats-kicker">Campaign strategy</p>
                    <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em]">
                      {campaign.goal || campaign.name}
                    </h2>
                    <p className="mt-2 max-w-3xl text-[11px] leading-5 text-muted-foreground">
                      {campaign.description || brief}
                    </p>
                  </div>

                  <div>
                    <div className="mb-3 flex items-center justify-between">
                      <div>
                        <p className="text-[11px] font-semibold">Generated content</p>
                        <p className="text-[9px] text-muted-foreground">
                          Persisted in the content pipeline with platform variants
                        </p>
                      </div>
                      <span className="text-[10px] font-semibold text-[#d92023]">
                        {contentIdeas.length} items
                      </span>
                    </div>
                    <div className="space-y-2.5">
                      {contentIdeas.map((idea) => (
                        <div
                          key={idea.id}
                          className="rounded-xl border border-black/[0.055] p-4 transition hover:border-black/10 hover:bg-neutral-50/60"
                        >
                          <div className="flex items-start gap-3">
                            <div className="sostats-icon h-9 w-9 shrink-0">
                              <FileText className="h-4 w-4 text-neutral-500" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                {(idea.variants || []).slice(0, 4).map((variant) => (
                                  <span
                                    key={variant.id}
                                    className="rounded-md bg-neutral-100 px-2 py-1 text-[9px] font-semibold capitalize text-neutral-600"
                                  >
                                    {variant.platform || "generic"}
                                  </span>
                                ))}
                              </div>
                              <p className="mt-2 text-[11px] font-semibold">{idea.title}</p>
                              <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                                {idea.description}
                              </p>
                            </div>
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
                      <p className="text-[10px] font-semibold">Real generation loop</p>
                    </div>
                    <p className="mt-3 text-[10px] leading-4 text-white/55">
                      This campaign was created through the NestJS API, enriched with structured Brand Brain context
                      {knowledgeSources.length
                        ? ` plus ${knowledgeSources.length} retrieved knowledge source${knowledgeSources.length === 1 ? "" : "s"}`
                        : ""}
                      , planned by the AI service, then persisted as campaign, content and variant records.
                    </p>
                  </div>

                  <div className="rounded-xl border border-black/[0.055] bg-white p-4">
                    <p className="text-[10px] font-semibold">Content pillars</p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {(pillars.length ? pillars : ["AI planned"]).map((pillar) => (
                        <span
                          key={pillar}
                          className="rounded-full bg-neutral-100 px-2.5 py-1 text-[9px] text-neutral-600"
                        >
                          {pillar}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl border border-black/[0.055] bg-white p-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] font-semibold">Knowledge grounding</p>
                      <span
                        className={
                          knowledgeSources.length
                            ? "text-[8px] font-semibold text-emerald-600"
                            : "text-[8px] font-medium text-neutral-400"
                        }
                      >
                        {knowledgeSources.length
                          ? `${knowledgeEvidence.length} chunks`
                          : "Structured context only"}
                      </span>
                    </div>
                    <div className="mt-3 space-y-2">
                      {knowledgeSources.length ? (
                        knowledgeSources.slice(0, 4).map((item) => (
                          <div
                            key={item.sourceId}
                            className="rounded-lg bg-neutral-50 px-3 py-2"
                          >
                            <p className="truncate text-[9px] font-semibold">
                              {item.sourceTitle}
                            </p>
                            <p className="mt-0.5 text-[8px] text-muted-foreground">
                              {item.versionNumber
                                ? `v${item.versionNumber} · `
                                : ""}
                              Semantic match {Math.round(item.similarity * 100)}%
                            </p>
                          </div>
                        ))
                      ) : (
                        <p className="text-[8px] leading-4 text-muted-foreground">
                          No indexed knowledge matched this brief. Voice, audience, products, pillars and guardrails still informed generation.
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="rounded-xl border border-black/[0.055] bg-white p-4">
                    <p className="text-[10px] font-semibold">Next in workflow</p>
                    <div className="mt-3 space-y-2">
                      {[
                        { icon: Layers3, label: "Review content board" },
                        { icon: ImageIcon, label: "Attach or generate media" },
                        { icon: Play, label: "Schedule approved variants" },
                      ].map((item) => (
                        <div key={item.label} className="flex items-center gap-2.5">
                          <div className="sostats-icon h-7 w-7">
                            <item.icon className="h-3 w-3 text-neutral-500" />
                          </div>
                          <p className="text-[9px] font-medium">{item.label}</p>
                          <ArrowRight className="ml-auto h-3 w-3 text-neutral-300" />
                        </div>
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
                  <p className="mt-4 text-sm font-semibold">Your live campaign will appear here</p>
                  <p className="mt-1 max-w-sm text-[10px] leading-4 text-muted-foreground">
                    Generate to create real campaign and content records through the SoStats API.
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
