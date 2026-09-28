export class CreateCampaignDto {
  workspaceId!: number;
  brandId?: number;
  name!: string;
  description?: string;
  goal?: string;
  startDate?: string;
  endDate?: string;
}

export class GenerateCampaignDto {
  topic?: string;
  instructions?: string;
}
