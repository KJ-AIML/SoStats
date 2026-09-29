import { BadRequestException } from '@nestjs/common';

export type WorkflowNodeKind =
  | 'trigger'
  | 'generate'
  | 'review'
  | 'schedule'
  | 'analyze';

export type WorkflowNode = {
  id: string;
  type?: string;
  data: {
    type?: string;
    label?: string;
    description?: string;
    config?: Record<string, unknown>;
  };
};

export type WorkflowEdge = {
  id?: string;
  source: string;
  target: string;
};

export type WorkflowDefinition = {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
};

export type WorkflowTriggerMode = 'manual' | 'rss';

const supportedKinds = new Set<WorkflowNodeKind>([
  'trigger',
  'generate',
  'review',
  'schedule',
  'analyze',
]);

export function workflowNodeKind(node: WorkflowNode): WorkflowNodeKind {
  const raw = String(node.data?.type || node.type || '').trim();
  if (!supportedKinds.has(raw as WorkflowNodeKind)) {
    throw new BadRequestException(
      `Unsupported automation node type "${raw || 'unknown'}"`,
    );
  }
  return raw as WorkflowNodeKind;
}

export function validateWorkflowDefinition(
  input: unknown,
): WorkflowDefinition {
  if (!input || typeof input !== 'object') {
    throw new BadRequestException('workflowDefinition must be an object');
  }

  const candidate = input as Partial<WorkflowDefinition>;
  if (!Array.isArray(candidate.nodes) || candidate.nodes.length === 0) {
    throw new BadRequestException(
      'workflowDefinition.nodes must contain at least one node',
    );
  }
  if (!Array.isArray(candidate.edges)) {
    throw new BadRequestException('workflowDefinition.edges must be an array');
  }

  const nodes = candidate.nodes.map((node) => {
    if (
      !node ||
      typeof node !== 'object' ||
      typeof node.id !== 'string' ||
      !node.id.trim() ||
      !node.data ||
      typeof node.data !== 'object'
    ) {
      throw new BadRequestException('Every workflow node needs an id and data');
    }
    workflowNodeKind(node);
    return node;
  });

  const nodeIds = new Set(nodes.map((node) => node.id));
  if (nodeIds.size !== nodes.length) {
    throw new BadRequestException('Workflow node ids must be unique');
  }

  const edges = candidate.edges.map((edge) => {
    if (
      !edge ||
      typeof edge !== 'object' ||
      typeof edge.source !== 'string' ||
      typeof edge.target !== 'string' ||
      !nodeIds.has(edge.source) ||
      !nodeIds.has(edge.target)
    ) {
      throw new BadRequestException(
        'Every workflow edge must reference existing nodes',
      );
    }
    return edge;
  });

  const triggers = nodes.filter((node) => workflowNodeKind(node) === 'trigger');
  if (triggers.length !== 1) {
    throw new BadRequestException(
      'Automation v1 requires exactly one trigger node',
    );
  }

  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const node of nodes) {
    incoming.set(node.id, 0);
    outgoing.set(node.id, []);
  }

  for (const edge of edges) {
    incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1);
    outgoing.get(edge.source)?.push(edge.target);
  }

  for (const node of nodes) {
    if ((incoming.get(node.id) || 0) > 1 || (outgoing.get(node.id)?.length || 0) > 1) {
      throw new BadRequestException(
        'Automation v1 supports a linear workflow; branching will be added in a later runtime version',
      );
    }
  }

  const roots = nodes.filter((node) => (incoming.get(node.id) || 0) === 0);
  if (roots.length !== 1 || workflowNodeKind(roots[0]) !== 'trigger') {
    throw new BadRequestException(
      'The trigger must be the single root of the workflow',
    );
  }

  if (nodes.length > 1 && edges.length !== nodes.length - 1) {
    throw new BadRequestException(
      'Automation v1 requires every workflow node to be connected',
    );
  }

  const ordered = orderWorkflow({ nodes, edges });
  if (ordered.length !== nodes.length) {
    throw new BadRequestException('Workflow contains a cycle');
  }

  return { nodes, edges };
}

export function orderWorkflow(
  definition: WorkflowDefinition,
): WorkflowNode[] {
  const byId = new Map(definition.nodes.map((node) => [node.id, node]));
  const incoming = new Map(definition.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, string[]>(
    definition.nodes.map((node) => [node.id, []]),
  );

  for (const edge of definition.edges) {
    incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1);
    outgoing.get(edge.source)?.push(edge.target);
  }

  const queue = definition.nodes
    .filter((node) => (incoming.get(node.id) || 0) === 0)
    .map((node) => node.id);
  const result: WorkflowNode[] = [];

  while (queue.length) {
    const id = queue.shift();
    if (!id) break;
    const node = byId.get(id);
    if (!node) continue;
    result.push(node);

    for (const target of outgoing.get(id) || []) {
      const next = (incoming.get(target) || 0) - 1;
      incoming.set(target, next);
      if (next === 0) queue.push(target);
    }
  }

  return result;
}

export function nodeConfig(node: WorkflowNode) {
  return node.data.config && typeof node.data.config === 'object'
    ? node.data.config
    : {};
}


export function workflowTriggerMode(
  definition: WorkflowDefinition,
): WorkflowTriggerMode {
  const trigger = definition.nodes.find(
    (node) => workflowNodeKind(node) === 'trigger',
  );
  if (!trigger) {
    throw new BadRequestException('Workflow trigger node was not found');
  }

  const config = nodeConfig(trigger);
  const mode = String(config.mode || 'manual').trim().toLowerCase();

  if (mode === 'manual') return 'manual';
  if (mode !== 'rss') {
    throw new BadRequestException(
      'Trigger mode must be manual or rss',
    );
  }

  const feedUrl = String(config.feedUrl || '').trim();
  if (!feedUrl || feedUrl.length > 2048) {
    throw new BadRequestException(
      'RSS trigger requires config.feedUrl',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(feedUrl);
  } catch {
    throw new BadRequestException('RSS feed URL is invalid');
  }

  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password
  ) {
    throw new BadRequestException(
      'RSS feed URL must use HTTP or HTTPS without embedded credentials',
    );
  }

  const pollMinutes = Number(config.pollMinutes ?? 15);
  if (
    !Number.isInteger(pollMinutes) ||
    pollMinutes < 5 ||
    pollMinutes > 1440
  ) {
    throw new BadRequestException(
      'RSS pollMinutes must be an integer between 5 and 1440',
    );
  }

  const initialSync = String(config.initialSync || 'baseline');
  if (!['baseline', 'latest'].includes(initialSync)) {
    throw new BadRequestException(
      'RSS initialSync must be baseline or latest',
    );
  }

  return 'rss';
}
