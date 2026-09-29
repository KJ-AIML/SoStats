"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  Play,
  RefreshCw,
  Rocket,
  Save,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  defaultWorkflowDefinition,
  WorkflowCanvas,
  type WorkflowChannel,
  type WorkflowDefinitionState,
} from "./workflow-canvas";
import type {
  AutomationRecord,
  AutomationRunRecord,
} from "@/lib/sostats-api.server";

function latestVersion(automation?: AutomationRecord) {
  return [...(automation?.versions || [])].sort(
    (a, b) => b.versionNumber - a.versionNumber,
  )[0];
}

function triggerTypeForDefinition(
  definition: WorkflowDefinitionState,
): "manual" | "rss" {
  const trigger = definition.nodes.find(
    (node) => String(node.data?.type || "") === "trigger",
  );
  const config =
    trigger?.data?.config && typeof trigger.data.config === "object"
      ? (trigger.data.config as Record<string, unknown>)
      : {};
  return config.mode === "rss" ? "rss" : "manual";
}

function statusTone(status: string) {
  switch (status) {
    case "completed":
      return "bg-emerald-50 text-emerald-700";
    case "waiting_approval":
      return "bg-amber-50 text-amber-700";
    case "failed":
      return "bg-red-50 text-red-700";
    case "running":
      return "bg-blue-50 text-blue-700";
    default:
      return "bg-neutral-100 text-neutral-600";
  }
}

