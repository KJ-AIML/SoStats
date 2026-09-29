"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  FileText,
  Image as ImageIcon,
  Layers3,
  LoaderCircle,
  Play,
  RefreshCw,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PageHeading } from "@/components/sostats/page-heading";

type Campaign = {
  id: number;
  brandId?: number | null;
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
    variants?: Array<{
      id: number;
      platform?: string | null;
      content: string;
      status?: string;
    }>;
  }>;
};

type Brand = {
  id: number;
  name: string;
  description?: string | null;
};

type Provider = {
  provider: string;
  capabilities: {
    text: boolean;
    images: boolean;
    video: boolean;
    carousel: boolean;
    analytics: boolean;
    nativeScheduling: boolean;
  };
};

type SocialAccount = {
  id: number;
  provider: string;
  accountName?: string | null;
  status: string;
};

type KnowledgeSource = {
  id: number;
  brandId: number;
  title: string;
  sourceType: string;
  status: string;
  activeVersion: number;
  chunkCount: number;
};

type StudioState = {
  brand?: Brand | null;
  brands?: Brand[];
  providers?: Provider[];
  channels?: SocialAccount[];
  knowledge?: KnowledgeSource[];
  campaigns?: Campaign[];
};

type StudioTab = "strategy" | "posts" | "knowledge";

const templates = [
  {
    id: "product-launch",
    label: "Product launch",
    name: "Product Launch Campaign",
    goal: "Build awareness and qualified interest for a product launch",
    audience: "Prospects who match the product's core use case",
    brief:
      "Create a coordinated product-launch campaign that explains the problem, introduces the product clearly, shows practical value, and ends with a focused call to action.",
  },
  {
    id: "weekly-plan",
    label: "Weekly plan",
    name: "Weekly Content Plan",
    goal: "Maintain a useful, consistent publishing cadence this week",
    audience: "The brand's primary audience",
    brief:
      "Build a balanced one-week content plan using educational, proof, point-of-view, and product content. Keep each idea distinct while reinforcing one coherent brand narrative.",
  },
  {
    id: "repurpose",
    label: "Repurpose source",
    name: "Content Repurposing Campaign",
    goal: "Turn one source topic into multiple channel-native content ideas",
    audience: "Existing followers and new prospects",
    brief:
      "Repurpose one core topic into a campaign with distinct hooks and angles. Preserve the source meaning while adapting each idea for how people consume content on each selected channel.",
  },
  {
    id: "thought-leadership",
    label: "Thought leadership",
    name: "Thought Leadership Campaign",
    goal: "Build authority around a clear market point of view",
    audience: "Decision makers and practitioners in the target market",
    brief:
      "Create a thought-leadership campaign around a specific market belief. Include a strong point of view, practical evidence, educational follow-ups, and a clear next action.",
  },
] as const;

