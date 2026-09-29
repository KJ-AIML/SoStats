"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  FileImage,
  Film,
  Folder,
  HardDrive,
  Image as ImageIcon,
  Link2,
  LoaderCircle,
  Paperclip,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Unlink,
  Upload,
} from "lucide-react";
import type { AssetRecord } from "@/lib/sostats-api.server";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type BrandOption = {
  id: number;
  name: string;
};

type ContentOption = {
  id: number;
  title: string;
  status: string;
  brandId?: number | null;
  campaign: string;
  variants: Array<{
    id: number;
    platform?: string | null;
    status: string;
  }>;
};

type TypeFilter = "all" | "image" | "video";
type StatusFilter =
  | "all"
  | "ready"
  | "processing"
  | "failed"
  | "uploading";
type UsageFilter = "all" | "used" | "unused";

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(value?: number | null) {
  if (typeof value !== "number") return "—";
  const totalSeconds = Math.round(value / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString() : "—";
}

function statusClass(status: string) {
  switch (status) {
    case "ready":
      return "bg-emerald-50 text-emerald-700";
    case "failed":
      return "bg-red-50 text-red-700";
    case "processing":
      return "bg-blue-50 text-blue-700";
    case "uploaded":
      return "bg-violet-50 text-violet-700";
    default:
      return "bg-amber-50 text-amber-700";
  }
}

function providerLabel(value?: string | null) {
  if (!value) return "Canonical";
  if (value.toLowerCase() === "x") return "X";
  if (value.toLowerCase() === "linkedin") return "LinkedIn";
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function directUpload(
  uploadUrl: string,
  file: File,
  onProgress: (value: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("content-type", file.type);

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onerror = () => reject(new Error("Object storage upload failed"));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
        return;
      }
      reject(
        new Error(`Object storage rejected the upload (HTTP ${xhr.status})`),
      );
    };
    xhr.send(file);
  });
}

