export class CreateAutomationDto {
  workspaceId!: number;
  name!: string;
  description?: string;
  triggerType!: string;
  workflowDefinition!: any;
}
