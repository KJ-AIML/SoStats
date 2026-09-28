"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Lightbulb,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";
import type { AiInsightRecord } from "@/lib/sostats-api.server";

function actionLabel(type: AiInsightRecord["actionType"]) {
  switch (type) {
    case "create_campaign":
      return "Create recommended campaign";
    case "repurpose_content":
      return "Repurpose winner";
    case "reschedule_publication":
      return "Apply schedule change";
    default:
      return "No action";
  }
}

function ActionIcon({ type }: { type: AiInsightRecord["actionType"] }) {
  if (type === "reschedule_publication") {
    return <CalendarClock className="h-3 w-3" />;
  }
  if (type === "repurpose_content") {
    return <RefreshCw className="h-3 w-3" />;
  }
  return <WandSparkles className="h-3 w-3" />;
}

export function AiInsightCard({
  workspaceSlug,
  brandId,
  hasData,
  initialInsights,
}: {
  workspaceSlug: string;
  brandId?: number;
  hasData: boolean;
  initialInsights: AiInsightRecord[];
}) {
  const [insights, setInsights] = useState(initialInsights);
  const [summary, setSummary] = useState(
    initialInsights[0]?.summary || "",
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  const generate = async () => {
    setLoading("generate");
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
        insights?: AiInsightRecord[];
        summary?: string;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to generate recommendations");
      }
      setInsights(payload.insights || []);
      setSummary(payload.summary || "");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to generate recommendations",
      );
    } finally {
      setLoading(null);
    }
  };

  const execute = async (insight: AiInsightRecord) => {
    setLoading(`execute-${insight.id}`);
    setError(null);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/analytics/insights/${insight.id}/execute`,
        { method: "POST" },
      );
      const payload = (await response.json()) as AiInsightRecord & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to apply recommendation");
      }
      setInsights((current) =>
        current.map((item) => (item.id === insight.id ? payload : item)),
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to apply recommendation",
      );
    } finally {
      setLoading(null);
    }
  };

  const dismiss = async (insight: AiInsightRecord) => {
    setLoading(`dismiss-${insight.id}`);
    setError(null);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/analytics/insights/${insight.id}/dismiss`,
        { method: "POST" },
      );
      const payload = (await response.json()) as AiInsightRecord & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to dismiss recommendation");
      }
      setInsights((current) =>
        current.map((item) => (item.id === insight.id ? payload : item)),
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to dismiss recommendation",
      );
    } finally {
      setLoading(null);
    }
  };

  const visible = insights
    .filter((item) => !["dismissed", "superseded"].includes(item.status))
    .slice(0, 4);

  return (
    <section className="sostats-card overflow-hidden">
      <div className="flex items-center justify-between border-b border-black/[0.055] px-5 py-4">
        <div>
          <p className="text-sm font-semibold">AI learning loop</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            Evidence → recommendation → user-approved action
          </p>
        </div>
        <Lightbulb className="h-4 w-4 text-[#ef2b2d]" />
      </div>

      <div className="p-4">
        <div className="rounded-2xl bg-neutral-950 p-5 text-white">
          <div className="flex items-center gap-2 text-[9px] font-semibold text-red-200">
            <Sparkles className="h-3.5 w-3.5" />
            CLOSED LEARNING LOOP
          </div>
          <p className="mt-4 text-[14px] font-semibold leading-5">
            {hasData
              ? "Turn observed performance into the next controlled content action."
              : "Provider metrics are required before SoStats can recommend an action."}
          </p>
          <p className="mt-2 text-[10px] leading-4 text-white/55">
            {summary ||
              "Recommendations are grounded in the last 30 days of real metrics, published content and upcoming schedules."}
          </p>
          <button
            onClick={generate}
            disabled={Boolean(loading) || !hasData}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#ef2b2d] px-3 py-2 text-[9px] font-semibold disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading === "generate" ? (
              <LoaderCircle className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            {loading === "generate" ? "Analyzing..." : "Generate recommendations"}
          </button>
        </div>

        {error && (
          <p className="mt-3 rounded-xl bg-red-50 p-3 text-[9px] leading-4 text-red-700">
            {error}
          </p>
        )}

        <div className="mt-3 space-y-3">
          {visible.map((insight) => {
            const executing = loading === `execute-${insight.id}`;
            const dismissing = loading === `dismiss-${insight.id}`;
            const actionable =
              insight.actionType !== "none" &&
              ["pending", "failed"].includes(insight.status);

            return (
              <article
                key={insight.id}
                className="rounded-2xl border border-black/[0.055] p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="rounded-md bg-neutral-100 px-2 py-1 text-[8px] font-semibold uppercase text-neutral-500">
                        {insight.confidence} confidence
                      </span>
                      <span className="text-[8px] capitalize text-muted-foreground">
                        {insight.status.replaceAll("_", " ")}
                      </span>
                    </div>
                    <p className="mt-2 text-[10px] font-semibold leading-4">
                      {insight.finding}
                    </p>
                  </div>
                  {["pending", "failed", "informational"].includes(
                    insight.status,
                  ) && (
                    <button
                      onClick={() => void dismiss(insight)}
                      disabled={Boolean(loading)}
                      className="sostats-icon h-7 w-7 shrink-0"
                      aria-label="Dismiss insight"
                    >
                      {dismissing ? (
                        <LoaderCircle className="h-3 w-3 animate-spin" />
                      ) : (
                        <X className="h-3 w-3 text-neutral-400" />
                      )}
                    </button>
                  )}
                </div>

                {Array.isArray(insight.evidence) && insight.evidence.length > 0 && (
                  <div className="mt-3 space-y-1.5 rounded-xl bg-neutral-50 p-3">
                    {insight.evidence.slice(0, 3).map((evidence) => (
                      <p
                        key={evidence}
                        className="text-[8px] leading-4 text-muted-foreground"
                      >
                        • {evidence}
                      </p>
                    ))}
                  </div>
                )}

                <p className="mt-3 text-[9px] leading-4 text-neutral-600">
                  {insight.recommendation}
                </p>

                {insight.impactEstimate && (
                  <p className="mt-2 text-[8px] leading-4 text-muted-foreground">
                    Expected impact: {insight.impactEstimate}
                  </p>
                )}

                {insight.status === "executed" ? (
                  <div className="mt-3 flex items-center justify-between rounded-xl bg-emerald-50 px-3 py-2.5">
                    <span className="flex items-center gap-1.5 text-[9px] font-semibold text-emerald-700">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Action applied
                    </span>
                    <Link
                      href={
                        insight.actionType === "reschedule_publication"
                          ? `/${workspaceSlug}/calendar`
                          : `/${workspaceSlug}/content`
                      }
                      className="inline-flex items-center gap-1 text-[8px] font-semibold text-emerald-700"
                    >
                      View result
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>
                ) : actionable ? (
                  <button
                    onClick={() => void execute(insight)}
                    disabled={Boolean(loading)}
                    className="mt-3 inline-flex items-center gap-2 rounded-xl bg-[#fff0f0] px-3 py-2 text-[9px] font-semibold text-[#d92023] disabled:opacity-50"
                  >
                    {executing ? (
                      <LoaderCircle className="h-3 w-3 animate-spin" />
                    ) : (
                      <ActionIcon type={insight.actionType} />
                    )}
                    {executing ? "Applying..." : actionLabel(insight.actionType)}
                  </button>
                ) : null}

                {insight.status === "failed" && insight.error && (
                  <p className="mt-2 rounded-xl bg-red-50 p-2.5 text-[8px] leading-4 text-red-700">
                    {insight.error}
                  </p>
                )}
              </article>
            );
          })}

          {visible.length === 0 && hasData && (
            <p className="py-6 text-center text-[9px] text-muted-foreground">
              Generate recommendations to turn current performance into a controlled next action.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
