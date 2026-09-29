"use client";

import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  FileJson2,
  LoaderCircle,
  Play,
} from "lucide-react";
import type {
  AutomationRunRecord,
  AutomationRunStepRecord,
} from "@/lib/sostats-api.server";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

function parseLog(value?: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : { value: parsed };
  } catch {
    return { raw: value };
  }
}

function statusTone(status: string) {
  switch (status) {
    case "completed":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "waiting_approval":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "failed":
      return "border-red-200 bg-red-50 text-red-700";
    case "running":
      return "border-blue-200 bg-blue-50 text-blue-700";
    default:
      return "border-neutral-200 bg-neutral-50 text-neutral-600";
  }
}

function StatusIcon({ status }: { status: string }) {
  if (status === "completed") return <CheckCircle2 className="h-3.5 w-3.5" />;
  if (status === "waiting_approval") return <Clock3 className="h-3.5 w-3.5" />;
  if (status === "failed") return <AlertCircle className="h-3.5 w-3.5" />;
  if (status === "running") return <LoaderCircle className="h-3.5 w-3.5" />;
  return <Play className="h-3.5 w-3.5" />;
}

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString() : "—";
}

function stepLabels(run: AutomationRunRecord) {
  const definition = run.version?.workflowDefinition;
  if (!definition || typeof definition !== "object") {
    return new Map<string, string>();
  }

  const nodes = (definition as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return new Map<string, string>();

  return new Map(
    nodes
      .filter(
        (node): node is {
          id: string;
          data?: { label?: unknown; type?: unknown };
        } =>
          Boolean(
            node &&
              typeof node === "object" &&
              "id" in node &&
              typeof (node as { id?: unknown }).id === "string",
          ),
      )
      .map((node) => [
        node.id,
        typeof node.data?.label === "string"
          ? node.data.label
          : typeof node.data?.type === "string"
            ? node.data.type
            : node.id,
      ]),
  );
}

function StepPayload({ step }: { step: AutomationRunStepRecord }) {
  const parsed = parseLog(step.logs);
  if (!parsed && !step.error) return null;

  return (
    <div className="mt-3 space-y-2">
      {step.error && (
        <div className="rounded-xl bg-red-50 p-3 text-[9px] leading-4 text-red-700">
          {step.error}
        </div>
      )}
      {parsed && (
        <div className="rounded-xl border border-black/[0.055] bg-neutral-950 p-3 text-white">
          <div className="mb-2 flex items-center gap-2 text-[8px] font-semibold uppercase tracking-[0.08em] text-white/50">
            <FileJson2 className="h-3 w-3" />
            Persisted step log
          </div>
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words text-[8px] leading-4 text-white/75">
            {JSON.stringify(parsed, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

export function AutomationRunInspector({
  run,
  open,
  onOpenChange,
}: {
  run: AutomationRunRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const labels = run ? stepLabels(run) : new Map<string, string>();
  const steps = run
    ? [...(run.steps || [])].sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      )
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto rounded-2xl sm:max-w-3xl">
        {run && (
          <>
            <DialogHeader>
              <DialogTitle className="tracking-[-0.02em]">
                Automation run #{run.id}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-5 py-2">
              <div className="grid gap-3 sm:grid-cols-4">
                <Info label="State" value={run.status.replaceAll("_", " ")} />
                <Info
                  label="Version"
                  value={`v${run.version?.versionNumber || "?"}`}
                />
                <Info label="Started" value={formatDate(run.startedAt)} />
                <Info
                  label="Completed"
                  value={formatDate(run.completedAt)}
                />
              </div>

              {run.error && (
                <div className="flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 p-3 text-[9px] leading-4 text-red-700">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {run.error}
                </div>
              )}

              <div>
                <div className="mb-3 flex items-end justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold">Execution steps</p>
                    <p className="mt-0.5 text-[8px] text-muted-foreground">
                      Persisted runtime state, output and failure context.
                    </p>
                  </div>
                  <span
                    className={cn(
                      "rounded-lg border px-2.5 py-1 text-[8px] font-semibold capitalize",
                      statusTone(run.status),
                    )}
                  >
                    {run.status.replaceAll("_", " ")}
                  </span>
                </div>

                <div className="space-y-3">
                  {steps.map((step, index) => (
                    <article
                      key={step.id}
                      className="rounded-2xl border border-black/[0.055] p-4"
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={cn(
                            "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border",
                            statusTone(step.status),
                          )}
                        >
                          <StatusIcon status={step.status} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-[10px] font-semibold">
                              {index + 1}. {labels.get(step.stepId) || step.stepId}
                            </p>
                            <span className="text-[8px] text-muted-foreground">
                              {step.stepId}
                            </span>
                          </div>
                          <p className="mt-1 text-[8px] capitalize text-muted-foreground">
                            {step.status.replaceAll("_", " ")}
                            {step.startedAt
                              ? ` · started ${formatDate(step.startedAt)}`
                              : ""}
                            {step.completedAt
                              ? ` · finished ${formatDate(step.completedAt)}`
                              : ""}
                          </p>
                        </div>
                      </div>
                      <StepPayload step={step} />
                    </article>
                  ))}

                  {!steps.length && (
                    <div className="rounded-xl border border-dashed border-black/[0.08] p-6 text-center text-[9px] text-muted-foreground">
                      No persisted run steps were returned.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-black/[0.055] bg-neutral-50 p-3">
      <p className="text-[8px] uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 truncate text-[9px] font-semibold capitalize">{value}</p>
    </div>
  );
}
