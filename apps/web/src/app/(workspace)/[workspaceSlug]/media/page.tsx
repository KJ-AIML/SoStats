import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PageHeading } from "@/components/sostats/page-heading";
import { MediaLibrary } from "@/components/media/media-library";
import { loadWorkspaceSnapshot } from "@/lib/sostats-api.server";

export default async function MediaPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  let snapshot: Awaited<ReturnType<typeof loadWorkspaceSnapshot>> | null = null;

  try {
    snapshot = await loadWorkspaceSnapshot(workspaceSlug);
  } catch {
    snapshot = null;
  }

  const brands =
    snapshot?.brands.map((brand) => ({
      id: brand.id,
      name: brand.name,
    })) || [];

  const contentItems =
    snapshot?.content
      .filter((item) => !["scheduled", "published"].includes(item.status))
      .map((item) => ({
        id: item.id,
        title: item.title,
        status: item.status,
        brandId: item.brandId,
        campaign: item.campaign?.name || "Unassigned",
        variants:
          item.variants?.map((variant) => ({
            id: variant.id,
            platform: variant.platform,
            status: variant.status,
          })) || [],
      })) || [];

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 p-4 md:p-6 xl:p-8">
      <PageHeading
        eyebrow="Media"
        title="Private assets, ready for real content"
        description="Upload directly to private object storage, inspect verified metadata, attach ready media to draft/review content, and keep processing/deletion lifecycle safe."
        actions={
          <Link
            href={`/${workspaceSlug}/content`}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-black/[0.07] bg-white px-4 text-[10px] font-semibold text-neutral-700 transition hover:bg-neutral-50"
          >
            Open Content
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        }
      />

      {!snapshot && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[10px] text-amber-800">
          Media records are unavailable until the API/database stack is running.
        </div>
      )}

      <MediaLibrary
        workspaceSlug={workspaceSlug}
        initialAssets={snapshot?.assets || []}
        brands={brands}
        defaultBrandId={snapshot?.brand?.id}
        contentItems={contentItems}
      />
    </div>
  );
}
