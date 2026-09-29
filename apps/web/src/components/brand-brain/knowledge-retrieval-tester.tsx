"use client";

import { useState } from "react";
import {
  BrainCircuit,
  ExternalLink,
  LoaderCircle,
  Search,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";

type SearchResult = {
  chunkId: number;
  sourceId: number;
  sourceTitle: string;
  sourceUrl?: string | null;
  sourceType: string;
  versionNumber: number;
  content: string;
  similarity: number;
};

function pct(value: number) {
  return `${Math.max(0, Math.min(100, value * 100)).toFixed(1)}%`;
}

export function KnowledgeRetrievalTester({
  workspaceSlug,
  brandId,
  readySourceCount,
}: {
  workspaceSlug: string;
  brandId?: number;
  readySourceCount: number;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastQuery, setLastQuery] = useState<string | null>(null);

  const search = async () => {
    if (!brandId || !query.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/knowledge/search`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            brandId,
            query: query.trim(),
            limit: 6,
          }),
        },
      );
      const payload = (await response.json()) as SearchResult[] & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(
          (payload as { error?: string }).error || "Knowledge search failed",
        );
      }
      setResults(payload);
      setLastQuery(query.trim());
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Knowledge search failed",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="sostats-card overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-black/[0.055] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <BrainCircuit className="h-4 w-4 text-[#ef2b2d]" />
            <p className="text-sm font-semibold">RAG retrieval test</p>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Run the same semantic retrieval boundary used before generation and
            inspect the actual source/version evidence.
          </p>
        </div>
        <span className="rounded-lg bg-neutral-100 px-2.5 py-1.5 text-[8px] font-semibold text-neutral-500">
          {readySourceCount} indexed source{readySourceCount === 1 ? "" : "s"}
        </span>
      </div>

      <div className="p-4 md:p-5">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl border border-black/[0.06] bg-neutral-50 px-3">
            <Search className="h-3.5 w-3.5 text-neutral-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void search();
              }}
              placeholder="Ask what your Brand Brain knows..."
              className="min-w-0 flex-1 bg-transparent text-[10px] outline-none"
            />
          </div>
          <Button
            onClick={() => void search()}
            disabled={!brandId || !query.trim() || busy || readySourceCount === 0}
            className="h-10 rounded-xl bg-neutral-950 px-4 text-[9px] hover:bg-neutral-800"
          >
            {busy ? (
              <LoaderCircle className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-3.5 w-3.5" />
            )}
            Retrieve evidence
          </Button>
        </div>

        {!brandId && (
          <p className="mt-3 rounded-xl bg-amber-50 p-3 text-[9px] text-amber-800">
            Create a Brand Brain before testing retrieval.
          </p>
        )}
        {brandId && readySourceCount === 0 && (
          <p className="mt-3 rounded-xl bg-neutral-50 p-3 text-[9px] text-muted-foreground">
            Index at least one ready knowledge source before testing retrieval.
          </p>
        )}
        {error && (
          <p className="mt-3 rounded-xl bg-red-50 p-3 text-[9px] text-red-700">
            {error}
          </p>
        )}

        {lastQuery && !busy && (
          <div className="mt-4">
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold">Retrieved evidence</p>
                <p className="mt-0.5 text-[8px] text-muted-foreground">
                  Query: “{lastQuery}”
                </p>
              </div>
              <span className="text-[8px] text-muted-foreground">
                {results.length} chunk{results.length === 1 ? "" : "s"} above
                similarity threshold
              </span>
            </div>

            {results.length ? (
              <div className="grid gap-3 lg:grid-cols-2">
                {results.map((result, index) => (
                  <article
                    key={result.chunkId}
                    className="rounded-2xl border border-black/[0.055] p-4"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#fff1f1] text-[9px] font-bold text-[#d92023]">
                        {String(index + 1).padStart(2, "0")}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-[9px] font-semibold">
                            {result.sourceTitle}
                          </p>
                          <span className="rounded-md bg-emerald-50 px-2 py-1 text-[7px] font-semibold text-emerald-700">
                            {pct(result.similarity)} match
                          </span>
                        </div>
                        <p className="mt-1 text-[7px] uppercase tracking-[0.06em] text-muted-foreground">
                          {result.sourceType} · source #{result.sourceId} · v
                          {result.versionNumber} · chunk #{result.chunkId}
                        </p>
                      </div>
                      {result.sourceUrl && (
                        <a
                          href={result.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="sostats-icon h-7 w-7 shrink-0"
                          aria-label="Open source"
                        >
                          <ExternalLink className="h-3 w-3 text-neutral-400" />
                        </a>
                      )}
                    </div>
                    <p className="mt-3 whitespace-pre-wrap text-[9px] leading-4 text-neutral-600">
                      {result.content}
                    </p>
                  </article>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-black/[0.08] bg-neutral-50 p-6 text-center text-[9px] text-muted-foreground">
                No chunks passed the configured similarity threshold. SoStats
                does not fabricate evidence when retrieval has no match.
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
