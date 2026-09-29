export type ContentStatus =
  | "Ideas"
  | "Drafts"
  | "Review"
  | "Scheduled"
  | "Published";

export type ContentVariantRef = {
  id: number;
  platform?: string | null;
  content: string;
  status: string;
};

export type ContentScheduleRef = {
  id: number;
  status: string;
  scheduledAt: string;
  provider?: string | null;
  accountName?: string | null;
};

export interface ContentItem {
  id: string;
  title: string;
  status: ContentStatus;
  rawStatus: string;
  description?: string;
  channel?: string;
  campaign?: string;
  campaignId?: number | null;
  brandId?: number | null;
  time?: string;
  updatedAt?: string;
  variantRefs: ContentVariantRef[];
  schedules: ContentScheduleRef[];
}