export function MediaLibrary({
  workspaceSlug,
  initialAssets,
  brands,
  defaultBrandId,
  contentItems,
}: {
  workspaceSlug: string;
  initialAssets: AssetRecord[];
  brands: BrandOption[];
  defaultBrandId?: number;
  contentItems: ContentOption[];
}) {
  const [assets, setAssets] = useState(initialAssets);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [usageFilter, setUsageFilter] = useState<UsageFilter>("all");
  const [brandFilter, setBrandFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [uploadBrandId, setUploadBrandId] = useState(
    defaultBrandId ? String(defaultBrandId) : "",
  );
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadFileName, setUploadFileName] = useState<string | null>(null);

  const [selectedAssetId, setSelectedAssetId] = useState<number | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<AssetRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [contentItemId, setContentItemId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    const response = await fetch(
      `/api/workspaces/${encodeURIComponent(workspaceSlug)}/assets`,
      { cache: "no-store" },
    );
    if (!response.ok) return;
    const payload = (await response.json()) as AssetRecord[];
    setAssets(payload);
    setSelectedAsset((current) =>
      current
        ? payload.find((asset) => asset.id === current.id) || current
        : current,
    );
  }, [workspaceSlug]);

  const refreshAsset = useCallback(
    async (assetId: number) => {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/assets/${assetId}`,
        { cache: "no-store" },
      );
      if (!response.ok) return null;
      const asset = (await response.json()) as AssetRecord;
      setAssets((current) =>
        current.map((item) => (item.id === asset.id ? asset : item)),
      );
      setSelectedAsset(asset);
      return asset;
    },
    [workspaceSlug],
  );

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
      if (typeFilter !== "all" && asset.fileType !== typeFilter) return false;

      if (statusFilter !== "all") {
        if (
          statusFilter === "processing" &&
          !["uploaded", "processing"].includes(asset.status)
        ) {
          return false;
        }
        if (
          statusFilter !== "processing" &&
          asset.status !== statusFilter
        ) {
          return false;
        }
      }

      const used = (asset.usageCount || 0) > 0;
      if (usageFilter === "used" && !used) return false;
      if (usageFilter === "unused" && used) return false;

      if (
        brandFilter !== "all" &&
        String(asset.brandId || "") !== brandFilter
      ) {
        return false;
      }

      if (!normalized) return true;
      return (
        asset.fileName.toLowerCase().includes(normalized) ||
        asset.mimeType.toLowerCase().includes(normalized) ||
        asset.usages?.some((usage) =>
          usage.contentTitle?.toLowerCase().includes(normalized),
        )
      );
    });
  }, [
    assets,
    brandFilter,
    query,
    statusFilter,
    typeFilter,
    usageFilter,
  ]);

  const selectedContent = contentItems.find(
    (item) => item.id === Number(contentItemId),
  );

  const upload = async (file: File) => {
    setBusy("upload");
    setError(null);
    setUploadFileName(file.name);
    setUploadProgress(0);

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
            brandId: uploadBrandId ? Number(uploadBrandId) : undefined,
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
      await directUpload(ticket.uploadUrl, file, setUploadProgress);

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
      setUploadProgress(null);
      setUploadFileName(null);
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
      if (selectedAssetId === assetId) await refreshAsset(assetId);
    } catch (retryError) {
      setError(
        retryError instanceof Error ? retryError.message : "Retry failed",
      );
    } finally {
      setBusy(null);
    }
  };

  const openAsset = async (assetId: number) => {
    setSelectedAssetId(assetId);
    setSelectedAsset(assets.find((asset) => asset.id === assetId) || null);
    setContentItemId("");
    setVariantId("");
    setConfirmDelete(false);
    setError(null);
    setDetailLoading(true);
    try {
      await refreshAsset(assetId);
    } finally {
      setDetailLoading(false);
    }
  };

  const attach = async () => {
    if (!selectedAsset || !contentItemId) return;
    setBusy(`attach-${selectedAsset.id}`);
    setError(null);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/assets/${selectedAsset.id}/attachments`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            contentItemId: Number(contentItemId),
            variantId: variantId ? Number(variantId) : undefined,
          }),
        },
      );
      const payload = (await response.json()) as AssetRecord & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to attach media");
      }
      setSelectedAsset(payload);
      setAssets((current) =>
        current.map((asset) => (asset.id === payload.id ? payload : asset)),
      );
      setContentItemId("");
      setVariantId("");
    } catch (attachError) {
      setError(
        attachError instanceof Error
          ? attachError.message
          : "Unable to attach media",
      );
    } finally {
      setBusy(null);
    }
  };

  const detach = async (attachmentId: number) => {
    if (!selectedAsset) return;
    setBusy(`detach-${attachmentId}`);
    setError(null);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/assets/${selectedAsset.id}/attachments/${attachmentId}`,
        { method: "DELETE" },
      );
      const payload = (await response.json()) as AssetRecord & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to detach media");
      }
      setSelectedAsset(payload);
      setAssets((current) =>
        current.map((asset) => (asset.id === payload.id ? payload : asset)),
      );
    } catch (detachError) {
      setError(
        detachError instanceof Error
          ? detachError.message
          : "Unable to detach media",
      );
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!selectedAsset) return;
    setBusy(`delete-${selectedAsset.id}`);
    setError(null);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/assets/${selectedAsset.id}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error || "Delete failed");
      }
      setAssets((current) =>
        current.filter((asset) => asset.id !== selectedAsset.id),
      );
      setSelectedAssetId(null);
      setSelectedAsset(null);
      setConfirmDelete(false);
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
    ready: assets.filter((asset) => asset.status === "ready").length,
    processing: assets.filter((asset) =>
      ["uploaded", "processing"].includes(asset.status),
    ).length,
    failed: assets.filter((asset) => asset.status === "failed").length,
    used: assets.filter((asset) => (asset.usageCount || 0) > 0).length,
  };

  const canDeleteSelected =
    selectedAsset &&
    (selectedAsset.usageCount || 0) === 0 &&
    !["uploaded", "processing"].includes(selectedAsset.status);

  const metricCards = [
    { label: "Ready", value: counts.ready, Icon: ShieldCheck },
    { label: "Processing", value: counts.processing, Icon: RefreshCw },
    { label: "Failed", value: counts.failed, Icon: AlertCircle },
    { label: "In content", value: counts.used, Icon: Paperclip },
  ];

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

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metricCards.map(({ label, value, Icon }) => (
          <div key={label} className="sostats-card p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[9px] text-muted-foreground">{label}</p>
                <p className="mt-1 text-2xl font-semibold tracking-[-0.04em]">
                  {value}
                </p>
              </div>
              <div className="sostats-icon h-8 w-8">
                <Icon className="h-3.5 w-3.5 text-neutral-500" />
              </div>
            </div>
          </div>
        ))}
      </section>

      <section className="sostats-card p-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl bg-neutral-50 px-3">
            <Search className="h-3.5 w-3.5 text-neutral-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="min-w-0 flex-1 bg-transparent text-[10px] outline-none"
              placeholder="Search files, MIME type or attached content..."
            />
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:flex">
            <select
              value={typeFilter}
              onChange={(event) =>
                setTypeFilter(event.target.value as TypeFilter)
              }
              className="h-10 rounded-xl border border-black/[0.06] bg-white px-3 text-[9px] font-semibold text-neutral-600 outline-none"
            >
              <option value="all">All types</option>
              <option value="image">Images · {counts.image}</option>
              <option value="video">Video · {counts.video}</option>
            </select>

            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as StatusFilter)
              }
              className="h-10 rounded-xl border border-black/[0.06] bg-white px-3 text-[9px] font-semibold text-neutral-600 outline-none"
            >
              <option value="all">All states</option>
              <option value="ready">Ready · {counts.ready}</option>
              <option value="processing">
                Processing · {counts.processing}
              </option>
              <option value="failed">Failed · {counts.failed}</option>
              <option value="uploading">Uploading</option>
            </select>

            <select
              value={usageFilter}
              onChange={(event) =>
                setUsageFilter(event.target.value as UsageFilter)
              }
              className="h-10 rounded-xl border border-black/[0.06] bg-white px-3 text-[9px] font-semibold text-neutral-600 outline-none"
            >
              <option value="all">Any usage</option>
              <option value="used">In content · {counts.used}</option>
              <option value="unused">Unused</option>
            </select>

            <select
              value={brandFilter}
              onChange={(event) => setBrandFilter(event.target.value)}
              className="h-10 rounded-xl border border-black/[0.06] bg-white px-3 text-[9px] font-semibold text-neutral-600 outline-none"
            >
              <option value="all">All brands</option>
              {brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            {brands.length > 0 && (
              <select
                value={uploadBrandId}
                onChange={(event) => setUploadBrandId(event.target.value)}
                className="h-10 rounded-xl border border-black/[0.06] bg-neutral-50 px-3 text-[9px] font-semibold text-neutral-600 outline-none"
                aria-label="Upload brand"
              >
                <option value="">No brand</option>
                {brands.map((brand) => (
                  <option key={brand.id} value={brand.id}>
                    Upload to {brand.name}
                  </option>
                ))}
              </select>
            )}
            <Button
              onClick={() => inputRef.current?.click()}
              disabled={busy === "upload"}
              className="h-10 rounded-xl bg-[#ef2b2d] px-4 text-[9px] hover:bg-[#da2427]"
            >
              {busy === "upload" ? (
                <LoaderCircle className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="mr-2 h-3.5 w-3.5" />
              )}
              Upload media
            </Button>
          </div>
        </div>

        {uploadProgress !== null && (
          <div className="mt-3 border-t border-black/[0.045] pt-3">
            <div className="flex items-center justify-between text-[8px]">
              <span className="truncate font-medium text-neutral-600">
                Uploading {uploadFileName}
              </span>
              <span className="font-semibold">{uploadProgress}%</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-100">
              <div
                className="h-full rounded-full bg-[#ef2b2d] transition-[width]"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        )}
      </section>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[9px] leading-4 text-red-700">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="sostats-card self-start p-3">
          <p className="px-2 py-2 text-[10px] font-semibold">Asset library</p>
          {[
            {
              id: "all" as const,
              icon: Folder,
              label: "All assets",
              count: counts.all,
            },
            {
              id: "image" as const,
              icon: FileImage,
              label: "Images",
              count: counts.image,
            },
            {
              id: "video" as const,
              icon: Film,
              label: "Video",
              count: counts.video,
            },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTypeFilter(item.id)}
              className={
                typeFilter === item.id
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
            <div className="flex items-center gap-2">
              <HardDrive className="h-3.5 w-3.5 text-neutral-500" />
              <p className="text-[9px] font-semibold">Private storage</p>
            </div>
            <p className="mt-2 text-[8px] leading-4 text-muted-foreground">
              Browser uploads use a short-lived signed PUT. Ready previews use
              short-lived signed GET URLs; storage credentials never reach the
              browser.
            </p>
          </div>

          <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50 p-3">
            <p className="text-[8px] leading-4 text-amber-800">
              Content attachments are persisted now, but the current publisher
              runtime remains text-only. Media provider publishing will be wired
              only when its adapter contract is implemented.
            </p>
          </div>
        </aside>

        <main className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.length ? (
            visible.map((asset) => (
              <button
                key={asset.id}
                type="button"
                onClick={() => void openAsset(asset.id)}
                className="sostats-card overflow-hidden text-left transition hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(15,23,42,0.07)]"
              >
                <div className="relative aspect-[16/10] overflow-hidden bg-gradient-to-br from-neutral-100 via-white to-neutral-200">
                  {asset.status === "ready" &&
                    asset.viewUrl &&
                    asset.fileType === "image" && (
                      // Signed object URLs are ephemeral and intentionally bypass Next image optimization.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={asset.viewUrl}
                        alt={asset.fileName}
                        className="h-full w-full object-cover"
                      />
                    )}
                  {asset.status === "ready" &&
                    asset.viewUrl &&
                    asset.fileType === "video" && (
                      <video
                        src={asset.viewUrl}
                        muted
                        playsInline
                        preload="metadata"
                        className="h-full w-full object-cover"
                      />
                    )}

                  {asset.status !== "ready" && (
                    <div className="absolute inset-0 grid place-items-center">
                      <div className="text-center">
                        {asset.fileType === "video" ? (
                          <Film className="mx-auto h-6 w-6 text-neutral-300" />
                        ) : (
                          <ImageIcon className="mx-auto h-6 w-6 text-neutral-300" />
                        )}
                        {["uploaded", "processing"].includes(asset.status) && (
                          <LoaderCircle className="mx-auto mt-2 h-4 w-4 animate-spin text-[#ef2b2d]" />
                        )}
                      </div>
                    </div>
                  )}

                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/60 to-transparent p-3 pt-10">
                    <span className="rounded-lg border border-white/20 bg-black/25 px-2 py-1 text-[8px] font-semibold capitalize text-white backdrop-blur">
                      {asset.fileType}
                    </span>
                    <span
                      className={`rounded-lg px-2 py-1 text-[8px] font-semibold capitalize ${statusClass(asset.status)}`}
                    >
                      {asset.status}
                    </span>
                  </div>
                </div>

                <div className="p-3.5">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[10px] font-semibold">
                        {asset.fileName}
                      </p>
                      <p className="mt-0.5 text-[8px] text-muted-foreground">
                        {asset.mimeType} · {formatBytes(asset.size)}
                      </p>
                    </div>
                    {asset.status === "ready" && (
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                    )}
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-black/[0.045] pt-2.5">
                    <span className="text-[8px] text-muted-foreground">
                      {asset.width && asset.height
                        ? `${asset.width}×${asset.height}`
                        : "Metadata pending"}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[8px] font-medium text-muted-foreground">
                      <Paperclip className="h-2.5 w-2.5" />
                      {asset.usageCount || 0}
                    </span>
                  </div>
                </div>
              </button>
            ))
          ) : (
            <div className="sostats-card col-span-full p-10 text-center">
              <p className="text-sm font-semibold">No matching assets</p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Upload JPEG, PNG, WebP, GIF, or MP4 media or clear the current
                filters.
              </p>
            </div>
          )}
        </main>
      </div>

      <Dialog
        open={Boolean(selectedAssetId)}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setSelectedAssetId(null);
            setSelectedAsset(null);
            setConfirmDelete(false);
            setError(null);
          }
        }}
      >
        <DialogContent className="max-h-[92vh] overflow-y-auto rounded-2xl sm:max-w-4xl">
          {selectedAsset && (
            <>
              <DialogHeader>
                <DialogTitle className="tracking-[-0.02em]">
                  Asset details
                </DialogTitle>
              </DialogHeader>

              <div className="grid gap-5 py-2 lg:grid-cols-[minmax(0,1fr)_330px]">
                <div className="space-y-4">
                  <div className="relative grid min-h-[320px] place-items-center overflow-hidden rounded-2xl bg-neutral-950">
                    {selectedAsset.status === "ready" &&
                    selectedAsset.viewUrl &&
                    selectedAsset.fileType === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={selectedAsset.viewUrl}
                        alt={selectedAsset.fileName}
                        className="max-h-[560px] w-full object-contain"
                      />
                    ) : selectedAsset.status === "ready" &&
                      selectedAsset.viewUrl &&
                      selectedAsset.fileType === "video" ? (
                      <video
                        src={selectedAsset.viewUrl}
                        controls
                        playsInline
                        preload="metadata"
                        className="max-h-[560px] w-full object-contain"
                      />
                    ) : (
                      <div className="text-center text-white">
                        {detailLoading ||
                        ["uploaded", "processing"].includes(
                          selectedAsset.status,
                        ) ? (
                          <LoaderCircle className="mx-auto h-6 w-6 animate-spin text-red-300" />
                        ) : selectedAsset.status === "failed" ? (
                          <AlertCircle className="mx-auto h-6 w-6 text-red-300" />
                        ) : (
                          <Upload className="mx-auto h-6 w-6 text-white/40" />
                        )}
                        <p className="mt-3 text-[10px] font-semibold capitalize">
                          {selectedAsset.status}
                        </p>
                      </div>
                    )}
                  </div>

                  {selectedAsset.status === "failed" && (
                    <div className="rounded-xl border border-red-100 bg-red-50 p-4">
                      <p className="text-[9px] font-semibold text-red-800">
                        Processing failed
                      </p>
                      <p className="mt-1 text-[9px] leading-4 text-red-700">
                        {selectedAsset.processingError ||
                          "Media processing failed."}
                      </p>
                      <button
                        type="button"
                        onClick={() => void retry(selectedAsset.id)}
                        disabled={Boolean(busy)}
                        className="mt-3 inline-flex items-center gap-1.5 text-[9px] font-semibold text-red-800"
                      >
                        {busy === `retry-${selectedAsset.id}` ? (
                          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                        Retry processing
                      </button>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Meta label="Type" value={selectedAsset.fileType} />
                    <Meta
                      label="Size"
                      value={formatBytes(selectedAsset.size)}
                    />
                    <Meta
                      label="Dimensions"
                      value={
                        selectedAsset.width && selectedAsset.height
                          ? `${selectedAsset.width}×${selectedAsset.height}`
                          : "—"
                      }
                    />
                    <Meta
                      label="Duration"
                      value={
                        selectedAsset.fileType === "video"
                          ? formatDuration(selectedAsset.durationMs)
                          : "—"
                      }
                    />
                  </div>

                  <div className="rounded-xl border border-black/[0.055] p-4">
                    <p className="text-[10px] font-semibold">
                      Processing lifecycle
                    </p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <Meta
                        label="Uploaded"
                        value={formatDate(selectedAsset.uploadCompletedAt)}
                      />
                      <Meta
                        label="Processed"
                        value={formatDate(selectedAsset.processedAt)}
                      />
                      <Meta
                        label="Status"
                        value={selectedAsset.status}
                      />
                    </div>
                  </div>
                </div>

                <aside className="space-y-4">
                  <div className="rounded-2xl border border-black/[0.055] p-4">
                    <p className="truncate text-[11px] font-semibold">
                      {selectedAsset.fileName}
                    </p>
                    <p className="mt-1 text-[8px] text-muted-foreground">
                      {selectedAsset.mimeType}
                    </p>
                    <div className="mt-3 flex items-center gap-2">
                      <span
                        className={`rounded-lg px-2 py-1 text-[8px] font-semibold capitalize ${statusClass(selectedAsset.status)}`}
                      >
                        {selectedAsset.status}
                      </span>
                      <span className="text-[8px] text-muted-foreground">
                        {selectedAsset.usageCount || 0} attachment
                        {(selectedAsset.usageCount || 0) === 1 ? "" : "s"}
                      </span>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-black/[0.055] p-4">
                    <div className="flex items-center gap-2">
                      <Link2 className="h-3.5 w-3.5 text-[#ef2b2d]" />
                      <p className="text-[10px] font-semibold">
                        Attach to Content
                      </p>
                    </div>
                    <p className="mt-1 text-[8px] leading-4 text-muted-foreground">
                      Ready assets can be associated with canonical content or a
                      platform variant. Changing attachments after review resets
                      that content item to Draft.
                    </p>

                    {selectedAsset.status === "ready" ? (
                      <div className="mt-3 space-y-2">
                        <select
                          value={contentItemId}
                          onChange={(event) => {
                            setContentItemId(event.target.value);
                            setVariantId("");
                          }}
                          className="h-10 w-full rounded-xl border border-black/[0.06] bg-neutral-50 px-3 text-[9px] font-semibold outline-none"
                        >
                          <option value="">Choose draft/review content</option>
                          {contentItems.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.title} · {item.status}
                            </option>
                          ))}
                        </select>

                        {selectedContent && (
                          <select
                            value={variantId}
                            onChange={(event) =>
                              setVariantId(event.target.value)
                            }
                            className="h-10 w-full rounded-xl border border-black/[0.06] bg-neutral-50 px-3 text-[9px] font-semibold outline-none"
                          >
                            <option value="">Canonical content</option>
                            {selectedContent.variants.map((variant) => (
                              <option key={variant.id} value={variant.id}>
                                {providerLabel(variant.platform)} variant
                              </option>
                            ))}
                          </select>
                        )}

                        <Button
                          onClick={() => void attach()}
                          disabled={!contentItemId || Boolean(busy)}
                          className="h-9 w-full rounded-xl bg-neutral-950 text-[9px] hover:bg-neutral-800"
                        >
                          {busy === `attach-${selectedAsset.id}` ? (
                            <LoaderCircle className="mr-2 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Paperclip className="mr-2 h-3.5 w-3.5" />
                          )}
                          Attach media
                        </Button>
                      </div>
                    ) : (
                      <p className="mt-3 rounded-xl bg-neutral-50 p-3 text-[8px] leading-4 text-muted-foreground">
                        Media becomes attachable after verification and metadata
                        processing reach Ready.
                      </p>
                    )}
                  </div>

                  <div className="rounded-2xl border border-black/[0.055] p-4">
                    <p className="text-[10px] font-semibold">Used by content</p>
                    <div className="mt-3 space-y-2">
                      {selectedAsset.usages?.length ? (
                        selectedAsset.usages.map((usage) => {
                          const locked = ["scheduled", "published"].includes(
                            usage.contentStatus || "",
                          );
                          return (
                            <div
                              key={usage.id}
                              className="rounded-xl bg-neutral-50 p-3"
                            >
                              <div className="flex items-start gap-2">
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-[9px] font-semibold">
                                    {usage.contentTitle || "Content item"}
                                  </p>
                                  <p className="mt-0.5 text-[8px] text-muted-foreground">
                                    {usage.variantId
                                      ? `${providerLabel(usage.variantPlatform)} variant`
                                      : "Canonical content"}
                                    {usage.contentStatus
                                      ? ` · ${usage.contentStatus}`
                                      : ""}
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => void detach(usage.id)}
                                  disabled={Boolean(busy) || locked}
                                  className="sostats-icon h-7 w-7 disabled:opacity-35"
                                  aria-label="Detach media"
                                  title={
                                    locked
                                      ? "Scheduled/published content attachments are locked"
                                      : "Detach media"
                                  }
                                >
                                  {busy === `detach-${usage.id}` ? (
                                    <LoaderCircle className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <Unlink className="h-3 w-3 text-neutral-400" />
                                  )}
                                </button>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <p className="rounded-xl bg-neutral-50 p-3 text-[8px] leading-4 text-muted-foreground">
                          This asset is not attached to any content.
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-red-100 bg-red-50/50 p-4">
                    <p className="text-[9px] font-semibold text-red-800">
                      Safe deletion
                    </p>
                    <p className="mt-1 text-[8px] leading-4 text-red-700">
                      Assets in use cannot be deleted. Active processing is also
                      protected to avoid racing the worker.
                    </p>

                    {!canDeleteSelected && (
                      <p className="mt-2 text-[8px] font-medium text-red-700">
                        {(selectedAsset.usageCount || 0) > 0
                          ? "Detach this asset from Content before deletion."
                          : ["uploaded", "processing"].includes(
                                selectedAsset.status,
                              )
                            ? "Processing must finish or fail before deletion."
                            : "Deletion is currently unavailable."}
                      </p>
                    )}

                    {canDeleteSelected && (
                      <div className="mt-3">
                        {confirmDelete ? (
                          <div className="space-y-2">
                            <p className="text-[8px] font-semibold text-red-800">
                              Delete the private object and asset record?
                            </p>
                            <div className="flex gap-2">
                              <Button
                                variant="outline"
                                onClick={() => setConfirmDelete(false)}
                                className="h-8 flex-1 rounded-lg text-[8px]"
                              >
                                Keep asset
                              </Button>
                              <Button
                                onClick={() => void remove()}
                                disabled={Boolean(busy)}
                                className="h-8 flex-1 rounded-lg bg-red-600 text-[8px] hover:bg-red-700"
                              >
                                {busy === `delete-${selectedAsset.id}` ? (
                                  <LoaderCircle className="mr-1.5 h-3 w-3 animate-spin" />
                                ) : (
                                  <Trash2 className="mr-1.5 h-3 w-3" />
                                )}
                                Delete
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDelete(true)}
                            className="inline-flex items-center gap-1.5 text-[8px] font-semibold text-red-700"
                          >
                            <Trash2 className="h-3 w-3" />
                            Delete asset
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </aside>
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  className="rounded-xl"
                  onClick={() => {
                    setSelectedAssetId(null);
                    setSelectedAsset(null);
                  }}
                  disabled={Boolean(busy)}
                >
                  Close
                </Button>
                <Button
                  variant="outline"
                  className="rounded-xl"
                  onClick={() => void refreshAsset(selectedAsset.id)}
                  disabled={Boolean(busy)}
                >
                  <RefreshCw className="mr-2 h-3.5 w-3.5" />
                  Refresh signed preview
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-neutral-50 p-2.5">
      <p className="text-[7px] uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 truncate text-[9px] font-semibold capitalize">
        {value}
      </p>
    </div>
  );
}
