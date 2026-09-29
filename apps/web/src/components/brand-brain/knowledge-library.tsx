"use client";

import { useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  DatabaseZap,
  FileText,
  Globe2,
  LoaderCircle,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { KnowledgeSourceRecord } from "@/lib/sostats-api.server";

type SourceMode = "url" | "text";

function statusClass(status: string) {
  if (status === "ready") return "bg-emerald-50 text-emerald-700";
  if (status === "failed") return "bg-red-50 text-red-700";
  return "bg-amber-50 text-amber-700";
}

export function KnowledgeLibrary({
  workspaceSlug,
  brandId,
  initialSources,
}: {
  workspaceSlug: string;
  brandId?: number;
  initialSources: KnowledgeSourceRecord[];
}) {
  const [sources, setSources] = useState(initialSources);
  const [showForm, setShowForm] = useState(false);
  const [mode, setMode] = useState<SourceMode>("url");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ready = useMemo(
    () => sources.filter((source) => source.status === "ready"),
    [sources],
  );
  const chunks = ready.reduce(
    (total, source) => total + Number(source.chunkCount || 0),
    0,
  );

  const addKnowledge = async () => {
    if (!brandId) {
      setError("Create a brand profile before adding knowledge.");
      return;
    }
    if (!title.trim()) {
      setError("Give this knowledge source a title.");
      return;
    }
    if (mode === "url" && !url.trim()) {
      setError("Enter a public website or PDF URL.");
      return;
    }
    if (mode === "text" && !text.trim()) {
      setError("Paste some source text.");
      return;
    }

    setBusy("create");
    setError(null);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/knowledge`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            brandId,
            sourceType: mode,
            title: title.trim(),
            url: mode === "url" ? url.trim() : undefined,
            text: mode === "text" ? text.trim() : undefined,
          }),
        },
      );
      const payload = (await response.json()) as KnowledgeSourceRecord & {
        error?: string;
        details?: unknown;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Knowledge ingestion failed");
      }

      setSources((current) => [payload, ...current]);
      setTitle("");
      setUrl("");
      setText("");
      setShowForm(false);
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Knowledge ingestion failed",
      );
    } finally {
      setBusy(null);
    }
  };

  const remove = async (sourceId: number) => {
    setBusy(`delete-${sourceId}`);
    setError(null);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/knowledge/${sourceId}`,
        { method: "DELETE" },
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to remove knowledge source");
      }
      setSources((current) =>
        current.filter((source) => source.id !== sourceId),
      );
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Unable to remove knowledge source",
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="sostats-card overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-black/[0.055] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <DatabaseZap className="h-4 w-4 text-[#ef2b2d]" />
            <p className="text-sm font-semibold">Knowledge library</p>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {ready.length} indexed sources · {chunks} semantic chunks available for retrieval
          </p>
        </div>
        <Button
          onClick={() => setShowForm((current) => !current)}
          disabled={!brandId || Boolean(busy)}
          className="h-9 rounded-xl bg-[#ef2b2d] text-[9px] hover:bg-[#da2427]"
        >
          {showForm ? (
            <X className="mr-1.5 h-3.5 w-3.5" />
          ) : (
            <Plus className="mr-1.5 h-3.5 w-3.5" />
          )}
          {showForm ? "Close" : "Add knowledge"}
        </Button>
      </div>

      {showForm && (
        <div className="border-b border-black/[0.055] bg-neutral-50/70 p-4 md:p-5">
          <div className="mx-auto max-w-3xl rounded-2xl border border-black/[0.06] bg-white p-4 shadow-sm">
            <div className="flex gap-2">
              {([
                ["url", "Website / PDF URL", Globe2],
                ["text", "Paste text", FileText],
              ] as const).map(([value, label, Icon]) => (
                <button
                  key={value}
                  onClick={() => setMode(value)}
                  className={
                    mode === value
                      ? "flex items-center gap-2 rounded-xl border border-[#ef2b2d]/15 bg-[#fff4f4] px-3 py-2 text-[9px] font-semibold text-[#d92023]"
                      : "flex items-center gap-2 rounded-xl border border-black/[0.06] bg-white px-3 py-2 text-[9px] font-medium text-neutral-500"
                  }
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>

            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="mb-1.5 block text-[9px] font-semibold text-neutral-500">
                  Source title
                </span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={
                    mode === "url" ? "Product documentation" : "Messaging notes"
                  }
                  className="h-10 w-full rounded-xl border border-black/[0.07] bg-neutral-50 px-3 text-[10px] outline-none focus:border-[#ef2b2d]/30"
                />
              </label>

              {mode === "url" ? (
                <label className="block">
                  <span className="mb-1.5 block text-[9px] font-semibold text-neutral-500">
                    Public URL
                  </span>
                  <input
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="https://example.com/docs or https://example.com/guide.pdf"
                    className="h-10 w-full rounded-xl border border-black/[0.07] bg-neutral-50 px-3 text-[10px] outline-none focus:border-[#ef2b2d]/30"
                  />
                  <span className="mt-1.5 block text-[8px] leading-4 text-muted-foreground">
                    SoStats accepts public HTML, text and PDF URLs. Private network targets are blocked before download.
                  </span>
                </label>
              ) : (
                <label className="block">
                  <span className="mb-1.5 block text-[9px] font-semibold text-neutral-500">
                    Source text
                  </span>
                  <textarea
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    rows={7}
                    placeholder="Paste product docs, positioning, FAQs, policies, or other source-of-truth material."
                    className="w-full resize-y rounded-xl border border-black/[0.07] bg-neutral-50 p-3 text-[10px] leading-5 outline-none focus:border-[#ef2b2d]/30"
                  />
                </label>
              )}

              <div className="flex items-center justify-between gap-3">
                <p className="text-[8px] leading-4 text-muted-foreground">
                  Ingestion extracts text, creates overlapping chunks, embeds them, and stores vectors in your workspace-scoped Brand Brain.
                </p>
                <Button
                  onClick={() => void addKnowledge()}
                  disabled={Boolean(busy)}
                  className="h-9 shrink-0 rounded-xl bg-neutral-950 text-[9px] text-white hover:bg-neutral-800"
                >
                  {busy === "create" ? (
                    <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <DatabaseZap className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {busy === "create" ? "Indexing..." : "Index source"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 border-b border-red-100 bg-red-50 px-5 py-3 text-[9px] text-red-700">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}

      <div className="divide-y divide-black/[0.045]">
        {sources.length ? (
          sources.map((source) => {
            const Icon = source.sourceType === "url" ? Globe2 : FileText;
            return (
              <div
                key={source.id}
                className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center"
              >
                <div className="sostats-icon h-10 w-10 shrink-0">
                  <Icon className="h-4 w-4 text-neutral-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-[10px] font-semibold">
                      {source.title}
                    </p>
                    <span
                      className={`rounded-md px-2 py-1 text-[8px] font-semibold ${statusClass(source.status)}`}
                    >
                      {source.status}
                    </span>
                    {source.status === "ready" && (
                      <span className="flex items-center gap-1 text-[8px] text-emerald-600">
                        <CheckCircle2 className="h-3 w-3" />
                        {source.chunkCount} chunks
                      </span>
                    )}
                  </div>
                  <p className="mt-1 truncate text-[8px] text-muted-foreground">
                    {source.sourceUrl ||
                      (source.mimeType
                        ? `${source.sourceType} · ${source.mimeType}`
                        : source.sourceType)}
                  </p>
                  {source.lastError && (
                    <p className="mt-1 line-clamp-2 text-[8px] text-red-600">
                      {source.lastError}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {source.embeddingModel && (
                    <span className="hidden text-[8px] text-muted-foreground md:inline">
                      {source.embeddingModel}
                    </span>
                  )}
                  <button
                    onClick={() => void remove(source.id)}
                    disabled={Boolean(busy)}
                    className="sostats-icon h-8 w-8 disabled:opacity-40"
                    aria-label={`Remove ${source.title}`}
                  >
                    {busy === `delete-${source.id}` ? (
                      <LoaderCircle className="h-3.5 w-3.5 animate-spin text-neutral-400" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5 text-neutral-400" />
                    )}
                  </button>
                </div>
              </div>
            );
          })
        ) : (
          <div className="px-5 py-12 text-center">
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-neutral-100">
              <DatabaseZap className="h-4 w-4 text-neutral-400" />
            </div>
            <p className="mt-3 text-[10px] font-semibold">
              No knowledge indexed yet
            </p>
            <p className="mx-auto mt-1 max-w-md text-[9px] leading-4 text-muted-foreground">
              Add your website, a public PDF, or pasted source-of-truth text. Relevant chunks will be retrieved automatically during AI generation.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
