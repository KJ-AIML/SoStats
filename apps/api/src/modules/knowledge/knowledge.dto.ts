export class CreateKnowledgeSourceDto {
  brandId!: number;
  sourceType!: 'text' | 'url';
  title!: string;
  url?: string;
  text?: string;
}

export class SearchKnowledgeDto {
  brandId!: number;
  query!: string;
  limit?: number;
}