function providerLabel(provider: string) {
  if (provider.toLowerCase() === "x") return "X";
  if (provider.toLowerCase() === "linkedin") return "LinkedIn";
  return provider
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function capabilitySummary(provider: Provider) {
  const capabilities = [
    provider.capabilities.text ? "text" : null,
    provider.capabilities.images ? "images" : null,
    provider.capabilities.video ? "video" : null,
    provider.capabilities.analytics ? "analytics" : null,
  ].filter(Boolean);

  return capabilities.length ? capabilities.join(" · ") : "adapter available";
}

export default function AiStudioPage() {
  const params = useParams<{ workspaceSlug: string }>();
  const workspaceSlug = params.workspaceSlug;

  const [campaignName, setCampaignName] = useState("Product Launch Campaign");
  const [goal, setGoal] = useState(
    "Build awareness and qualified interest for a product launch",
  );
  const [brief, setBrief] = useState(
    "Launch SoStats to startup founders and small marketing teams. Focus on how one idea becomes a complete multi-channel content pipeline.",
  );
  const [audience, setAudience] = useState("Founders + lean marketing teams");
  const [selectedChannels, setSelectedChannels] = useState<string[]>([
    "linkedin",
    "x",
  ]);
  const [brandId, setBrandId] = useState<number | undefined>();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [channels, setChannels] = useState<SocialAccount[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgeSource[]>([]);
  const [recentCampaigns, setRecentCampaigns] = useState<Campaign[]>([]);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [activeTab, setActiveTab] = useState<StudioTab>("strategy");
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadedWorkspaceSlug, setLoadedWorkspaceSlug] = useState<string | null>(
    null,
  );
  const [stateError, setStateError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/state`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Unable to load the AI Studio workspace state");
        }
        return (await response.json()) as StudioState;
      })
      .then((state) => {
        if (!active) return;

        setStateError(null);
        const nextBrands = state.brands || [];
        const nextProviders = state.providers || [];
        setBrands(nextBrands);
        setProviders(nextProviders);
        setChannels(state.channels || []);
        setKnowledge(state.knowledge || []);
        setRecentCampaigns(state.campaigns || []);

        const defaultBrandId = state.brand?.id || nextBrands[0]?.id;
        if (defaultBrandId) setBrandId(defaultBrandId);

        const availableProviders = new Set(
          nextProviders.map((provider) => provider.provider.toLowerCase()),
        );
        setSelectedChannels((current) => {
          const valid = current.filter((provider) =>
            availableProviders.has(provider.toLowerCase()),
          );
          return valid.length
            ? valid
            : nextProviders.slice(0, 2).map((provider) => provider.provider);
        });
      })
      .catch((stateRequestError) => {
        if (!active) return;
        setStateError(
          stateRequestError instanceof Error
            ? stateRequestError.message
            : "Unable to load AI Studio",
        );
      })
      .finally(() => {
        if (active) setLoadedWorkspaceSlug(workspaceSlug);
      });

    return () => {
      active = false;
    };
  }, [workspaceSlug]);

  const isLoadingState = loadedWorkspaceSlug !== workspaceSlug;

  const selectedBrand = useMemo(
    () => brands.find((brand) => brand.id === brandId) || null,
    [brandId, brands],
  );

  const selectedBrandKnowledge = useMemo(
    () =>
      knowledge.filter(
        (source) =>
          source.brandId === brandId &&
          source.activeVersion > 0 &&
          source.status !== "uploading",
      ),
    [brandId, knowledge],
  );

  const connectedProviders = useMemo(
    () =>
      new Set(
        channels
          .filter((channel) => channel.status === "active")
          .map((channel) => channel.provider.toLowerCase()),
      ),
    [channels],
  );

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

  const toggleChannel = (provider: string) => {
    setSelectedChannels((current) =>
      current.includes(provider)
        ? current.filter((item) => item !== provider)
        : [...current, provider],
    );
  };

  const applyTemplate = (template: (typeof templates)[number]) => {
    setCampaignName(template.name);
    setGoal(template.goal);
    setAudience(template.audience);
    setBrief(template.brief);
    setError(null);
  };

  const startNewCampaign = () => {
    setCampaign(null);
    setActiveTab("strategy");
    setError(null);
  };

  const openCampaign = (item: Campaign) => {
    setCampaign(item);
    setActiveTab("strategy");
    setError(null);
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
            name: campaignName.trim(),
            description: brief.trim(),
            goal: goal.trim(),
            channels: selectedChannels,
            topic: brief.trim(),
            instructions: audience.trim(),
          }),
        },
      );
      const payload = (await response.json()) as Campaign & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Campaign generation failed");
      }

      setCampaign(payload);
      setRecentCampaigns((current) => [
        payload,
        ...current.filter((item) => item.id !== payload.id),
      ]);
      setActiveTab("strategy");
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

  const canGenerate =
    !isGenerating &&
    !isLoadingState &&
    campaignName.trim().length > 0 &&
    goal.trim().length > 0 &&
    brief.trim().length > 0 &&
    audience.trim().length > 0 &&
    selectedChannels.length > 0 &&
    providers.length > 0;

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 p-4 md:p-6 xl:p-8">
      <PageHeading
        eyebrow="AI Studio"
        title="Build campaigns with your real brand context"
        description="Choose the brand, brief and supported providers. SoStats retrieves relevant Brand Brain evidence, plans the campaign, and persists content plus channel variants into the workflow."
        actions={
          <Button
            onClick={startNewCampaign}
            className="h-10 rounded-xl bg-[#ef2b2d] px-4 text-xs hover:bg-[#da2427]"
          >
            <Sparkles className="mr-2 h-4 w-4" />
            New campaign
          </Button>
        }
      />

      {stateError && (
        <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[10px] leading-4 text-amber-800">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {stateError}. Generation is disabled until the API workspace is available.
        </div>
      )}

      <section className="sostats-card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-black/[0.055] px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold">Quick starts</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Templates fill the real campaign brief. You can edit everything before generation.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {templates.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => applyTemplate(template)}
                className="rounded-lg border border-black/[0.07] bg-white px-3 py-2 text-[9px] font-semibold text-neutral-600 transition hover:border-[#ef2b2d]/25 hover:bg-[#fff7f7] hover:text-[#d92023]"
              >
                {template.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[410px_minmax(0,1fr)]">
        <aside className="space-y-4 self-start">
          <section className="sostats-card overflow-hidden">
            <div className="border-b border-black/[0.055] px-5 py-4">
              <p className="text-sm font-semibold">Campaign brief</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                These inputs become real campaign and generation records.
              </p>
            </div>

            <div className="space-y-4 p-5">
              <label className="block">
                <span className="text-[10px] font-semibold">Campaign name</span>
                <input
                  value={campaignName}
                  onChange={(event) => setCampaignName(event.target.value)}
                  maxLength={120}
                  className="mt-2 h-10 w-full rounded-xl border border-black/[0.07] bg-neutral-50 px-3 text-[11px] outline-none transition focus:border-[#ef2b2d]/30"
                />
              </label>

              <label className="block">
                <span className="text-[10px] font-semibold">Goal</span>
                <input
                  value={goal}
                  onChange={(event) => setGoal(event.target.value)}
                  maxLength={280}
                  className="mt-2 h-10 w-full rounded-xl border border-black/[0.07] bg-neutral-50 px-3 text-[11px] outline-none transition focus:border-[#ef2b2d]/30"
                />
              </label>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-[10px] font-semibold">
                    Campaign context
                  </label>
                  <span className="text-[9px] text-muted-foreground">
                    {brief.length}/1200
                  </span>
                </div>
                <Textarea
                  value={brief}
                  maxLength={1200}
                  onChange={(event) => setBrief(event.target.value)}
                  className="min-h-36 resize-none rounded-xl border-black/[0.07] bg-neutral-50 text-[11px] leading-5 shadow-none focus-visible:ring-[#ef2b2d]/20"
                />
              </div>

              <label className="block">
                <span className="text-[10px] font-semibold">Audience / instructions</span>
                <input
                  value={audience}
                  onChange={(event) => setAudience(event.target.value)}
                  maxLength={500}
                  className="mt-2 h-10 w-full rounded-xl border border-black/[0.07] bg-neutral-50 px-3 text-[11px] outline-none transition focus:border-[#ef2b2d]/30"
                />
              </label>

              <div>
                <p className="mb-2 text-[10px] font-semibold">Brand Brain</p>
                {brands.length ? (
                  <select
                    value={brandId || ""}
                    onChange={(event) =>
                      setBrandId(
                        event.target.value
                          ? Number.parseInt(event.target.value, 10)
                          : undefined,
                      )
                    }
                    className="h-10 w-full rounded-xl border border-black/[0.07] bg-neutral-50 px-3 text-[10px] font-semibold outline-none"
                  >
                    {brands.map((brand) => (
                      <option key={brand.id} value={brand.id}>
                        {brand.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Link
                    href={`/${workspaceSlug}/brand-brain`}
                    className="flex items-center justify-between rounded-xl border border-dashed border-black/[0.09] bg-neutral-50 p-3 text-[10px] font-semibold text-neutral-600"
                  >
                    Configure Brand Brain
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                )}
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[10px] font-semibold">Generation channels</p>
                  <span className="text-[8px] text-muted-foreground">
                    Provider registry
                  </span>
                </div>

                {isLoadingState ? (
                  <div className="flex items-center gap-2 rounded-xl bg-neutral-50 p-3 text-[9px] text-muted-foreground">
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                    Loading provider capabilities...
                  </div>
                ) : providers.length ? (
                  <div className="space-y-2">
                    {providers.map((provider) => {
                      const active = selectedChannels.includes(provider.provider);
                      const connected = connectedProviders.has(
                        provider.provider.toLowerCase(),
                      );

                      return (
                        <button
                          key={provider.provider}
                          type="button"
                          onClick={() => toggleChannel(provider.provider)}
                          className={
                            active
                              ? "flex w-full items-center gap-3 rounded-xl border border-[#ef2b2d]/15 bg-[#fff7f7] p-3 text-left"
                              : "flex w-full items-center gap-3 rounded-xl border border-black/[0.06] bg-neutral-50 p-3 text-left"
                          }
                        >
                          <div
                            className={
                              active
                                ? "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#ef2b2d] text-[10px] font-bold text-white"
                                : "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neutral-950 text-[10px] font-bold text-white"
                            }
                          >
                            {providerLabel(provider.provider).slice(0, 2)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="text-[10px] font-semibold">
                                {providerLabel(provider.provider)}
                              </p>
                              <span
                                className={
                                  connected
                                    ? "text-[8px] font-semibold text-emerald-600"
                                    : "text-[8px] font-medium text-neutral-400"
                                }
                              >
                                {connected ? "Connected" : "Not connected"}
                              </span>
                            </div>
                            <p className="mt-0.5 truncate text-[8px] text-muted-foreground">
                              {capabilitySummary(provider)}
                            </p>
                          </div>
                          <span
                            className={
                              active
                                ? "flex h-5 w-5 items-center justify-center rounded-full bg-[#ef2b2d] text-white"
                                : "h-5 w-5 rounded-full border border-black/10 bg-white"
                            }
                          >
                            {active && <Check className="h-3 w-3" />}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-black/[0.09] bg-neutral-50 p-3 text-[9px] leading-4 text-muted-foreground">
                    No social provider adapters are available from the API.
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-black/[0.05] bg-neutral-50 p-3">
                <div className="flex items-start gap-2.5">
                  <div className="sostats-icon h-8 w-8 shrink-0">
                    <BookOpen className="h-3.5 w-3.5 text-[#ef2b2d]" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold">
                      {selectedBrand?.name || "No Brand Brain selected"}
                    </p>
                    <p className="mt-0.5 text-[9px] leading-4 text-muted-foreground">
                      {selectedBrand
                        ? `${selectedBrandKnowledge.length} indexed knowledge source${selectedBrandKnowledge.length === 1 ? "" : "s"} available for semantic retrieval. Structured brand context is resolved server-side.`
                        : "Generation can run without a brand, but no Brand Brain retrieval will be available."}
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
                disabled={!canGenerate}
                className="h-11 w-full rounded-xl bg-neutral-950 text-xs text-white hover:bg-neutral-800"
              >
                {isGenerating ? (
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <WandSparkles className="mr-2 h-4 w-4" />
                )}
                {isGenerating
                  ? "Retrieving context + generating..."
                  : "Generate campaign"}
              </Button>

              {!isLoadingState && providers.length > 0 && (
                <p className="text-center text-[8px] leading-4 text-muted-foreground">
                  Generation can create variants for a supported provider before OAuth is connected.
                  Publishing still requires an active channel account.
                </p>
              )}
            </div>
          </section>

          <section className="sostats-card overflow-hidden">
            <div className="flex items-center justify-between border-b border-black/[0.055] px-4 py-3">
              <div>
                <p className="text-[11px] font-semibold">Recent campaigns</p>
                <p className="text-[8px] text-muted-foreground">
                  Reload persisted AI Studio work
                </p>
              </div>
              <RefreshCw className="h-3.5 w-3.5 text-neutral-400" />
            </div>
            <div className="max-h-72 divide-y divide-black/[0.045] overflow-auto px-3">
              {recentCampaigns.length ? (
                recentCampaigns.slice(0, 8).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => openCampaign(item)}
                    className="flex w-full items-center gap-3 py-3 text-left"
                  >
                    <div className="sostats-icon h-8 w-8 shrink-0">
                      <Sparkles className="h-3.5 w-3.5 text-neutral-500" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[9px] font-semibold">
                        {item.name}
                      </p>
                      <p className="mt-0.5 text-[8px] capitalize text-muted-foreground">
                        {item.status} · {item.contentItems?.length || 0} items
                      </p>
                    </div>
                    <ArrowRight className="h-3 w-3 text-neutral-300" />
                  </button>
                ))
              ) : (
                <p className="py-7 text-center text-[9px] text-muted-foreground">
                  No saved campaigns yet.
                </p>
              )}
            </div>
          </section>
        </aside>

        <main className="min-w-0 space-y-4">
          <section className="sostats-card overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-black/[0.055] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold">
                    {campaign?.name || "Campaign workspace"}
                  </p>
                  {campaign && (
                    <Badge className="border-0 bg-emerald-50 text-[9px] text-emerald-700 shadow-none">
                      Persisted
                    </Badge>
                  )}
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {campaign
                    ? `${campaign.channels?.length || 0} channels · ${contentIdeas.length} content pieces · ${knowledgeEvidence.length} retrieved chunks`
                    : "Generate a campaign or open a previous one to inspect strategy, posts and retrieval evidence."}
                </p>
              </div>
              {campaign && (
                <Link
                  href={`/${workspaceSlug}/content`}
                  className="inline-flex h-9 items-center gap-2 self-start rounded-xl bg-[#ef2b2d] px-3 text-[10px] font-semibold text-white transition hover:bg-[#da2427] sm:self-auto"
                >
                  Open content pipeline
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              )}
            </div>

            {campaign ? (
              <>
                <div className="flex gap-1 border-b border-black/[0.055] bg-neutral-50 px-4 py-2">
                  {[
                    ["strategy", "Strategy"],
                    ["posts", `Posts (${contentIdeas.length})`],
                    ["knowledge", `Knowledge (${knowledgeEvidence.length})`],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setActiveTab(value as StudioTab)}
                      className={
                        activeTab === value
                          ? "rounded-lg bg-white px-3 py-2 text-[9px] font-semibold text-neutral-900 shadow-sm"
                          : "rounded-lg px-3 py-2 text-[9px] font-medium text-neutral-500 hover:text-neutral-800"
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {activeTab === "strategy" && (
                  <div className="grid gap-px bg-black/[0.05] lg:grid-cols-[minmax(0,1fr)_300px]">
                    <div className="space-y-6 bg-white p-5">
                      <div>
                        <p className="sostats-kicker">Campaign strategy</p>
                        <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em]">
                          {campaign.goal || campaign.name}
                        </h2>
                        <p className="mt-2 max-w-3xl text-[11px] leading-5 text-muted-foreground">
                          {campaign.description || "No campaign description saved."}
                        </p>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-3">
                        <div className="rounded-xl border border-black/[0.055] p-4">
                          <p className="text-[9px] text-muted-foreground">Content</p>
                          <p className="mt-1 text-2xl font-semibold tracking-[-0.04em]">
                            {contentIdeas.length}
                          </p>
                          <p className="mt-1 text-[8px] text-muted-foreground">
                            persisted items
                          </p>
                        </div>
                        <div className="rounded-xl border border-black/[0.055] p-4">
                          <p className="text-[9px] text-muted-foreground">Channels</p>
                          <p className="mt-1 text-2xl font-semibold tracking-[-0.04em]">
                            {campaign.channels?.length || 0}
                          </p>
                          <p className="mt-1 text-[8px] text-muted-foreground">
                            generated variants
                          </p>
                        </div>
                        <div className="rounded-xl border border-black/[0.055] p-4">
                          <p className="text-[9px] text-muted-foreground">Evidence</p>
                          <p className="mt-1 text-2xl font-semibold tracking-[-0.04em]">
                            {knowledgeEvidence.length}
                          </p>
                          <p className="mt-1 text-[8px] text-muted-foreground">
                            retrieved chunks
                          </p>
                        </div>
                      </div>

                      <div>
                        <p className="text-[10px] font-semibold">Content pillars</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {pillars.length ? (
                            pillars.map((pillar) => (
                              <span
                                key={pillar}
                                className="rounded-full border border-black/[0.055] bg-neutral-50 px-3 py-1.5 text-[9px] font-medium text-neutral-600"
                              >
                                {pillar}
                              </span>
                            ))
                          ) : (
                            <span className="text-[9px] text-muted-foreground">
                              No campaign pillars were persisted.
                            </span>
                          )}
                        </div>
                      </div>

                      <div>
                        <p className="text-[10px] font-semibold">Channel plan</p>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          {(campaign.channels || []).map((channel) => (
                            <div
                              key={channel.id}
                              className="flex items-center gap-3 rounded-xl border border-black/[0.055] p-3"
                            >
                              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-950 text-[9px] font-bold text-white">
                                {providerLabel(channel.platform).slice(0, 2)}
                              </div>
                              <div>
                                <p className="text-[9px] font-semibold">
                                  {providerLabel(channel.platform)}
                                </p>
                                <p className="mt-0.5 text-[8px] text-muted-foreground">
                                  Platform-specific variants persisted
                                </p>
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
                          <p className="text-[10px] font-semibold">
                            Generation provenance
                          </p>
                        </div>
                        <p className="mt-3 text-[9px] leading-4 text-white/55">
                          Brand context and relevant knowledge are resolved before the AI plan.
                          The API then persists the campaign, content items, channel variants,
                          pillars and source evidence.
                        </p>
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
                              ? `${knowledgeSources.length} sources`
                              : "No semantic match"}
                          </span>
                        </div>
                        <div className="mt-3 space-y-2">
                          {knowledgeSources.length ? (
                            knowledgeSources.slice(0, 4).map((item) => (
                              <button
                                key={item.sourceId}
                                type="button"
                                onClick={() => setActiveTab("knowledge")}
                                className="w-full rounded-lg bg-neutral-50 px-3 py-2 text-left"
                              >
                                <p className="truncate text-[9px] font-semibold">
                                  {item.sourceTitle}
                                </p>
                                <p className="mt-0.5 text-[8px] text-muted-foreground">
                                  {item.versionNumber ? `v${item.versionNumber} · ` : ""}
                                  match {Math.round(item.similarity * 100)}%
                                </p>
                              </button>
                            ))
                          ) : (
                            <p className="text-[8px] leading-4 text-muted-foreground">
                              The generation used structured Brand Brain context, but no indexed
                              chunk crossed retrieval relevance for this brief.
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="rounded-xl border border-black/[0.055] bg-white p-4">
                        <p className="text-[10px] font-semibold">Continue workflow</p>
                        <div className="mt-3 space-y-2">
                          {[
                            {
                              href: `/${workspaceSlug}/content`,
                              icon: Layers3,
                              label: "Review content pipeline",
                            },
                            {
                              href: `/${workspaceSlug}/media`,
                              icon: ImageIcon,
                              label: "Attach media assets",
                            },
                            {
                              href: `/${workspaceSlug}/calendar`,
                              icon: Play,
                              label: "Schedule approved variants",
                            },
                          ].map((item) => (
                            <Link
                              key={item.label}
                              href={item.href}
                              className="flex items-center gap-2.5 rounded-lg p-1 transition hover:bg-neutral-50"
                            >
                              <div className="sostats-icon h-7 w-7">
                                <item.icon className="h-3 w-3 text-neutral-500" />
                              </div>
                              <p className="text-[9px] font-medium">{item.label}</p>
                              <ArrowRight className="ml-auto h-3 w-3 text-neutral-300" />
                            </Link>
                          ))}
                        </div>
                      </div>
                    </aside>
                  </div>
                )}

                {activeTab === "posts" && (
                  <div className="space-y-3 p-5">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <p className="text-[11px] font-semibold">Generated content</p>
                        <p className="mt-0.5 text-[9px] text-muted-foreground">
                          These are persisted content items with real channel variants.
                        </p>
                      </div>
                      <Link
                        href={`/${workspaceSlug}/content`}
                        className="text-[9px] font-semibold text-[#df272a]"
                      >
                        Edit in content pipeline
                      </Link>
                    </div>

                    {contentIdeas.length ? (
                      contentIdeas.map((idea) => (
                        <article
                          key={idea.id}
                          className="rounded-2xl border border-black/[0.055] p-4"
                        >
                          <div className="flex items-start gap-3">
                            <div className="sostats-icon h-9 w-9 shrink-0">
                              <FileText className="h-4 w-4 text-neutral-500" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-[11px] font-semibold">{idea.title}</p>
                              {idea.description && (
                                <p className="mt-1 text-[9px] leading-4 text-muted-foreground">
                                  {idea.description}
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="mt-4 grid gap-2 lg:grid-cols-2">
                            {(idea.variants || []).map((variant) => (
                              <div
                                key={variant.id}
                                className="rounded-xl border border-black/[0.05] bg-neutral-50 p-3"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="rounded-md bg-white px-2 py-1 text-[8px] font-semibold capitalize text-neutral-600">
                                    {providerLabel(variant.platform || "generic")}
                                  </span>
                                  <span className="text-[8px] capitalize text-muted-foreground">
                                    {variant.status || "draft"}
                                  </span>
                                </div>
                                <p className="mt-2 line-clamp-5 whitespace-pre-wrap text-[9px] leading-4 text-neutral-600">
                                  {variant.content}
                                </p>
                              </div>
                            ))}
                          </div>
                        </article>
                      ))
                    ) : (
                      <div className="rounded-xl border border-dashed border-black/[0.08] p-8 text-center text-[9px] text-muted-foreground">
                        This campaign has no persisted content items.
                      </div>
                    )}
                  </div>
                )}

                {activeTab === "knowledge" && (
                  <div className="space-y-4 p-5">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <p className="text-[11px] font-semibold">Retrieval evidence</p>
                        <p className="mt-0.5 text-[9px] text-muted-foreground">
                          Source, active version and semantic similarity persisted with this campaign.
                        </p>
                      </div>
                      <Link
                        href={`/${workspaceSlug}/brand-brain`}
                        className="text-[9px] font-semibold text-[#df272a]"
                      >
                        Manage Brand Brain
                      </Link>
                    </div>

                    {knowledgeEvidence.length ? (
                      <div className="grid gap-3 md:grid-cols-2">
                        {knowledgeEvidence.map((item) => (
                          <div
                            key={item.chunkId}
                            className="rounded-xl border border-black/[0.055] p-4"
                          >
                            <div className="flex items-start gap-3">
                              <div className="sostats-icon h-8 w-8 shrink-0">
                                <BookOpen className="h-3.5 w-3.5 text-neutral-500" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[10px] font-semibold">
                                  {item.sourceTitle}
                                </p>
                                <p className="mt-1 text-[8px] text-muted-foreground">
                                  Chunk #{item.chunkId}
                                  {item.versionNumber
                                    ? ` · source v${item.versionNumber}`
                                    : ""}
                                </p>
                              </div>
                              <span className="rounded-md bg-emerald-50 px-2 py-1 text-[8px] font-semibold text-emerald-700">
                                {Math.round(item.similarity * 100)}%
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed border-black/[0.08] bg-neutral-50 p-8 text-center">
                        <BookOpen className="mx-auto h-5 w-5 text-neutral-300" />
                        <p className="mt-2 text-[10px] font-semibold">
                          No semantic knowledge evidence was persisted for this campaign.
                        </p>
                        <p className="mx-auto mt-1 max-w-lg text-[9px] leading-4 text-muted-foreground">
                          Structured Brand Brain fields may still have informed generation.
                          Add indexed documents, URLs or text to improve source-grounded retrieval.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="grid min-h-[620px] place-items-center p-8 text-center">
                <div className="max-w-md">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#fff0f0]">
                    <Sparkles className="h-5 w-5 text-[#ef2b2d]" />
                  </div>
                  <p className="mt-4 text-sm font-semibold">
                    Campaign strategy, posts and evidence appear here
                  </p>
                  <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                    Use a quick start or write your own brief. Generation creates real
                    campaign, content, variant and provenance records through the SoStats API.
                  </p>
                  <div className="mt-5 flex flex-wrap justify-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-100 px-3 py-1.5 text-[8px] font-medium text-neutral-600">
                      <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                      Provider-aware
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-100 px-3 py-1.5 text-[8px] font-medium text-neutral-600">
                      <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                      RAG-grounded
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-100 px-3 py-1.5 text-[8px] font-medium text-neutral-600">
                      <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                      Persisted
                    </span>
                  </div>
                </div>
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
