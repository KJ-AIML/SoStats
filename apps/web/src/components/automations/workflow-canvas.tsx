"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Controls,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  Panel,
  ReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  BarChart3,
  Calendar,
  CheckCircle2,
  Play,
  Settings,
  Sparkles,
} from "lucide-react";
import { WorkflowNode } from "./workflow-node";

const nodeTypes = { workflowNode: WorkflowNode };

export type WorkflowDefinitionState = {
  nodes: Node[];
  edges: Edge[];
};

export type WorkflowChannel = {
  id: number;
  provider: string;
  accountName?: string | null;
};

const defaultNodes: Node[] = [
  {
    id: "trigger",
    type: "workflowNode",
    position: { x: 80, y: 210 },
    data: {
      label: "Manual trigger",
      type: "trigger",
      description: "Start the workflow from SoStats.",
      config: {},
    },
  },
  {
    id: "generate",
    type: "workflowNode",
    position: { x: 380, y: 210 },
    data: {
      label: "Generate campaign",
      type: "generate",
      description: "Create content with Brand Brain context.",
      config: {
        goal: "Create a weekly educational content campaign",
        audience: "Startup founders and lean marketing teams",
        channels: ["linkedin"],
      },
    },
  },
  {
    id: "review",
    type: "workflowNode",
    position: { x: 680, y: 210 },
    data: {
      label: "Human review",
      type: "review",
      description: "Pause until a person approves generated content.",
      config: {},
    },
  },
  {
    id: "schedule",
    type: "workflowNode",
    position: { x: 980, y: 210 },
    data: {
      label: "Schedule approved content",
      type: "schedule",
      description: "Add approved posts to the publishing calendar.",
      config: {
        delayMinutes: 60,
        spacingMinutes: 60,
      },
    },
  },
];

const defaultEdges: Edge[] = [
  { id: "trigger-generate", source: "trigger", target: "generate", animated: true },
  { id: "generate-review", source: "generate", target: "review", animated: true },
  { id: "review-schedule", source: "review", target: "schedule", animated: true },
];

const availableNodes = [
  { type: "generate", label: "AI Generate", icon: Sparkles, desc: "Create a campaign with Brand Brain" },
  { type: "review", label: "Human Review", icon: CheckCircle2, desc: "Pause until approved or rejected" },
  { type: "schedule", label: "Schedule", icon: Calendar, desc: "Create persisted publishing schedules" },
  { type: "analyze", label: "AI Analyze", icon: BarChart3, desc: "Generate insights from real analytics" },
] as const;

export function defaultWorkflowDefinition(
  channels: WorkflowChannel[] = [],
): WorkflowDefinitionState {
  const nodes = structuredClone(defaultNodes);
  const schedule = nodes.find((node) => node.id === "schedule");
  if (schedule && channels[0]) {
    schedule.data = {
      ...schedule.data,
      config: {
        ...(schedule.data.config as Record<string, unknown>),
        socialAccountId: channels[0].id,
      },
    };
  }
  return { nodes, edges: structuredClone(defaultEdges) };
}

function safeDefinition(
  value: unknown,
  channels: WorkflowChannel[],
): WorkflowDefinitionState {
  if (!value || typeof value !== "object") {
    return defaultWorkflowDefinition(channels);
  }

  const candidate = value as Partial<WorkflowDefinitionState>;
  if (!Array.isArray(candidate.nodes) || !Array.isArray(candidate.edges)) {
    return defaultWorkflowDefinition(channels);
  }

  return {
    nodes: candidate.nodes as Node[],
    edges: candidate.edges as Edge[],
  };
}

