'use client';

import { useState, useCallback } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
  Panel,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { WorkflowNode } from './workflow-node';
import { Play, FileText, Image as ImageIcon, CheckCircle, Calendar, Plus, Settings } from 'lucide-react';

const nodeTypes = {
  workflowNode: WorkflowNode,
};

const initialNodes: Node[] = [
  {
    id: '1',
    type: 'workflowNode',
    position: { x: 250, y: 150 },
    data: { 
      label: 'New Content Trigger', 
      type: 'trigger',
      description: 'Runs when new content is added to a specific folder'
    },
  },
  {
    id: '2',
    type: 'workflowNode',
    position: { x: 550, y: 150 },
    data: { 
      label: 'Generate Posts', 
      type: 'generate',
      description: 'Creates LinkedIn and Twitter posts from source material'
    },
  },
];

const initialEdges: Edge[] = [
  { id: 'e1-2', source: '1', target: '2', animated: true },
];

const availableNodes = [
  { type: 'trigger', label: 'Trigger', icon: Play, desc: 'Start automation based on events' },
  { type: 'generate', label: 'Generate Posts', icon: FileText, desc: 'Use AI to generate content' },
  { type: 'image', label: 'Create Images', icon: ImageIcon, desc: 'Generate or resize assets' },
  { type: 'review', label: 'Review Step', icon: CheckCircle, desc: 'Require human approval' },
  { type: 'schedule', label: 'Schedule', icon: Calendar, desc: 'Add content to calendar' },
];

export function WorkflowCanvas() {
  const [nodes, setNodes] = useState<Node[]>(initialNodes);
  const [edges, setEdges] = useState<Edge[]>(initialEdges);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    []
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  );

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    []
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  const addNode = (type: string, label: string) => {
    const newNode: Node = {
      id: crypto.randomUUID(),
      type: 'workflowNode',
      position: { x: 100, y: 100 },
      data: { label, type, description: 'Configure this step' },
    };
    setNodes((nds) => nds.concat(newNode));
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] w-full border-t border-zinc-200 dark:border-zinc-800">
      {/* Node Drawer (Left) */}
      <div className="w-64 bg-white dark:bg-zinc-950 border-r border-zinc-200 dark:border-zinc-800 flex flex-col h-full overflow-y-auto">
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Blocks</h2>
          <p className="text-xs text-zinc-500 mt-1">Click to add to canvas</p>
        </div>
        <div className="p-4 space-y-3">
          {availableNodes.map((item) => (
            <button
              key={item.type}
              onClick={() => addNode(item.type, item.label)}
              className="w-full flex items-start gap-3 p-3 text-left rounded-lg border border-zinc-200 dark:border-zinc-800 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors group"
            >
              <div className="p-2 bg-zinc-100 dark:bg-zinc-800 rounded-md group-hover:bg-white dark:group-hover:bg-zinc-900 transition-colors">
                <item.icon className="w-4 h-4 text-zinc-600 dark:text-zinc-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{item.label}</div>
                <div className="text-xs text-zinc-500 truncate">{item.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Canvas (Center) */}
      <div className="flex-1 h-full relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          nodeTypes={nodeTypes}
          fitView
          className="bg-zinc-50 dark:bg-zinc-900/50"
        >
          <Background color="#ccc" gap={16} />
          <Controls className="!bg-white dark:!bg-zinc-900 !border-zinc-200 dark:!border-zinc-800 !shadow-sm" />
          <Panel position="top-right" className="bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm p-2 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs text-zinc-500">
            Draft
          </Panel>
        </ReactFlow>
      </div>

      {/* Config Panel (Right) */}
      <div className="w-80 bg-white dark:bg-zinc-950 border-l border-zinc-200 dark:border-zinc-800 flex flex-col h-full overflow-y-auto">
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-2">
          <Settings className="w-4 h-4 text-zinc-500" />
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Configuration</h2>
        </div>
        <div className="p-4">
          {selectedNode ? (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1">Step Name</label>
                <input
                  type="text"
                  value={selectedNode.data.label as string}
                  onChange={(e) => {
                    setNodes((nds) =>
                      nds.map((n) => {
                        if (n.id === selectedNode.id) {
                          return {
                            ...n,
                            data: { ...n.data, label: e.target.value },
                          };
                        }
                        return n;
                      })
                    );
                  }}
                  className="w-full px-3 py-2 text-sm bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1">Description</label>
                <textarea
                  value={selectedNode.data.description as string || ''}
                  onChange={(e) => {
                    setNodes((nds) =>
                      nds.map((n) => {
                        if (n.id === selectedNode.id) {
                          return {
                            ...n,
                            data: { ...n.data, description: e.target.value },
                          };
                        }
                        return n;
                      })
                    );
                  }}
                  rows={3}
                  className="w-full px-3 py-2 text-sm bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
              
              <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-100 dark:border-blue-900/50">
                <p className="text-sm text-blue-700 dark:text-blue-400">
                  Settings specific to the <strong>{selectedNode.data.type as string}</strong> block will appear here.
                </p>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center text-zinc-500 pt-12">
              <div className="w-12 h-12 bg-zinc-100 dark:bg-zinc-900 rounded-full flex items-center justify-center mb-3">
                <Settings className="w-6 h-6 text-zinc-400" />
              </div>
              <p className="text-sm">Select a block on the canvas<br />to configure its settings.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
