import {
  FileImage,
  Film,
  Folder,
  Plus,
  Search,
  Sparkles,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeading } from "@/components/sostats/page-heading";
import { loadWorkspaceSnapshot } from "@/lib/sostats-api.server";

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function MediaPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  let assets: Array<{
    id: number;
    fileName: string;
    fileType: string;
    mimeType: string;
    size: number;
    publicUrl?: string | null;
  }> = [];
  let connectionError = false;

  try {
    const snapshot = await loadWorkspaceSnapshot(workspaceSlug);
    assets = snapshot.assets;
  } catch {
    connectionError = true;
  }

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 p-4 md:p-6 xl:p-8">
      <PageHeading
        eyebrow="Media"
        title="Every asset, ready for every channel"
        description="Assets are backed by the object-storage port, so the UI does not depend on one storage provider."
        actions={
          <>
            <Button variant="outline" className="h-10 rounded-xl text-[10px]">
              <Upload className="mr-2 h-3.5 w-3.5" />
              Upload
            </Button>
            <Button className="h-10 rounded-xl bg-[#ef2b2d] text-[10px] hover:bg-[#da2427]">
              <Sparkles className="mr-2 h-3.5 w-3.5" />
              Generate asset
            </Button>
          </>
        }
      />

      {connectionError && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[10px] text-amber-800">
          Media records are unavailable until the API/database stack is running.
        </div>
      )}

      <div className="sostats-card flex h-11 items-center gap-2 px-3">
        <Search className="h-3.5 w-3.5 text-neutral-400" />
        <input className="min-w-0 flex-1 bg-transparent text-[10px] outline-none" placeholder="Search assets..." />
      </div>

      <div className="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="sostats-card self-start p-3">
          <p className="px-2 py-2 text-[10px] font-semibold">Library</p>
          {[
            { icon: Folder, label: "All assets", count: String(assets.length) },
            { icon: FileImage, label: "Images", count: String(assets.filter((asset) => asset.fileType === "image").length) },
            { icon: Film, label: "Video", count: String(assets.filter((asset) => asset.fileType === "video").length) },
          ].map((item, index) => (
            <button
              key={item.label}
              className={
                index === 0
                  ? "flex w-full items-center gap-2 rounded-xl bg-[#fff0f0] px-2.5 py-2 text-[9px] font-semibold text-[#d92023]"
                  : "flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-[9px] font-medium text-neutral-500 hover:bg-neutral-50"
              }
            >
              <item.icon className="h-3.5 w-3.5" />
              {item.label}
              <span className="ml-auto text-[8px]">{item.count}</span>
            </button>
          ))}
          <button className="mt-2 flex w-full items-center gap-2 rounded-xl border border-dashed border-black/[0.08] px-2.5 py-2 text-[9px] text-muted-foreground">
            <Plus className="h-3.5 w-3.5" /> New collection
          </button>
        </aside>

        <main className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {assets.length ? (
            assets.map((asset, index) => (
              <article key={asset.id} className="sostats-card overflow-hidden">
                <div
                  className={
                    index % 3 === 0
                      ? "aspect-[16/10] bg-gradient-to-br from-red-100 via-white to-neutral-300 p-4"
                      : index % 3 === 1
                        ? "aspect-[16/10] bg-gradient-to-br from-neutral-950 via-red-950 to-red-500/60 p-4"
                        : "aspect-[16/10] bg-gradient-to-br from-neutral-200 via-white to-orange-100 p-4"
                  }
                  style={
                    asset.publicUrl
                      ? {
                          backgroundImage: `linear-gradient(rgba(0,0,0,.12),rgba(0,0,0,.12)),url("${asset.publicUrl}")`,
                          backgroundSize: "cover",
                          backgroundPosition: "center",
                        }
                      : undefined
                  }
                >
                  <div className="flex h-full items-end">
                    <span className="rounded-lg border border-white/20 bg-black/25 px-2 py-1 text-[8px] font-semibold text-white backdrop-blur">
                      {asset.fileType}
                    </span>
                  </div>
                </div>
                <div className="p-3.5">
                  <p className="truncate text-[10px] font-semibold">{asset.fileName}</p>
                  <p className="mt-0.5 text-[8px] text-muted-foreground">
                    {asset.mimeType} · {formatBytes(asset.size)}
                  </p>
                </div>
              </article>
            ))
          ) : (
            <div className="sostats-card col-span-full p-10 text-center">
              <p className="text-sm font-semibold">No assets yet</p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Request an upload URL through the media API to add your first asset.
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
