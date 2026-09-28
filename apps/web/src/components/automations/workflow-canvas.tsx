"use client";

import { useCallback, useState } from "react";
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
  Calendar,
  CheckCircle2,
  Image as ImageIcon,
  Play,
  Settings,
  Sparkles,
} from "lucide-react";
import { WorkflowNode } from "./workflow-node";

const nodeTypes = { workflowNode: WorkflowNode };

const initialNodes: Node[] = [
  {
    id: "1",
    type: "workflowNode",
    position: { x: 140, y: 210 },
    data: {
      label: "Every Monday · 08:00",
      type: "trigger",
      description: "Start the weekly content planning workflow.",
    },
  },
  {
    id: "2",
    type: "workflowNode",
    position: { x: 460, y: 210 },
    data: {
      label: "Generate weekly ideas",
      type: "generate",
      description: "Use Brand Brain + recent performance to create 5 ideas.",
    },
  },
  {
    id: "3",
    type: "workflowNode",
    position: { x: 780, y: 210 },
    data: {
      label: "Human review",
      type: "review",
      description: "Pause until the content owner approves drafts.",
    },
  },
  {
    id: "4",
    type: "workflowNode",
    position: { x: 1100, y: 210 },
    data: {
      label: "Schedule approved posts",
      type: "schedule",
      description: "Find open slots across selected channels.",
    },
  },
];

const initialEdges: Edge[] = [
  { id: "e1-2", source: "1", target: "2", animated: true },
  { id: "e2-3", source: "2", target: "3", animated: true },
  { id: "e3-4", source: "3", target: "4", animated: true },
];

const availableNodes = [
  { type: "trigger", label: "Trigger", icon: Play, desc: "Schedule, webhook or event" },
  { type: "generate", label: "AI Generate", icon: Sparkles, desc: "Create or transform content" },
  { type: "image", label: "Create Media", icon: ImageIcon, desc: "Generate or process assets" },
  { type: "review", label: "Review", icon: CheckCircle2, desc: "Wait for human approval" },
  { type: "schedule", label: "Schedule", icon: Calendar, desc: "Place content on calendar" },
];

export function WorkflowCanvas() {
  const [nodes, setNodes] = useState<Node[]>(initialNodes);
  const [edges, setEdges] = useState<Edge[]>(initialEdges);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);

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
    (params: Connection) =>
      setEdges((current) => addEdge({ ...params, animated: true }, current)),
    [],
  );

  const addNode = (type: string, label: string) => {
    setNodes((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        type: "workflowNode",
        position: { x: 280 + current.length * 32, y: 380 },
        data: { label, type, description: "Configure this step." },
      },
    ]);
  };

  return (
    <div className="grid min-h-[650px] overflow-hidden rounded-2xl border border-black/[0.065] bg-white xl:grid-cols-[225px_minmax(0,1fr)_280px]">
      <aside className="border-b border-black/[0.055] bg-neutral-50/70 p-3 xl:border-b-0 xl:border-r">
        <div className="px-2 py-2">
          <p className="text-[11px] font-semibold">Blocks</p>
          <p className="mt-0.5 text-[9px] text-muted-foreground">
            Add a step to your workflow
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
      </aside>

      <div className="relative min-h-[520px] bg-[#faf9f7]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, node) => setSelectedNode(node)}
          onPaneClick={() => setSelectedNode(null)}
          fitView
        >
          <Background color="#e7e5e4" gap={22} size={1} />
          <Controls className="!rounded-xl !border-black/[0.07] !bg-white !shadow-sm" />
          <Panel
            position="top-right"
            className="!m-3 rounded-full border border-black/[0.06] bg-white/90 px-3 py-1.5 text-[9px] font-semibold text-neutral-500 shadow-sm backdrop-blur"
          >
            Draft · 4 steps
          </Panel>
        </ReactFlow>
      </div>

      <aside className="border-t border-black/[0.055] bg-white xl:border-l xl:border-t-0">
        <div className="flex items-center gap-2 border-b border-black/[0.055] px-4 py-3.5">
          <Settings className="h-3.5 w-3.5 text-neutral-400" />
          <p className="text-[10px] font-semibold">Configuration</p>
        </div>
        <div className="p-4">
          {selectedNode ? (
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-[9px] font-semibold text-neutral-500">
                  Step name
                </label>
                <input
                  value={selectedNode.data.label as string}
                  onChange={(event) => {
                    const value = event.target.value;
                    setNodes((current) =>
                      current.map((node) =>
                        node.id === selectedNode.id
                          ? { ...node, data: { ...node.data, label: value } }
                          : node,
                      ),
                    );
                    setSelectedNode((current) =>
                      current
                        ? { ...current, data: { ...current.data, label: value } }
                        : current,
                    );
                  }}
                  className="h-9 w-full rounded-xl border border-black/[0.07] bg-neutral-50 px-3 text-[10px] outline-none focus:border-[#ef2b2d]/30"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[9px] font-semibold text-neutral-500">
                  Description
                </label>
                <textarea
                  value={(selectedNode.data.description as string) || ""}
                  onChange={(event) => {
                    const value = event.target.value;
                    setNodes((current) =>
                      current.map((node) =>
                        node.id === selectedNode.id
                          ? { ...node, data: { ...node.data, description: value } }
                          : node,
                      ),
                    );
                  }}
                  rows={4}
                  className="w-full resize-none rounded-xl border border-black/[0.07] bg-neutral-50 p-3 text-[10px] leading-4 outline-none focus:border-[#ef2b2d]/30"
                />
              </div>
              <div className="rounded-xl border border-[#ef2b2d]/10 bg-[#fff7f7] p-3">
                <p className="text-[9px] font-semibold text-[#d92023]">
                  {String(selectedNode.data.type).toUpperCase()} STEP
                </p>
                <p className="mt-1 text-[9px] leading-4 text-muted-foreground">
                  Step-specific fields will be provided by the workflow adapter schema.
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
                Its configuration will appear here.
              </p>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
