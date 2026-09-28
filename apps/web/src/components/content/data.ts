export type ContentStatus = 'Ideas' | 'Drafts' | 'Review' | 'Scheduled' | 'Published';

export interface ContentItem {
  id: string;
  title: string;
  status: ContentStatus;
  description?: string;
}

export const initialContentItems: ContentItem[] = [
  { id: '1', title: 'Q1 Roadmap', status: 'Ideas', description: 'Draft the roadmap for Q1.' },
  { id: '2', title: 'Product Launch Announcement', status: 'Drafts', description: 'Write the blog post for the new product launch.' },
  { id: '3', title: 'Weekly Newsletter', status: 'Review', description: 'Review the content for this week\'s newsletter.' },
  { id: '4', title: 'Social Media Strategy', status: 'Scheduled', description: 'Schedule the social media posts for the week.' },
  { id: '5', title: '2023 Year in Review', status: 'Published', description: 'Publish the year in review blog post.' },
];
