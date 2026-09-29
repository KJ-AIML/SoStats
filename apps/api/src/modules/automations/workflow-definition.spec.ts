import { describe, expect, it } from 'vitest';
import {
  orderWorkflow,
  validateWorkflowDefinition,
  workflowTriggerMode,
} from './workflow-definition.js';

function linearDefinition() {
  return {
    nodes: [
      { id: 'trigger', data: { type: 'trigger' } },
      { id: 'generate', data: { type: 'generate' } },
      { id: 'review', data: { type: 'review' } },
      { id: 'schedule', data: { type: 'schedule' } },
    ],
    edges: [
      { source: 'trigger', target: 'generate' },
      { source: 'generate', target: 'review' },
      { source: 'review', target: 'schedule' },
    ],
  };
}

describe('automation workflow definition', () => {
  it('accepts and orders a linear automation', () => {
    const definition = validateWorkflowDefinition(linearDefinition());

    expect(orderWorkflow(definition).map((node) => node.id)).toEqual([
      'trigger',
      'generate',
      'review',
      'schedule',
    ]);
  });

  it('defaults trigger mode to manual', () => {
    const definition = validateWorkflowDefinition(linearDefinition());
    expect(workflowTriggerMode(definition)).toBe('manual');
  });

  it('validates an RSS source configuration', () => {
    const candidate = linearDefinition();
    (candidate.nodes[0].data as {
      type: string;
      config?: Record<string, unknown>;
    }).config = {
      mode: 'rss',
      feedUrl: 'https://example.com/feed.xml',
      pollMinutes: 15,
      initialSync: 'baseline',
    };
    const definition = validateWorkflowDefinition(candidate);
    expect(workflowTriggerMode(definition)).toBe('rss');
  });

  it('rejects invalid RSS polling configuration', () => {
    const candidate = linearDefinition();
    (candidate.nodes[0].data as {
      type: string;
      config?: Record<string, unknown>;
    }).config = {
      mode: 'rss',
      feedUrl: 'file:///etc/passwd',
      pollMinutes: 1,
    };

    const definition = validateWorkflowDefinition(candidate);
    expect(() => workflowTriggerMode(definition)).toThrow();
  });

  it('rejects branching in runtime v1', () => {
    const definition = linearDefinition();
    definition.edges.push({ source: 'generate', target: 'schedule' });

    expect(() => validateWorkflowDefinition(definition)).toThrow(
      /linear workflow/i,
    );
  });

  it('rejects unsupported executable nodes', () => {
    const definition = linearDefinition();
    definition.nodes[1].data.type = 'shell';

    expect(() => validateWorkflowDefinition(definition)).toThrow(
      /unsupported automation node type/i,
    );
  });

  it('requires the trigger to be the single workflow root', () => {
    const definition = linearDefinition();
    definition.edges = definition.edges.slice(1);

    expect(() => validateWorkflowDefinition(definition)).toThrow();
  });
});
