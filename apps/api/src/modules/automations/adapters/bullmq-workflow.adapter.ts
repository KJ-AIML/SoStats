import { Injectable } from '@nestjs/common';
import { WorkflowEnginePort } from '../ports/workflow-engine.port.js';
import { randomUUID } from 'crypto';

@Injectable()
export class BullMQWorkflowAdapter implements WorkflowEnginePort {
  async runWorkflow(
    _automationId: number,
    _versionId: number,
    _definition: any,
  ): Promise<string> {
    // In a real implementation, this would enqueue a BullMQ job to run the workflow definition
    // For now, return a dummy ID.
    const runId = `run-${randomUUID()}`;
    return runId;
  }
}
