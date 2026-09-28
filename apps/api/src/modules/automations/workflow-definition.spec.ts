import { describe, expect, it } from 'vitest';
import {
  orderWorkflow,
  validateWorkflowDefinition,
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
