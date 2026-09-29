"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  FileImage,
  Film,
  Folder,
  LoaderCircle,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import type { AssetRecord } from "@/lib/sostats-api.server";
import { Button } from "@/components/ui/button";

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(value?: number | null) {
  if (typeof value !== "number") return null;
  const totalSeconds = Math.round(value / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function statusClass(status: string) {
  switch (status) {
    case "ready":
      return "bg-emerald-50 text-emerald-700";
    case "failed":
      return "bg-red-50 text-red-700";
    case "processing":
      return "bg-blue-50 text-blue-700";
    default:
      return "bg-amber-50 text-amber-700";
  }
}

export function MediaLibrary({
  workspaceSlug,
  initialAssets,
  brandId,
}: {
  workspaceSlug: string;
  initialAssets: AssetRecord[];
  brandId?: number;
}) {
  const [assets, setAssets] = useState(initialAssets);
  const [filter, setFilter] = useState<"all" | "image" | "video">("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    const response = await fetch(
      `/api/workspaces/${encodeURIComponent(workspaceSlug)}/assets`,
      { cache: "no-store" },
    );
    if (!response.ok) return;
    setAssets((await response.json()) as AssetRecord[]);
  }, [workspaceSlug]);

  const hasProcessingAssets = assets.some((asset) =>
    ["uploaded", "processing"].includes(asset.status),
  );

  useEffect(() => {
    if (!hasProcessingAssets) return;
    const timer = window.setInterval(() => {
      void reload();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [hasProcessingAssets, reload]);

  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return assets.filter((asset) => {
      if (filter !== "all" && asset.fileType !== filter) return false;
      if (!normalized) return true;
      return (
        asset.fileName.toLowerCase().includes(normalized) ||
        asset.mimeType.toLowerCase().includes(normalized)
      );
    });
  }, [assets, filter, query]);

  const upload = async (file: File) => {
    setBusy("upload");
    setError(null);
    try {
      const fileType = file.type.startsWith("image/")
        ? "image"
        : file.type.startsWith("video/")
          ? "video"
          : "unknown";

      const request = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/assets/upload-url`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            fileName: file.name,
            fileType,
            mimeType: file.type,
            size: file.size,
            brandId,
          }),
        },
      );
      const ticket = (await request.json()) as {
        uploadUrl?: string;
        asset?: AssetRecord;
        error?: string;
      };
      if (!request.ok || !ticket.uploadUrl || !ticket.asset) {
        throw new Error(ticket.error || "Unable to start upload");
      }

      setAssets((current) => [ticket.asset!, ...current]);

      const storageResponse = await fetch(ticket.uploadUrl, {
        method: "PUT",
        headers: { "content-type": file.type },
        body: file,
      });
      if (!storageResponse.ok) {
        throw new Error(
          `Object storage rejected the upload (HTTP ${storageResponse.status})`,
        );
      }

      const finalize = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/assets/${ticket.asset.id}/complete-upload`,
        { method: "POST" },
      );
      const finalized = (await finalize.json()) as AssetRecord & {
        error?: string;
      };
      if (!finalize.ok) {
        throw new Error(finalized.error || "Upload verification failed");
      }

      setAssets((current) =>
        current.map((asset) =>
          asset.id === finalized.id ? finalized : asset,
        ),
      );
      await reload();
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : "Upload failed",
      );
      await reload();
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const retry = async (assetId: number) => {
    setBusy(`retry-${assetId}`);
    setError(null);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/assets/${assetId}/retry`,
        { method: "POST" },
      );
      const payload = (await response.json()) as AssetRecord & {
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "Retry failed");
      await reload();
    } catch (retryError) {
      setError(
        retryError instanceof Error ? retryError.message : "Retry failed",
      );
    } finally {
      setBusy(null);
    }
  };

  const remove = async (assetId: number) => {
    setBusy(`delete-${assetId}`);
    setError(null);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/assets/${assetId}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error || "Delete failed");
      }
      setAssets((current) => current.filter((asset) => asset.id !== assetId));
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : "Delete failed",
      );
    } finally {
      setBusy(null);
    }
  };

  const counts = {
    all: assets.length,
    image: assets.filter((asset) => asset.fileType === "image").length,
    video: assets.filter((asset) => asset.fileType === "video").length,
  };

  return (
    <div className="space-y-4">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,video/mp4"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="sostats-card flex h-11 min-w-0 flex-1 items-center gap-2 px-3">
          <Search className="h-3.5 w-3.5 text-neutral-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-[10px] outline-none"
            placeholder="Search assets..."
          />
        </div>
        <Button
          onClick={() => inputRef.current?.click()}
          disabled={busy === "upload"}
          className="h-11 rounded-xl bg-[#ef2b2d] text-[10px] hover:bg-[#da2427]"
        >
          {busy === "upload" ? (
            <LoaderCircle className="mr-2 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Upload className="mr-2 h-3.5 w-3.5" />
          )}
          {busy === "upload" ? "Uploading..." : "Upload media"}
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[9px] text-red-700">
          <AlertCircle className="h-3.5 w-3.5" />
          {error}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="sostats-card self-start p-3">
          <p className="px-2 py-2 text-[10px] font-semibold">Library</p>
          {[
            { id: "all" as const, icon: Folder, label: "All assets", count: counts.all },
            { id: "image" as const, icon: FileImage, label: "Images", count: counts.image },
            { id: "video" as const, icon: Film, label: "Video", count: counts.video },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setFilter(item.id)}
              className={
                filter === item.id
                  ? "flex w-full items-center gap-2 rounded-xl bg-[#fff0f0] px-2.5 py-2 text-[9px] font-semibold text-[#d92023]"
                  : "flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-[9px] font-medium text-neutral-500 hover:bg-neutral-50"
              }
            >
              <item.icon className="h-3.5 w-3.5" />
              {item.label}
              <span className="ml-auto text-[8px]">{item.count}</span>
            </button>
          ))}

          <div className="mt-4 rounded-xl border border-black/[0.05] bg-neutral-50 p-3">
            <p className="text-[9px] font-semibold">Processing pipeline</p>
            <p className="mt-1 text-[8px] leading-4 text-muted-foreground">
              Uploads are verified in object storage, then image/video metadata is extracted asynchronously before the asset becomes ready.
            </p>
          </div>
        </aside>

        <main className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.length ? (
            visible.map((asset, index) => (
              <article key={asset.id} className="sostats-card overflow-hidden">
                <div
                  className={
                    index % 3 === 0
                      ? "relative aspect-[16/10] overflow-hidden bg-gradient-to-br from-red-100 via-white to-neutral-300"
                      : index % 3 === 1
                        ? "relative aspect-[16/10] overflow-hidden bg-gradient-to-br from-neutral-950 via-red-950 to-red-500/60"
                        : "relative aspect-[16/10] overflow-hidden bg-gradient-to-br from-neutral-200 via-white to-orange-100"
                  }
                >
                  {asset.status === "ready" && asset.viewUrl && asset.fileType === "image" && (
                    // Signed object URLs are ephemeral and intentionally bypass Next image optimization.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={asset.viewUrl}
                      alt={asset.fileName}
                      className="h-full w-full object-cover"
                    />
                  )}
                  {asset.status === "ready" && asset.viewUrl && asset.fileType === "video" && (
                    <video
                      src={asset.viewUrl}
                      muted
                      playsInline
                      preload="metadata"
                      className="h-full w-full object-cover"
                    />
                  )}

                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/55 to-transparent p-3 pt-10">
                    <span className="rounded-lg border border-white/20 bg-black/25 px-2 py-1 text-[8px] font-semibold text-white backdrop-blur">
                      {asset.fileType}
                    </span>
                    <span className={`rounded-lg px-2 py-1 text-[8px] font-semibold ${statusClass(asset.status)}`}>
                      {asset.status}
                    </span>
                  </div>

                  {["uploading", "uploaded", "processing"].includes(asset.status) && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/70 backdrop-blur-sm">
                      <div className="text-center">
                        <LoaderCircle className="mx-auto h-5 w-5 animate-spin text-[#ef2b2d]" />
                        <p className="mt-2 text-[9px] font-semibold capitalize">
                          {asset.status}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="p-3.5">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[10px] font-semibold">{asset.fileName}</p>
                      <p className="mt-0.5 text-[8px] text-muted-foreground">
                        {asset.mimeType} · {formatBytes(asset.size)}
                      </p>
                    </div>
                    {asset.status === "ready" && (
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                    )}
                  </div>

                  {asset.status === "ready" && asset.width && asset.height && (
                    <p className="mt-2 text-[8px] text-muted-foreground">
                      {asset.width}×{asset.height}
                      {asset.durationMs ? ` · ${formatDuration(asset.durationMs)}` : ""}
                    </p>
                  )}

                  {asset.status === "failed" && (
                    <div className="mt-2 rounded-xl bg-red-50 p-2.5">
                      <p className="line-clamp-2 text-[8px] leading-4 text-red-700">
                        {asset.processingError || "Media processing failed."}
                      </p>
                      <button
                        onClick={() => void retry(asset.id)}
                        disabled={Boolean(busy)}
                        className="mt-2 inline-flex items-center gap-1.5 text-[8px] font-semibold text-red-700"
                      >
                        {busy === `retry-${asset.id}` ? (
                          <LoaderCircle className="h-3 w-3 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3 w-3" />
                        )}
                        Retry processing
                      </button>
                    </div>
                  )}

                  <div className="mt-3 flex justify-end">
                    <button
                      onClick={() => void remove(asset.id)}
                      disabled={Boolean(busy)}
                      className="sostats-icon h-7 w-7"
                      aria-label={`Delete ${asset.fileName}`}
                    >
                      {busy === `delete-${asset.id}` ? (
                        <LoaderCircle className="h-3 w-3 animate-spin" />
                      ) : (
                        <Trash2 className="h-3 w-3 text-neutral-400" />
                      )}
                    </button>
                  </div>
                </div>
              </article>
            ))
          ) : (
            <div className="sostats-card col-span-full p-10 text-center">
              <p className="text-sm font-semibold">No matching assets</p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Upload JPEG, PNG, WebP, GIF, or MP4 media to start the processing pipeline.
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
