export type ContentStatus =
  | "Ideas"
  | "Drafts"
  | "Review"
  | "Scheduled"
  | "Published";

export interface ContentItem {
  id: string;
  title: string;
  status: ContentStatus;
  description?: string;
  channel?: string;
  campaign?: string;
  time?: string;
  variantRefs?: Array<{
    id: number;
    platform?: string | null;
  }>;
}

export const initialContentItems: ContentItem[] = [
  {
    id: "1",
    title: "Founder POV: AI content needs a workflow",
    status: "Ideas",
    description: "Turn the founder note into a strong point-of-view post.",
    channel: "LinkedIn",
    campaign: "SoStats launch",
    time: "Idea",
  },
  {
    id: "2",
    title: "One idea → five channel variants",
    status: "Drafts",
    description: "Show how the same campaign adapts without copy-paste content.",
    channel: "Multi-channel",
    campaign: "SoStats launch",
    time: "12m ago",
  },
  {
    id: "3",
    title: "The hidden cost of manual content ops",
    status: "Review",
    description: "Educational carousel with a workflow breakdown and CTA.",
    channel: "Instagram",
    campaign: "Automation education",
    time: "Needs review",
  },
  {
    id: "4",
    title: "3 automations I use every week",
    status: "Scheduled",
    description: "Short-form post adapted for X and LinkedIn.",
    channel: "X",
    campaign: "Founder content",
    time: "Today · 13:00",
  },
  {
    id: "5",
    title: "Why we built SoStats",
    status: "Published",
    description: "Founder story with product workflow screenshots.",
    channel: "LinkedIn",
    campaign: "SoStats launch",
    time: "Yesterday",
  },
];