export function AutomationWorkspace({
  workspaceSlug,
  initialAutomations,
  channels,
}: {
  workspaceSlug: string;
  initialAutomations: AutomationRecord[];
  channels: WorkflowChannel[];
}) {
  const [automations, setAutomations] = useState(initialAutomations);
  const [selectedId, setSelectedId] = useState<number | null>(
    initialAutomations[0]?.id || null,
  );
  const selected = automations.find((item) => item.id === selectedId);
  const initialVersion = latestVersion(selected);

  const [name, setName] = useState(selected?.name || "Weekly AI Content Plan");
  const [definition, setDefinition] = useState<WorkflowDefinitionState>(
    () =>
      (initialVersion?.workflowDefinition as WorkflowDefinitionState) ||
      defaultWorkflowDefinition(channels),
  );
  const [runs, setRuns] = useState<AutomationRunRecord[]>(
    selected?.runs || [],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedVersion = useMemo(() => latestVersion(selected), [selected]);
  const selectedTrigger = selected?.triggers?.[0];

  const loadAutomations = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/automations`,
        { cache: "no-store" },
      );
      if (!response.ok) return;
      setAutomations((await response.json()) as AutomationRecord[]);
    } catch {
      // Best-effort refresh; explicit actions surface their own errors.
    }
  }, [workspaceSlug]);

  const loadRuns = useCallback(async () => {
    if (!selectedId) return;
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/automations/${selectedId}/runs`,
      );
      if (!response.ok) return;
      const payload = (await response.json()) as AutomationRunRecord[];
      setRuns(payload);
    } catch {
      // Polling is best-effort; page actions surface explicit errors.
    }
  }, [selectedId, workspaceSlug]);

  useEffect(() => {
    if (!selectedId) return;
    const timer = window.setInterval(() => {
      void loadRuns();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [selectedId, loadRuns]);

  const createOrVersion = async () => {
    setBusy("save");
    setError(null);
    setMessage(null);

    try {
      if (!selectedId) {
        const response = await fetch(
          `/api/workspaces/${encodeURIComponent(workspaceSlug)}/automations`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              name,
              description: "Created from the SoStats automation builder",
              triggerType: triggerTypeForDefinition(definition),
              workflowDefinition: definition,
            }),
          },
        );
        const payload = (await response.json()) as AutomationRecord & {
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error || "Unable to create automation");
        setAutomations((current) => [payload, ...current]);
        setSelectedId(payload.id);
        setMessage("Automation draft created.");
        return payload.id;
      }

      const metadataResponse = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/automations/${selectedId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name }),
        },
      );
      if (!metadataResponse.ok) {
        const metadataPayload = (await metadataResponse.json()) as { error?: string };
        throw new Error(metadataPayload.error || "Unable to save automation name");
      }

      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/automations/${selectedId}/versions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workflowDefinition: definition }),
        },
      );
      const payload = (await response.json()) as {
        id?: number;
        error?: string;
        versionNumber?: number;
        workflowDefinition?: unknown;
      };
      if (!response.ok) throw new Error(payload.error || "Unable to save workflow version");

      setAutomations((current) =>
        current.map((automation) =>
          automation.id === selectedId
            ? {
                ...automation,
                name,
                versions: [
                  ...(automation.versions || []),
                  {
                    id: payload.id || 0,
                    automationId: selectedId,
                    versionNumber: payload.versionNumber || 1,
                    workflowDefinition:
                      payload.workflowDefinition || definition,
                    publishedAt: null,
                    createdAt: new Date().toISOString(),
                  },
                ],
              }
            : automation,
        ),
      );
      setMessage(`Saved workflow version ${payload.versionNumber || ""}.`);
      return selectedId;
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : "Unable to save automation",
      );
      return null;
    } finally {
      setBusy(null);
    }
  };

  const publish = async () => {
    const id = await createOrVersion();
    if (!id) return;

    setBusy("publish");
    setError(null);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/automations/${id}/publish`,
        { method: "POST" },
      );
      const payload = (await response.json()) as {
        status?: string;
        triggerType?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "Unable to publish workflow");
      setAutomations((current) =>
        current.map((automation) =>
          automation.id === id
            ? {
                ...automation,
                status: "active",
                triggerType:
                  payload.triggerType || triggerTypeForDefinition(definition),
              }
            : automation,
        ),
      );
      await loadAutomations();
      setMessage(
        payload.triggerType === "rss"
          ? "Workflow published. RSS polling is active and new feed items create versioned runs."
          : "Workflow published. New runs will use the latest published version.",
      );
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : "Unable to publish workflow",
      );
    } finally {
      setBusy(null);
    }
  };

  const testRun = async () => {
    const id = await createOrVersion();
    if (!id) return;

    setBusy("run");
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/automations/${id}/run`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            triggerPayload: {
              source: "automation-builder",
              requestedAt: new Date().toISOString(),
            },
          }),
        },
      );
      const payload = (await response.json()) as AutomationRunRecord & {
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "Unable to start run");
      setMessage(`Run #${payload.id} queued.`);
      await loadRuns();
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : "Unable to start run",
      );
    } finally {
      setBusy(null);
    }
  };

  const decide = async (
    runId: number,
    stepId: string,
    decision: "approve" | "reject",
  ) => {
    setBusy(`${decision}-${runId}`);
    setError(null);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/automations/runs/${runId}/steps/${encodeURIComponent(stepId)}/decision`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ decision }),
        },
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Unable to submit review");
      setMessage(
        decision === "approve"
          ? "Approved. The runtime will resume from the next step."
          : "Rejected. The automation run stopped.",
      );
      await loadRuns();
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : "Unable to submit review",
      );
    } finally {
      setBusy(null);
    }
  };

  const retry = async (runId: number) => {
    setBusy(`retry-${runId}`);
    setError(null);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/automations/runs/${runId}/retry`,
        { method: "POST" },
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Unable to retry run");
      setMessage(`Run #${runId} queued from its failed step.`);
      await loadRuns();
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : "Unable to retry run",
      );
    } finally {
      setBusy(null);
    }
  };

  const retryExternalTrigger = async () => {
    if (!selectedId) return;
    setBusy("retry-trigger");
    setError(null);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/automations/${selectedId}/trigger/retry`,
        { method: "POST" },
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to retry RSS source");
      }
      setMessage("RSS source reactivated and queued for polling.");
      await loadAutomations();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Unable to retry RSS source",
      );
    } finally {
      setBusy(null);
    }
  };

  const newAutomation = () => {
    setSelectedId(null);
    setName("New AI Content Automation");
    setDefinition(defaultWorkflowDefinition(channels));
    setRuns([]);
    setMessage(null);
    setError(null);
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="sostats-card self-start p-3">
          <div className="flex items-center justify-between px-2 py-2">
            <div>
              <p className="text-[10px] font-semibold">Automations</p>
              <p className="mt-0.5 text-[8px] text-muted-foreground">
                Versioned runtime definitions
              </p>
            </div>
            <button
              onClick={newAutomation}
              className="rounded-lg bg-[#fff0f0] px-2 py-1 text-[8px] font-semibold text-[#d92023]"
            >
              + New
            </button>
          </div>
          <div className="mt-2 space-y-1.5">
            {automations.map((automation) => (
              <button
                key={automation.id}
                onClick={() => {
                  setSelectedId(automation.id);
                  setName(automation.name);
                  const version = latestVersion(automation);
                  setDefinition(
                    (version?.workflowDefinition as WorkflowDefinitionState) ||
                      defaultWorkflowDefinition(channels),
                  );
                  setRuns(automation.runs || []);
                  setMessage(null);
                  setError(null);
                }}
                className={
                  automation.id === selectedId
                    ? "w-full rounded-xl border border-[#ef2b2d]/15 bg-[#fff7f7] p-3 text-left"
                    : "w-full rounded-xl border border-transparent p-3 text-left hover:bg-neutral-50"
                }
              >
                <div className="flex items-center gap-2">
                  <span
                    className={
                      automation.status === "active"
                        ? "h-2 w-2 rounded-full bg-emerald-500"
                        : "h-2 w-2 rounded-full bg-neutral-300"
                    }
                  />
                  <p className="min-w-0 flex-1 truncate text-[9px] font-semibold">
                    {automation.name}
                  </p>
                </div>
                <p className="mt-1 text-[8px] capitalize text-muted-foreground">
                  {automation.status} · {automation.triggerType || "manual"} · {automation.versions?.length || 0} versions
                </p>
              </button>
            ))}
            {automations.length === 0 && (
              <p className="px-3 py-8 text-center text-[9px] text-muted-foreground">
                Create your first automation.
              </p>
            )}
          </div>
        </aside>

        <main className="min-w-0 space-y-3">
          <div className="sostats-card flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="h-10 min-w-0 flex-1 rounded-xl bg-neutral-50 px-3 text-[11px] font-semibold outline-none"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => void createOrVersion()}
                disabled={Boolean(busy)}
                className="h-10 rounded-xl text-[9px]"
              >
                {busy === "save" ? (
                  <LoaderCircle className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="mr-2 h-3.5 w-3.5" />
                )}
                Save version
              </Button>
              <Button
                variant="outline"
                onClick={testRun}
                disabled={Boolean(busy)}
                className="h-10 rounded-xl text-[9px]"
              >
                {busy === "run" ? (
                  <LoaderCircle className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="mr-2 h-3.5 w-3.5" />
                )}
                Test run
              </Button>
              <Button
                onClick={publish}
                disabled={Boolean(busy)}
                className="h-10 rounded-xl bg-[#ef2b2d] text-[9px] hover:bg-[#da2427]"
              >
                {busy === "publish" ? (
                  <LoaderCircle className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Rocket className="mr-2 h-3.5 w-3.5" />
                )}
                Publish workflow
              </Button>
            </div>
          </div>

          {message && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[9px] text-emerald-700">
              <Check className="h-3.5 w-3.5" />
              {message}
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[9px] text-red-700">
              <AlertCircle className="h-3.5 w-3.5" />
              {error}
            </div>
          )}

          {selected?.triggerType === "rss" && selectedTrigger && (
            <div
              className={
                selectedTrigger.status === "error"
                  ? "sostats-card border-red-200 bg-red-50/50 p-4"
                  : "sostats-card p-4"
              }
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={
                        selectedTrigger.status === "active"
                          ? "h-2 w-2 rounded-full bg-emerald-500"
                          : selectedTrigger.status === "error"
                            ? "h-2 w-2 rounded-full bg-red-500"
                            : "h-2 w-2 rounded-full bg-neutral-300"
                      }
                    />
                    <p className="text-[10px] font-semibold">
                      RSS source · {selectedTrigger.status}
                    </p>
                  </div>
                  <p className="mt-1 truncate text-[8px] text-muted-foreground">
                    {String(selectedTrigger.config?.feedUrl || "Feed URL unavailable")}
                  </p>
                  <p className="mt-1 text-[8px] text-muted-foreground">
                    {selectedTrigger.lastPolledAt
                      ? `Last poll ${new Date(selectedTrigger.lastPolledAt).toLocaleString()}`
                      : "Waiting for first poll"}
                    {selectedTrigger.lastTriggeredAt
                      ? ` · Last trigger ${new Date(selectedTrigger.lastTriggeredAt).toLocaleString()}`
                      : ""}
                  </p>
                  {selectedTrigger.lastError && (
                    <p className="mt-2 line-clamp-2 text-[8px] text-red-700">
                      {selectedTrigger.lastError}
                    </p>
                  )}
                </div>
                {selectedTrigger.status === "error" && (
                  <Button
                    variant="outline"
                    onClick={() => void retryExternalTrigger()}
                    disabled={Boolean(busy)}
                    className="h-9 rounded-xl text-[8px]"
                  >
                    {busy === "retry-trigger" ? (
                      <LoaderCircle className="mr-1.5 h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-1.5 h-3 w-3" />
                    )}
                    Retry source
                  </Button>
                )}
              </div>
            </div>
          )}

          <WorkflowCanvas
            key={`${selectedId ?? "new"}-${selectedVersion?.id ?? "draft"}`}
            definition={definition}
            onDefinitionChange={setDefinition}
            channels={channels}
          />
        </main>
      </div>

      <section className="sostats-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-black/[0.055] px-5 py-4">
          <div>
            <p className="text-sm font-semibold">Run history</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Persisted execution state for {selected?.name || name}
              {selectedVersion ? ` · latest v${selectedVersion.versionNumber}` : ""}
            </p>
          </div>
          <button
            onClick={() => void loadRuns()}
            className="sostats-icon h-8 w-8"
            aria-label="Refresh run history"
          >
            <RefreshCw className="h-3.5 w-3.5 text-neutral-500" />
          </button>
        </div>

        <div className="divide-y divide-black/[0.045]">
          {runs.length ? (
            runs.slice(0, 10).map((run) => {
              const waiting = run.steps?.find(
                (step) => step.status === "waiting_approval",
              );
              const failed = run.steps?.find((step) => step.status === "failed");
              return (
                <div key={run.id} className="px-5 py-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <div className="sostats-icon h-9 w-9 shrink-0">
                        {run.status === "completed" ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        ) : run.status === "waiting_approval" ? (
                          <Clock3 className="h-4 w-4 text-amber-600" />
                        ) : run.status === "failed" ? (
                          <AlertCircle className="h-4 w-4 text-red-600" />
                        ) : (
                          <RefreshCw className="h-4 w-4 text-blue-600" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-[10px] font-semibold">Run #{run.id}</p>
                          <span className={`rounded-md px-2 py-1 text-[8px] font-semibold ${statusTone(run.status)}`}>
                            {run.status.replaceAll("_", " ")}
                          </span>
                        </div>
                        <p className="mt-1 truncate text-[8px] text-muted-foreground">
                          {run.steps?.map((step) => `${step.stepId}: ${step.status}`).join(" · ")}
                        </p>
                        {run.error && (
                          <p className="mt-1 line-clamp-2 text-[8px] text-red-600">
                            {run.error}
                          </p>
                        )}
                      </div>
                    </div>

                    {waiting && (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={Boolean(busy)}
                          onClick={() => void decide(run.id, waiting.stepId, "reject")}
                          className="h-8 rounded-lg text-[8px]"
                        >
                          <X className="mr-1.5 h-3 w-3" />
                          Reject
                        </Button>
                        <Button
                          size="sm"
                          disabled={Boolean(busy)}
                          onClick={() => void decide(run.id, waiting.stepId, "approve")}
                          className="h-8 rounded-lg bg-emerald-600 text-[8px] hover:bg-emerald-700"
                        >
                          <Check className="mr-1.5 h-3 w-3" />
                          Approve & resume
                        </Button>
                      </div>
                    )}

                    {failed && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={Boolean(busy)}
                        onClick={() => void retry(run.id)}
                        className="h-8 rounded-lg text-[8px]"
                      >
                        <RefreshCw className="mr-1.5 h-3 w-3" />
                        Retry failed step
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="px-5 py-10 text-center text-[10px] text-muted-foreground">
              No runs yet. Save the workflow and start a test run.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
