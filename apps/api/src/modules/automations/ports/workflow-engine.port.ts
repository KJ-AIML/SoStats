export const WORKFLOW_ENGINE_PORT = 'WORKFLOW_ENGINE_PORT';

export interface WorkflowEnginePort {
  runWorkflow(
    automationId: number,
    versionId: number,
    definition: any,
  ): Promise<string>;
}
