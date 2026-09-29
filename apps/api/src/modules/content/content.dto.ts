export class CreateContentDto {
  brandId?: number;
  title!: string;
  description?: string;
  status?: string;
}

export class UpdateContentDto {
  title?: string;
  description?: string;
}

export class UpdateContentStatusDto {
  status!: string;
}

export class UpdateContentVariantDto {
  content!: string;
}

export class RepurposeContentDto {
  platforms!: string[];
}
