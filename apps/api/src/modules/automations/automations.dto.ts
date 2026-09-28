export class CreateAutomationDto {
  name!: string;
  description?: string;
  triggerType!: string;
  workflowDefinition!: unknown;
}

export class UpdateAutomationDto {
  name?: string;
  description?: string;
}

export class CreateAutomationVersionDto {
  workflowDefinition!: unknown;
}

export class RunAutomationDto {
  triggerPayload?: Record<string, unknown>;
}

export class AutomationDecisionDto {
  decision!: 'approve' | 'reject';
  notes?: string;
}
