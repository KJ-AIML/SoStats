import {
  Filter,
  LayoutGrid,
  List,
  Plus,
  Search,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContentBoard } from "@/components/content/content-board";
import type { ContentItem, ContentStatus } from "@/components/content/data";
import { PageHeading } from "@/components/sostats/page-heading";
import { loadWorkspaceSnapshot } from "@/lib/sostats-api.server";

function toBoardStatus(status: string): ContentStatus {
  switch (status) {
    case "in_review":
    case "approved":
      return "Review";
    case "scheduled":
      return "Scheduled";
    case "published":
      return "Published";
    case "draft":
      return "Drafts";
    default:
      return "Ideas";
  }
}

export default async function ContentPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  let items: ContentItem[] = [];
  let channels: Array<{
    id: number;
    provider: string;
    accountName?: string | null;
  }> = [];
  let connectionError = false;

  try {
    const snapshot = await loadWorkspaceSnapshot(workspaceSlug);
    channels = snapshot.channels
      .filter(
        (channel) =>
          channel.status === "active" &&
          channel.supported !== false &&
          channel.capabilities?.text !== false,
      )
      .map((channel) => ({
        id: channel.id,
        provider: channel.provider,
        accountName: channel.accountName,
      }));
    items = snapshot.content.map((item) => ({
      id: String(item.id),
      title: item.title,
      description: item.description || undefined,
      status: toBoardStatus(item.status),
      channel:
        item.variants
          ?.map((variant) => variant.platform)
          .filter(Boolean)
          .slice(0, 2)
          .join(" + ") || "Generic",
      campaign: item.campaign?.name || "Unassigned",
      time:
        item.scheduledPublications?.[0]?.scheduledAt
          ? new Date(item.scheduledPublications[0].scheduledAt).toLocaleString()
          : "Updated recently",
      variantRefs: item.variants?.map((variant) => ({
        id: variant.id,
        platform: variant.platform,
      })),
    }));
  } catch {
    connectionError = true;
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1600px] flex-col gap-5 p-4 md:p-6 xl:p-8">
      <PageHeading
        eyebrow="Content"
        title="Your content pipeline"
        description="Move every idea through drafting, review, scheduling and publishing without losing the campaign context behind it."
        actions={
          <>
            <Button variant="outline" className="h-10 rounded-xl text-[10px]">
              <Sparkles className="mr-2 h-3.5 w-3.5" />
              AI generate
            </Button>
            <Button className="h-10 rounded-xl bg-[#ef2b2d] text-[10px] hover:bg-[#da2427]">
              <Plus className="mr-2 h-3.5 w-3.5" />
              New content
            </Button>
          </>
        }
      />

      {connectionError && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[10px] text-amber-800">
          The API is currently unavailable. Start the API/database stack to load and persist content.
        </div>
      )}

      <div className="sostats-card flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
        <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-xl bg-neutral-50 px-3">
          <Search className="h-3.5 w-3.5 text-neutral-400" />
          <input
            className="min-w-0 flex-1 bg-transparent text-[10px] outline-none placeholder:text-neutral-400"
            placeholder="Search content, campaigns or channels..."
          />
        </div>
        <div className="flex items-center gap-2">
          <button className="inline-flex h-9 items-center gap-2 rounded-xl border border-black/[0.06] bg-white px-3 text-[9px] font-semibold text-neutral-600">
            <Filter className="h-3.5 w-3.5" />
            Filter
          </button>
          <div className="flex h-9 items-center rounded-xl border border-black/[0.06] bg-neutral-50 p-1">
            <button className="flex h-7 w-8 items-center justify-center rounded-lg bg-white shadow-sm">
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <button className="flex h-7 w-8 items-center justify-center rounded-lg text-neutral-400">
              <List className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {items.length === 0 && !connectionError && (
        <div className="rounded-xl border border-dashed border-black/[0.1] bg-white/60 px-4 py-3 text-[10px] text-muted-foreground">
          No content yet. Generate a campaign in AI Studio and its content will appear here automatically.
        </div>
      )}

      <div className="min-h-[560px] flex-1">
        <ContentBoard
          workspaceSlug={workspaceSlug}
          initialItems={items}
          channels={channels}
        />
      </div>
    </div>
  );
}
