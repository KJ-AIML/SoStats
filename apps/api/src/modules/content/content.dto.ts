export class CreateContentDto {
  brandId?: number;
  title!: string;
  description?: string;
  status?: string;
}

export class UpdateContentStatusDto {
  status!: string;
}

export class RepurposeContentDto {
  platforms!: string[];
}
