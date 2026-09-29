import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { ContentBoard } from "@/components/content/content-board";
import type { ContentItem, ContentStatus } from "@/components/content/data";
import { PageHeading } from "@/components/sostats/page-heading";
import { loadWorkspaceSnapshot } from "@/lib/sostats-api.server";

function toBoardStatus(status: string): ContentStatus | null {
  switch (status) {
    case "idea":
      return "Ideas";
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
      return null;
  }
}

function providerLabel(value?: string | null) {
  if (!value) return "Generic";
  if (value.toLowerCase() === "x") return "X";
  if (value.toLowerCase() === "linkedin") return "LinkedIn";
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
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
  let brands: Array<{ id: number; name: string }> = [];
  let connectionError = false;

  try {
    const snapshot = await loadWorkspaceSnapshot(workspaceSlug);

    brands = snapshot.brands.map((brand) => ({
      id: brand.id,
      name: brand.name,
    }));

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

    items = snapshot.content.flatMap((item) => {
      const status = toBoardStatus(item.status);
      if (!status) return [];

      const variants =
        item.variants?.map((variant) => ({
          id: variant.id,
          platform: variant.platform,
          content: variant.content,
          status: variant.status,
        })) || [];

      const schedules =
        item.scheduledPublications?.map((schedule) => ({
          id: schedule.id,
          status: schedule.status,
          scheduledAt: schedule.scheduledAt,
          provider: schedule.socialAccount?.provider,
          accountName: schedule.socialAccount?.accountName,
        })) || [];

      const activeSchedule = schedules
        .filter((schedule) => schedule.status === "scheduled")
        .sort(
          (a, b) =>
            new Date(a.scheduledAt).getTime() -
            new Date(b.scheduledAt).getTime(),
        )[0];

      const channel =
        variants
          .map((variant) => variant.platform)
          .filter((value): value is string => Boolean(value))
          .slice(0, 2)
          .map(providerLabel)
          .join(" + ") || "Canonical";

      return [
        {
          id: String(item.id),
          title: item.title,
          description: item.description || undefined,
          status,
          rawStatus: item.status,
          brandId: item.brandId,
          campaignId: item.campaignId,
          channel,
          campaign: item.campaign?.name || "Unassigned",
          time: activeSchedule
            ? new Date(activeSchedule.scheduledAt).toLocaleString()
            : new Date(item.updatedAt).toLocaleString(),
          updatedAt: item.updatedAt,
          variantRefs: variants,
          schedules,
        } satisfies ContentItem,
      ];
    });
  } catch {
    connectionError = true;
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1600px] flex-col gap-5 p-4 md:p-6 xl:p-8">
      <PageHeading
        eyebrow="Content"
        title="Review, approve and schedule real content"
        description="Manage canonical content and channel variants through the real lifecycle. Scheduling owns the queued state, and the publishing worker owns the published state."
        actions={
          <Link
            href={`/${workspaceSlug}/ai-studio`}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-black/[0.07] bg-white px-4 text-[10px] font-semibold text-neutral-700 transition hover:bg-neutral-50"
          >
            <Sparkles className="h-3.5 w-3.5 text-[#ef2b2d]" />
            Generate in AI Studio
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        }
      />

      {connectionError && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[10px] text-amber-800">
          The API is currently unavailable. Start the API/database stack to load and persist content.
        </div>
      )}

      {!connectionError && items.length === 0 && (
        <div className="rounded-xl border border-dashed border-black/[0.1] bg-white/60 px-4 py-3 text-[10px] text-muted-foreground">
          No content yet. Create a manual idea below or generate a grounded campaign in AI Studio.
        </div>
      )}

      <div className="min-h-[560px] flex-1">
        <ContentBoard
          workspaceSlug={workspaceSlug}
          initialItems={items}
          channels={channels}
          brands={brands}
        />
      </div>
    </div>
  );
}
