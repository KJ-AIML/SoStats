export class CreateAutomationDto {
  name!: string;
  description?: string;
  triggerType!: string;
  workflowDefinition!: unknown;
}
