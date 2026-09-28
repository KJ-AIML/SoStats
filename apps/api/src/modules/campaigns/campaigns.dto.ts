export class CreateCampaignDto {
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
