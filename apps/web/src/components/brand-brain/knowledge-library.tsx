"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  DatabaseZap,
  FileText,
  FileUp,
  Globe2,
  LoaderCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { KnowledgeSourceRecord } from "@/lib/sostats-api.server";

type SourceMode = "url" | "text" | "file";

const PDF = "application/pdf";
const DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function statusClass(status: string) {
  if (status === "ready") return "bg-emerald-50 text-emerald-700";
  if (status === "failed") return "bg-red-50 text-red-700";
  if (status === "processing") return "bg-violet-50 text-violet-700";
  return "bg-amber-50 text-amber-700";
}

function formatBytes(size?: number | null) {
  if (!size) return null;
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
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
  const [mode, setMode] = useState<SourceMode>("file");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const ready = useMemo(
    () => sources.filter((source) => source.activeVersion > 0),
    [sources],
  );
  const chunks = ready.reduce(
    (total, source) => total + Number(source.chunkCount || 0),
    0,
  );
  const hasPending = sources.some((source) =>
    ["uploading", "uploaded", "processing"].includes(source.status),
  );

  useEffect(() => {
    if (!hasPending) return;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(
          `/api/workspaces/${encodeURIComponent(workspaceSlug)}/knowledge`,
          { cache: "no-store" },
        );
        if (!response.ok) return;
        setSources((await response.json()) as KnowledgeSourceRecord[]);
      } catch {
        // Background refresh is best-effort. Explicit actions surface errors.
      }
    }, 3500);
    return () => window.clearInterval(timer);
  }, [hasPending, workspaceSlug]);

  const resetForm = () => {
    setTitle("");
    setUrl("");
    setText("");
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const addSynchronousSource = async () => {
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
    };
    if (!response.ok) {
      throw new Error(payload.error || "Knowledge ingestion failed");
    }
    return payload;
  };

  const addPrivateFile = async () => {
    if (!file) throw new Error("Choose a PDF or DOCX file.");
    if (![PDF, DOCX].includes(file.type)) {
      throw new Error("Private knowledge uploads support PDF and DOCX files.");
    }

    const initResponse = await fetch(
      `/api/workspaces/${encodeURIComponent(workspaceSlug)}/knowledge/upload-url`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          brandId,
          title: title.trim(),
          fileName: file.name,
          mimeType: file.type,
          size: file.size,
        }),
      },
    );
    const initialized = (await initResponse.json()) as {
      uploadUrl?: string;
      source?: KnowledgeSourceRecord;
      error?: string;
    };
    if (!initResponse.ok || !initialized.uploadUrl || !initialized.source) {
      throw new Error(initialized.error || "Unable to initialize document upload");
    }

    setSources((current) => [initialized.source!, ...current]);

    const upload = await fetch(initialized.uploadUrl, {
      method: "PUT",
      headers: { "content-type": file.type },
      body: file,
    });
    if (!upload.ok) {
      throw new Error(`Private document upload failed with HTTP ${upload.status}`);
    }

    const complete = await fetch(
      `/api/workspaces/${encodeURIComponent(workspaceSlug)}/knowledge/${initialized.source.id}/complete-upload`,
      { method: "POST" },
    );
    const source = (await complete.json()) as KnowledgeSourceRecord & {
      error?: string;
    };
    if (!complete.ok) {
      throw new Error(source.error || "Unable to finalize document upload");
    }
    return source;
  };

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
      const source =
        mode === "file"
          ? await addPrivateFile()
          : await addSynchronousSource();

      setSources((current) => {
        const without = current.filter((item) => item.id !== source.id);
        return [source, ...without];
      });
      resetForm();
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

  const sourceAction = async (
    sourceId: number,
    action: "retry" | "reindex",
  ) => {
    setBusy(`${action}-${sourceId}`);
    setError(null);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/knowledge/${sourceId}/${action}`,
        { method: "POST" },
      );
      const payload = (await response.json()) as KnowledgeSourceRecord & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(
          payload.error || `Unable to ${action} knowledge source`,
        );
      }
      setSources((current) =>
        current.map((source) =>
          source.id === sourceId ? payload : source,
        ),
      );
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : `Unable to ${action} knowledge source`,
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
            {ready.length} active sources · {chunks} semantic chunks available for retrieval
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
            <div className="flex flex-wrap gap-2">
              {([
                ["file", "Private PDF / DOCX", FileUp],
                ["url", "Website / public PDF", Globe2],
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
                    mode === "file"
                      ? "Q4 product handbook"
                      : mode === "url"
                        ? "Product documentation"
                        : "Messaging notes"
                  }
                  className="h-10 w-full rounded-xl border border-black/[0.07] bg-neutral-50 px-3 text-[10px] outline-none focus:border-[#ef2b2d]/30"
                />
              </label>

              {mode === "file" && (
                <label className="block">
                  <span className="mb-1.5 block text-[9px] font-semibold text-neutral-500">
                    Private document
                  </span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    onChange={(event) =>
                      setFile(event.target.files?.[0] || null)
                    }
                    className="block w-full rounded-xl border border-dashed border-black/[0.09] bg-neutral-50 p-3 text-[9px] file:mr-3 file:rounded-lg file:border-0 file:bg-neutral-950 file:px-3 file:py-2 file:text-[9px] file:font-semibold file:text-white"
                  />
                  <span className="mt-1.5 block text-[8px] leading-4 text-muted-foreground">
                    PDF or DOCX up to 15 MB. The file is uploaded directly to private object storage, then indexed asynchronously by the worker.
                  </span>
                </label>
              )}

              {mode === "url" && (
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
                    Public HTML, text and PDF URLs are fetched through SoStats&apos; SSRF-protected ingestion boundary.
                  </span>
                </label>
              )}

              {mode === "text" && (
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

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[8px] leading-4 text-muted-foreground">
                  Active versions stay searchable while a private document is re-indexed. A new version becomes active only after every chunk is stored successfully.
                </p>
                <Button
                  onClick={() => void addKnowledge()}
                  disabled={Boolean(busy)}
                  className="h-9 shrink-0 rounded-xl bg-neutral-950 text-[9px] text-white hover:bg-neutral-800"
                >
                  {busy === "create" ? (
                    <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : mode === "file" ? (
                    <FileUp className="mr-1.5 h-3.5 w-3.5" />
                  ) : (
                    <DatabaseZap className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {busy === "create"
                    ? mode === "file"
                      ? "Uploading..."
                      : "Indexing..."
                    : mode === "file"
                      ? "Upload & index"
                      : "Index source"}
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
            const Icon =
              source.sourceType === "url"
                ? Globe2
                : source.sourceType === "file"
                  ? FileUp
                  : FileText;
            const pending = ["uploading", "uploaded", "processing"].includes(
              source.status,
            );
            return (
              <div
                key={source.id}
                className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center"
              >
                <div className="sostats-icon h-10 w-10 shrink-0">
                  {pending ? (
                    <LoaderCircle className="h-4 w-4 animate-spin text-violet-500" />
                  ) : (
                    <Icon className="h-4 w-4 text-neutral-500" />
                  )}
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
                    {source.activeVersion > 0 && (
                      <span className="flex items-center gap-1 text-[8px] text-emerald-600">
                        <CheckCircle2 className="h-3 w-3" />
                        v{source.activeVersion} · {source.chunkCount} chunks
                      </span>
                    )}
                    {source.processingVersion &&
                      source.processingVersion !== source.activeVersion && (
                        <span className="text-[8px] text-violet-600">
                          indexing v{source.processingVersion}
                        </span>
                      )}
                  </div>
                  <p className="mt-1 truncate text-[8px] text-muted-foreground">
                    {source.sourceUrl ||
                      source.fileName ||
                      (source.mimeType
                        ? `${source.sourceType} · ${source.mimeType}`
                        : source.sourceType)}
                    {source.fileSize
                      ? ` · ${formatBytes(source.fileSize)}`
                      : ""}
                  </p>
                  {source.lastError && (
                    <p className="mt-1 line-clamp-2 text-[8px] text-red-600">
                      {source.lastError}
                      {source.activeVersion > 0
                        ? " · Previous active version remains searchable."
                        : ""}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {source.embeddingModel && (
                    <span className="hidden text-[8px] text-muted-foreground xl:inline">
                      {source.embeddingModel}
                    </span>
                  )}

                  {source.sourceType === "file" &&
                    source.status === "failed" && (
                      <button
                        onClick={() =>
                          void sourceAction(source.id, "retry")
                        }
                        disabled={Boolean(busy)}
                        className="sostats-icon h-8 w-8 disabled:opacity-40"
                        aria-label={`Retry ${source.title}`}
                      >
                        {busy === `retry-${source.id}` ? (
                          <LoaderCircle className="h-3.5 w-3.5 animate-spin text-neutral-400" />
                        ) : (
                          <RotateCcw className="h-3.5 w-3.5 text-neutral-400" />
                        )}
                      </button>
                    )}

                  {source.sourceType === "file" &&
                    source.activeVersion > 0 &&
                    !pending && (
                      <button
                        onClick={() =>
                          void sourceAction(source.id, "reindex")
                        }
                        disabled={Boolean(busy)}
                        className="sostats-icon h-8 w-8 disabled:opacity-40"
                        aria-label={`Re-index ${source.title}`}
                      >
                        {busy === `reindex-${source.id}` ? (
                          <LoaderCircle className="h-3.5 w-3.5 animate-spin text-neutral-400" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5 text-neutral-400" />
                        )}
                      </button>
                    )}

                  <button
                    onClick={() => void remove(source.id)}
                    disabled={Boolean(busy) || pending}
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
              Upload a private PDF/DOCX, add a public URL, or paste source-of-truth text. Relevant chunks are retrieved automatically during generation.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
