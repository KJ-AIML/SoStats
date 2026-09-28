"use client";

import { useState } from "react";
import {
  ArrowUpRight,
  Lightbulb,
  LoaderCircle,
  Sparkles,
} from "lucide-react";

type Insight = {
  finding: string;
  recommendation: string;
  impact_estimate: string;
};

export function AiInsightCard({
  workspaceSlug,
  brandId,
  hasData,
}: {
  workspaceSlug: string;
  brandId?: number;
  hasData: boolean;
}) {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [summary, setSummary] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/analytics/insights`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ brandId }),
        },
      );
      const payload = (await response.json()) as {
        insights?: Insight[];
        summary?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "Unable to generate insight");
      setInsights(payload.insights || []);
      setSummary(payload.summary || "");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to generate insight",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="sostats-card overflow-hidden">
      <div className="flex items-center justify-between border-b border-black/[0.055] px-5 py-4">
        <div>
          <p className="text-sm font-semibold">AI insight</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            Metrics + Brand Brain → next action
          </p>
        </div>
        <Lightbulb className="h-4 w-4 text-[#ef2b2d]" />
      </div>
      <div className="p-5">
        <div className="rounded-2xl bg-neutral-950 p-5 text-white">
          <div className="flex items-center gap-2 text-[9px] font-semibold text-red-200">
            <Sparkles className="h-3.5 w-3.5" />
            AI PERFORMANCE LOOP
          </div>

          {insights[0] ? (
            <>
              <p className="mt-4 text-[14px] font-semibold leading-5">
                {insights[0].finding}
              </p>
              <p className="mt-2 text-[10px] leading-4 text-white/55">
                {insights[0].recommendation}
              </p>
              {insights[0].impact_estimate && (
                <p className="mt-3 text-[9px] text-white/40">
                  {insights[0].impact_estimate}
                </p>
              )}
            </>
          ) : (
            <>
              <p className="mt-4 text-[14px] font-semibold leading-5">
                {hasData
                  ? "Turn current performance into the next content decision."
                  : "Metrics are needed before SoStats can generate an evidence-based insight."}
              </p>
              <p className="mt-2 text-[10px] leading-4 text-white/55">
                {summary ||
                  "SoStats only sends observed metrics and Brand Brain context to the insight engine."}
              </p>
            </>
          )}

          <button
            onClick={generate}
            disabled={loading || !hasData}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#ef2b2d] px-3 py-2 text-[9px] font-semibold disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? (
              <LoaderCircle className="h-3 w-3 animate-spin" />
            ) : (
              <ArrowUpRight className="h-3 w-3" />
            )}
            {loading ? "Analyzing..." : "Generate AI insight"}
          </button>
        </div>

        {error && (
          <p className="mt-3 rounded-xl bg-red-50 p-3 text-[9px] leading-4 text-red-700">
            {error}
          </p>
        )}

        {insights.length > 1 && (
          <div className="mt-3 space-y-2">
            {insights.slice(1, 3).map((insight) => (
              <div
                key={insight.finding}
                className="rounded-xl border border-black/[0.055] p-3"
              >
                <p className="text-[9px] font-semibold">{insight.finding}</p>
                <p className="mt-1 text-[8px] leading-4 text-muted-foreground">
                  {insight.recommendation}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
