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