export function WorkflowCanvas({
  definition,
  onDefinitionChange,
  channels = [],
}: {
  definition?: unknown;
  onDefinitionChange?: (definition: WorkflowDefinitionState) => void;
  channels?: WorkflowChannel[];
}) {
  const initial = useMemo(
    () => safeDefinition(definition, channels),
    [definition, channels],
  );
  const [nodes, setNodes] = useState<Node[]>(initial.nodes);
  const [edges, setEdges] = useState<Edge[]>(initial.edges);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  useEffect(() => {
    setNodes(initial.nodes);
    setEdges(initial.edges);
    setSelectedNodeId(null);
  }, [initial]);

  useEffect(() => {
    onDefinitionChange?.({ nodes, edges });
  }, [nodes, edges, onDefinitionChange]);

  const selectedNode = nodes.find((node) => node.id === selectedNodeId) || null;

  const onNodesChange = useCallback(
    (changes: NodeChange[]) =>
      setNodes((current) => applyNodeChanges(changes, current)),
    [],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) =>
      setEdges((current) => applyEdgeChanges(changes, current)),
    [],
  );
  const onConnect = useCallback(
    (params: Connection) => {
      if (!params.source || !params.target) return;
      setEdges((current) => {
        const sourceUsed = current.some((edge) => edge.source === params.source);
        const targetUsed = current.some((edge) => edge.target === params.target);
        if (sourceUsed || targetUsed) return current;
        return addEdge({ ...params, animated: true }, current);
      });
    },
    [],
  );

  const addNode = (type: string, label: string) => {
    const id = crypto.randomUUID();
    const previous = nodes[nodes.length - 1];
    const nextNode: Node = {
      id,
      type: "workflowNode",
      position: { x: 280 + nodes.length * 260, y: 360 },
      data: {
        label,
        type,
        description: "Configure this runtime step.",
        config:
          type === "schedule"
            ? {
                socialAccountId: channels[0]?.id,
                delayMinutes: 60,
                spacingMinutes: 60,
              }
            : {},
      },
    };

    setNodes((current) => [...current, nextNode]);
    if (previous) {
      setEdges((current) => [
        ...current,
        {
          id: `${previous.id}-${id}`,
          source: previous.id,
          target: id,
          animated: true,
        },
      ]);
    }
    setSelectedNodeId(id);
  };

  const updateNodeData = (patch: Record<string, unknown>) => {
    if (!selectedNodeId) return;
    setNodes((current) =>
      current.map((node) =>
        node.id === selectedNodeId
          ? { ...node, data: { ...node.data, ...patch } }
          : node,
      ),
    );
  };

  const updateConfig = (key: string, value: unknown) => {
    if (!selectedNode) return;
    const config =
      selectedNode.data.config && typeof selectedNode.data.config === "object"
        ? (selectedNode.data.config as Record<string, unknown>)
        : {};
    updateNodeData({ config: { ...config, [key]: value } });
  };

  const config =
    selectedNode?.data.config && typeof selectedNode.data.config === "object"
      ? (selectedNode.data.config as Record<string, unknown>)
      : {};
  const selectedType = String(selectedNode?.data.type || "");

  return (
    <div className="grid min-h-[650px] overflow-hidden rounded-2xl border border-black/[0.065] bg-white xl:grid-cols-[225px_minmax(0,1fr)_300px]">
      <aside className="border-b border-black/[0.055] bg-neutral-50/70 p-3 xl:border-b-0 xl:border-r">
        <div className="px-2 py-2">
          <p className="text-[11px] font-semibold">Runtime blocks</p>
          <p className="mt-0.5 text-[9px] text-muted-foreground">
            V1 executes a linear workflow in this order.
          </p>
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
          {availableNodes.map((item) => (
            <button
              key={item.type}
              onClick={() => addNode(item.type, item.label)}
              className="flex items-start gap-2.5 rounded-xl border border-black/[0.055] bg-white p-3 text-left transition hover:border-[#ef2b2d]/20 hover:bg-[#fffafa]"
            >
              <div className="sostats-icon h-8 w-8 shrink-0">
                <item.icon className="h-3.5 w-3.5 text-neutral-500" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold">{item.label}</p>
                <p className="mt-0.5 text-[8px] text-muted-foreground">{item.desc}</p>
              </div>
            </button>
          ))}
        </div>

        <div className="mt-4 rounded-xl border border-black/[0.05] bg-white p-3">
          <div className="flex items-center gap-2">
            <Play className="h-3.5 w-3.5 text-emerald-600" />
            <p className="text-[9px] font-semibold">Trigger</p>
          </div>
          <p className="mt-1 text-[8px] leading-4 text-muted-foreground">
            The trigger stays as the first node. Manual runs are live now; schedule and webhook triggers use the same versioned definition next.
          </p>
        </div>
      </aside>

      <div className="relative min-h-[520px] bg-[#faf9f7]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, node) => setSelectedNodeId(node.id)}
          onPaneClick={() => setSelectedNodeId(null)}
          fitView
        >
          <Background color="#e7e5e4" gap={22} size={1} />
          <Controls className="!rounded-xl !border-black/[0.07] !bg-white !shadow-sm" />
          <Panel
            position="top-right"
            className="!m-3 rounded-full border border-black/[0.06] bg-white/90 px-3 py-1.5 text-[9px] font-semibold text-neutral-500 shadow-sm backdrop-blur"
          >
            Runtime v1 · {nodes.length} steps
          </Panel>
        </ReactFlow>
      </div>

      <aside className="border-t border-black/[0.055] bg-white xl:border-l xl:border-t-0">
        <div className="flex items-center gap-2 border-b border-black/[0.055] px-4 py-3.5">
          <Settings className="h-3.5 w-3.5 text-neutral-400" />
          <p className="text-[10px] font-semibold">Step configuration</p>
        </div>
        <div className="p-4">
          {selectedNode ? (
            <div className="space-y-4">
              <label>
                <span className="mb-1.5 block text-[9px] font-semibold text-neutral-500">
                  Step name
                </span>
                <input
                  value={String(selectedNode.data.label || "")}
                  onChange={(event) =>
                    updateNodeData({ label: event.target.value })
                  }
                  className="h-9 w-full rounded-xl border border-black/[0.07] bg-neutral-50 px-3 text-[10px] outline-none focus:border-[#ef2b2d]/30"
                />
              </label>

              <label>
                <span className="mb-1.5 block text-[9px] font-semibold text-neutral-500">
                  Description
                </span>
                <textarea
                  value={String(selectedNode.data.description || "")}
                  onChange={(event) =>
                    updateNodeData({ description: event.target.value })
                  }
                  rows={3}
                  className="w-full resize-none rounded-xl border border-black/[0.07] bg-neutral-50 p-3 text-[10px] leading-4 outline-none focus:border-[#ef2b2d]/30"
                />
              </label>

              {selectedType === "generate" && (
                <>
                  <label>
                    <span className="mb-1.5 block text-[9px] font-semibold text-neutral-500">Goal</span>
                    <textarea
                      value={String(config.goal || "")}
                      onChange={(event) => updateConfig("goal", event.target.value)}
                      rows={3}
                      className="w-full resize-none rounded-xl border border-black/[0.07] bg-neutral-50 p-3 text-[10px] leading-4 outline-none"
                    />
                  </label>
                  <label>
                    <span className="mb-1.5 block text-[9px] font-semibold text-neutral-500">Audience</span>
                    <input
                      value={String(config.audience || "")}
                      onChange={(event) => updateConfig("audience", event.target.value)}
                      className="h-9 w-full rounded-xl border border-black/[0.07] bg-neutral-50 px-3 text-[10px] outline-none"
                    />
                  </label>
                  <label>
                    <span className="mb-1.5 block text-[9px] font-semibold text-neutral-500">Channels</span>
                    <input
                      value={Array.isArray(config.channels) ? config.channels.join(", ") : String(config.channels || "")}
                      onChange={(event) =>
                        updateConfig(
                          "channels",
                          event.target.value
                            .split(",")
                            .map((value) => value.trim())
                            .filter(Boolean),
                        )
                      }
                      placeholder="linkedin, x, instagram"
                      className="h-9 w-full rounded-xl border border-black/[0.07] bg-neutral-50 px-3 text-[10px] outline-none"
                    />
                  </label>
                </>
              )}

              {selectedType === "schedule" && (
                <>
                  <label>
                    <span className="mb-1.5 block text-[9px] font-semibold text-neutral-500">Publishing account</span>
                    <select
                      value={String(config.socialAccountId || "")}
                      onChange={(event) =>
                        updateConfig(
                          "socialAccountId",
                          event.target.value ? Number(event.target.value) : undefined,
                        )
                      }
                      className="h-9 w-full rounded-xl border border-black/[0.07] bg-neutral-50 px-3 text-[10px] outline-none"
                    >
                      <option value="">Choose connected account</option>
                      {channels.map((channel) => (
                        <option key={channel.id} value={channel.id}>
                          {channel.accountName || channel.provider} · {channel.provider}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label>
                      <span className="mb-1.5 block text-[9px] font-semibold text-neutral-500">Delay min</span>
                      <input
                        type="number"
                        min={0}
                        value={String(config.delayMinutes ?? 60)}
                        onChange={(event) =>
                          updateConfig("delayMinutes", Number(event.target.value))
                        }
                        className="h-9 w-full rounded-xl border border-black/[0.07] bg-neutral-50 px-3 text-[10px] outline-none"
                      />
                    </label>
                    <label>
                      <span className="mb-1.5 block text-[9px] font-semibold text-neutral-500">Spacing min</span>
                      <input
                        type="number"
                        min={1}
                        value={String(config.spacingMinutes ?? 60)}
                        onChange={(event) =>
                          updateConfig("spacingMinutes", Number(event.target.value))
                        }
                        className="h-9 w-full rounded-xl border border-black/[0.07] bg-neutral-50 px-3 text-[10px] outline-none"
                      />
                    </label>
                  </div>
                </>
              )}

              {selectedType === "analyze" && (
                <p className="rounded-xl bg-violet-50 p-3 text-[9px] leading-4 text-violet-700">
                  Analyze uses the workspace&apos;s persisted analytics plus Brand Brain. It fails intentionally when no real metrics exist.
                </p>
              )}

              {selectedType === "review" && (
                <p className="rounded-xl bg-amber-50 p-3 text-[9px] leading-4 text-amber-800">
                  The run pauses here. Approving resumes the same version and marks generated content approved; rejecting stops the run.
                </p>
              )}

              <div className="rounded-xl border border-[#ef2b2d]/10 bg-[#fff7f7] p-3">
                <p className="text-[9px] font-semibold text-[#d92023]">
                  {selectedType.toUpperCase()} STEP
                </p>
                <p className="mt-1 text-[9px] leading-4 text-muted-foreground">
                  Runtime output is persisted to the run step before the next node executes.
                </p>
              </div>
            </div>
          ) : (
            <div className="pt-14 text-center">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-neutral-100">
                <Settings className="h-4 w-4 text-neutral-400" />
              </div>
              <p className="mt-3 text-[10px] font-semibold">Select a block</p>
              <p className="mt-1 text-[9px] leading-4 text-muted-foreground">
                Configure its runtime behavior here.
              </p>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
