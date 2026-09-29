export class CreateBrandDto {
  name!: string;
  description?: string;
  websiteUrl?: string;
}

export class UpdateBrandDto {
  name?: string;
  description?: string;
  websiteUrl?: string;
}

export type BrandVoiceInput = {
  tone: string;
  style?: string;
  guidelines?: string;
};

export type BrandAudienceInput = {
  name: string;
  demographics?: string;
  painPoints?: string;
};

export type BrandProductInput = {
  name: string;
  description?: string;
  features?: string;
};

export type BrandPillarInput = {
  name: string;
  description?: string;
};

export type BrandRuleInput = {
  ruleType: string;
  description: string;
};

export class ReplaceBrandContextDto {
  voiceProfiles?: BrandVoiceInput[];
  audiences?: BrandAudienceInput[];
  products?: BrandProductInput[];
  pillars?: BrandPillarInput[];
  rules?: BrandRuleInput[];
}
