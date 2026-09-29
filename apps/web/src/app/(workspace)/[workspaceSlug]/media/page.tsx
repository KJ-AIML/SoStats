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

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 p-4 md:p-6 xl:p-8">
      <PageHeading
        eyebrow="Media"
        title="Verified media, ready for content"
        description="Upload directly to private object storage. SoStats verifies the object, extracts real image/video metadata in the worker, and only marks the asset ready after processing succeeds."
      />

      {!snapshot && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[10px] text-amber-800">
          Media records are unavailable until the API/database stack is running.
        </div>
      )}

      <MediaLibrary
        workspaceSlug={workspaceSlug}
        initialAssets={snapshot?.assets || []}
        brandId={snapshot?.brand?.id}
      />
    </div>
  );
}
