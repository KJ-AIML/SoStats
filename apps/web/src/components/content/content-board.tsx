"use client";

import { useMemo, useState } from "react";
import { addHours, format } from "date-fns";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates, arrayMove } from "@dnd-kit/sortable";
import {
  AlertCircle,
  CalendarClock,
  Check,
  CheckCircle2,
  FilterX,
  LayoutGrid,
  List,
  LoaderCircle,
  Plus,
  Search,
  Send,
} from "lucide-react";
import type { ContentItem, ContentStatus } from "./data";
import { ContentColumn } from "./content-column";
import { ContentCard } from "./content-card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const columns: ContentStatus[] = [
  "Ideas",
  "Drafts",
  "Review",
  "Scheduled",
  "Published",
];

const apiStatus: Record<ContentStatus, string> = {
  Ideas: "idea",
  Drafts: "draft",
  Review: "in_review",
  Scheduled: "scheduled",
  Published: "published",
};

type ScheduleChannel = {
  id: number;
  provider: string;
  accountName?: string | null;
  requiresMedia?: boolean;
  mediaMimeTypes?: string[];
  maxMediaItems?: number;
};

type BrandOption = {
  id: number;
  name: string;
};

type ViewMode = "board" | "list";

function normalizeProvider(value?: string | null) {
  const normalized = (value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalized === "twitter" ? "x" : normalized;
}

function providerLabel(value?: string | null) {
  if (!value) return "Generic";
  if (value.toLowerCase() === "x") return "X";
  if (value.toLowerCase() === "linkedin") return "LinkedIn";
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function boardStatus(rawStatus: string): ContentStatus {
  switch (rawStatus) {
    case "idea":
      return "Ideas";
    case "in_review":
    case "approved":
      return "Review";
    case "scheduled":
      return "Scheduled";
    case "published":
      return "Published";
    default:
      return "Drafts";
  }
}

function scheduleLabel(item: ContentItem) {
  const schedule = item.schedules
    .filter((entry) => entry.status === "scheduled")
    .sort(
      (a, b) =>
        new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
    )[0];

  if (!schedule) return item.time || "Updated recently";
  return new Date(schedule.scheduledAt).toLocaleString();
}

function toClientItem(payload: {
  id: number;
  brandId?: number | null;
  campaignId?: number | null;
  title: string;
  description?: string | null;
  status: string;
  updatedAt?: string;
  campaign?: { name?: string | null } | null;
  variants?: Array<{
    id: number;
    platform?: string | null;
    content: string;
    status: string;
  }>;
  scheduledPublications?: Array<{
    id: number;
    status: string;
    scheduledAt: string;
    socialAccount?: {
      provider?: string | null;
      accountName?: string | null;
    } | null;
  }>;
}): ContentItem {
  const variants = payload.variants || [];
  const schedules = payload.scheduledPublications || [];
  const item: ContentItem = {
    id: String(payload.id),
    title: payload.title,
    description: payload.description || undefined,
    status: boardStatus(payload.status),
    rawStatus: payload.status,
    brandId: payload.brandId,
    campaignId: payload.campaignId,
    campaign: payload.campaign?.name || "Unassigned",
    channel:
      variants
        .map((variant) => variant.platform)
        .filter(Boolean)
        .slice(0, 2)
        .map((provider) => providerLabel(provider))
        .join(" + ") || "Canonical",
    updatedAt: payload.updatedAt,
    time: payload.updatedAt
      ? new Date(payload.updatedAt).toLocaleString()
      : "Updated recently",
    variantRefs: variants,
    schedules: schedules.map((schedule) => ({
      id: schedule.id,
      status: schedule.status,
      scheduledAt: schedule.scheduledAt,
      provider: schedule.socialAccount?.provider,
      accountName: schedule.socialAccount?.accountName,
    })),
  };
  item.time = scheduleLabel(item);
  return item;
}

export function ContentBoard({
  workspaceSlug,
  initialItems,
  channels = [],
  brands = [],
}: {
  workspaceSlug: string;
  initialItems: ContentItem[];
  channels?: ScheduleChannel[];
  brands?: BrandOption[];
}) {
  const [items, setItems] = useState<ContentItem[]>(initialItems);
  const [activeItem, setActiveItem] = useState<ContentItem | null>(null);
  const [activeStartStatus, setActiveStartStatus] =
    useState<ContentStatus | null>(null);
  const [scheduleCandidate, setScheduleCandidate] = useState<{
    itemId: string;
    previousStatus: ContentStatus;
  } | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState(
    channels[0]?.id ? String(channels[0].id) : "",
  );
  const [scheduleAt, setScheduleAt] = useState(
    format(addHours(new Date(), 1), "yyyy-MM-dd'T'HH:mm"),
  );
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [isScheduling, setIsScheduling] = useState(false);
  const [workflowMessage, setWorkflowMessage] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [campaignFilter, setCampaignFilter] = useState("all");
  const [channelFilter, setChannelFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [viewMode, setViewMode] = useState<ViewMode>("board");

  const [createOpen, setCreateOpen] = useState(false);
  const [createStatus, setCreateStatus] = useState<ContentStatus>("Ideas");
  const [createTitle, setCreateTitle] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createBrandId, setCreateBrandId] = useState(
    brands[0]?.id ? String(brands[0].id) : "",
  );
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [detailItemId, setDetailItemId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [variantDrafts, setVariantDrafts] = useState<Record<number, string>>({});
  const [detailError, setDetailError] = useState<string | null>(null);
  const [isSavingDetail, setIsSavingDetail] = useState(false);
  const [isChangingStatus, setIsChangingStatus] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const detailItem = items.find((item) => item.id === detailItemId) || null;

  const campaignOptions = useMemo(
    () =>
      [...new Set(items.map((item) => item.campaign).filter(Boolean))].sort(),
    [items],
  );

  const channelOptions = useMemo(
    () =>
      [
        ...new Set(
          items.flatMap((item) =>
            item.variantRefs
              .map((variant) => variant.platform)
              .filter((value): value is string => Boolean(value)),
          ),
        ),
      ].sort(),
    [items],
  );

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return items.filter((item) => {
      if (statusFilter !== "all" && item.status !== statusFilter) return false;
      if (campaignFilter !== "all" && item.campaign !== campaignFilter) {
        return false;
      }
      if (
        channelFilter !== "all" &&
        !item.variantRefs.some(
          (variant) =>
            normalizeProvider(variant.platform) ===
            normalizeProvider(channelFilter),
        )
      ) {
        return false;
      }

      if (!normalizedQuery) return true;
      const haystack = [
        item.title,
        item.description,
        item.campaign,
        ...item.variantRefs.map((variant) => variant.platform || ""),
        ...item.variantRefs.map((variant) => variant.content),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedQuery);
    });
  }, [campaignFilter, channelFilter, items, query, statusFilter]);

  const counts = useMemo(
    () =>
      Object.fromEntries(
        columns.map((status) => [
          status,
          items.filter((item) => item.status === status).length,
        ]),
      ) as Record<ContentStatus, number>,
    [items],
  );

  const handleDragStart = (event: DragStartEvent) => {
    const item = items.find((entry) => entry.id === event.active.id) || null;
    setActiveItem(item);
    setActiveStartStatus(item?.status || null);
    setWorkflowMessage(null);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const isActiveItem = active.data.current?.type === "Item";
    const isOverItem = over.data.current?.type === "Item";
    const isOverColumn = over.data.current?.type === "Column";
    if (!isActiveItem) return;

    setItems((current) => {
      const activeIndex = current.findIndex((item) => item.id === active.id);
      if (activeIndex < 0) return current;

      if (isOverItem) {
        const overIndex = current.findIndex((item) => item.id === over.id);
        if (overIndex < 0) return current;
        const targetStatus = current[overIndex].status;
        if (targetStatus === "Published") return current;

        const next = [...current];
        next[activeIndex] = {
          ...next[activeIndex],
          status: targetStatus,
        };
        return arrayMove(next, activeIndex, overIndex);
      }

      if (isOverColumn) {
        const targetStatus = over.id as ContentStatus;
        if (targetStatus === "Published") return current;

        const next = [...current];
        next[activeIndex] = {
          ...next[activeIndex],
          status: targetStatus,
        };
        return next;
      }

      return current;
    });
  };

  const persistStatus = async (
    itemId: string,
    rawStatus: string,
  ): Promise<boolean> => {
    const response = await fetch(
      `/api/workspaces/${encodeURIComponent(workspaceSlug)}/content/${itemId}/status`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: rawStatus }),
      },
    );

    if (!response.ok) return false;

    setItems((current) =>
      current.map((item) =>
        item.id === itemId
          ? {
              ...item,
              rawStatus,
              status: boardStatus(rawStatus),
            }
          : item,
      ),
    );
    return true;
  };

  const revertStatus = (
    itemId: string,
    status: ContentStatus,
    rawStatus?: string,
  ) => {
    setItems((current) =>
      current.map((item) =>
        item.id === itemId
          ? {
              ...item,
              status,
              ...(rawStatus ? { rawStatus } : {}),
            }
          : item,
      ),
    );
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const previousStatus = activeStartStatus;
    const previousRawStatus = activeItem?.rawStatus;
    setActiveItem(null);
    setActiveStartStatus(null);

    if (!event.over || !previousStatus || !previousRawStatus) return;

    setItems((current) => {
      const activeIndex = current.findIndex((item) => item.id === event.active.id);
      const overIndex = current.findIndex((item) => item.id === event.over?.id);
      const reordered =
        activeIndex >= 0 && overIndex >= 0
          ? arrayMove(current, activeIndex, overIndex)
          : current;
      const moved = reordered.find((item) => item.id === event.active.id);
      if (!moved || moved.status === previousStatus) return reordered;

      if (["Scheduled", "Published"].includes(previousStatus)) {
        queueMicrotask(() => {
          revertStatus(moved.id, previousStatus, previousRawStatus);
          setWorkflowMessage(
            "Scheduled and published states are owned by the publishing lifecycle and cannot be moved manually.",
          );
        });
        return reordered;
      }

      if (moved.status === "Published") {
        queueMicrotask(() => {
          revertStatus(moved.id, previousStatus, previousRawStatus);
          setWorkflowMessage(
            "Published is controlled by the publishing worker. Schedule reviewed content instead.",
          );
        });
        return reordered;
      }

      if (moved.status === "Scheduled") {
        queueMicrotask(() => {
          revertStatus(moved.id, previousStatus, previousRawStatus);
          if (previousStatus !== "Review") {
            setWorkflowMessage(
              "Move content to Review before scheduling it. The API enforces this lifecycle rule.",
            );
            return;
          }

          setScheduleError(null);
          setSelectedChannelId(
            channels[0]?.id ? String(channels[0].id) : "",
          );
          setScheduleCandidate({
            itemId: moved.id,
            previousStatus,
          });
        });
        return reordered;
      }

      const nextRawStatus = apiStatus[moved.status];
      void persistStatus(moved.id, nextRawStatus).then((ok) => {
        if (!ok) {
          revertStatus(moved.id, previousStatus, previousRawStatus);
          setWorkflowMessage(
            "The status change could not be saved. The card was moved back.",
          );
        }
      });

      return reordered;
    });
  };

  const openCreate = (status: ContentStatus = "Ideas") => {
    setCreateStatus(status);
    setCreateTitle("");
    setCreateDescription("");
    setCreateBrandId(brands[0]?.id ? String(brands[0].id) : "");
    setCreateError(null);
    setCreateOpen(true);
  };

  const createContent = async () => {
    if (!createTitle.trim()) {
      setCreateError("Add a title before creating content.");
      return;
    }

    setIsCreating(true);
    setCreateError(null);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/content`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            brandId: createBrandId ? Number(createBrandId) : undefined,
            title: createTitle.trim(),
            description: createDescription.trim(),
            status: apiStatus[createStatus],
          }),
        },
      );
      const payload = (await response.json()) as Parameters<
        typeof toClientItem
      >[0] & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || "Unable to create content");
      }

      const item = toClientItem(payload);
      setItems((current) => [item, ...current]);
      setCreateOpen(false);
      setWorkflowMessage(
        `${item.title} was created as ${item.status.toLowerCase()} content.`,
      );
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : "Unable to create content",
      );
    } finally {
      setIsCreating(false);
    }
  };

  const openDetail = (item: ContentItem) => {
    setDetailItemId(item.id);
    setEditTitle(item.title);
    setEditDescription(item.description || "");
    setVariantDrafts(
      Object.fromEntries(
        item.variantRefs.map((variant) => [variant.id, variant.content]),
      ),
    );
    setDetailError(null);
  };

  const saveDetail = async () => {
    if (!detailItem) return;
    if (!editTitle.trim()) {
      setDetailError("Content title cannot be empty.");
      return;
    }

    setIsSavingDetail(true);
    setDetailError(null);

    try {
      const canonicalChanged =
        editTitle.trim() !== detailItem.title ||
        editDescription.trim() !== (detailItem.description || "");

      if (canonicalChanged) {
        const response = await fetch(
          `/api/workspaces/${encodeURIComponent(workspaceSlug)}/content/${detailItem.id}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              title: editTitle.trim(),
              description: editDescription.trim(),
            }),
          },
        );
        const payload = (await response.json()) as {
          error?: string;
          status?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error || "Unable to update content");
        }

        setItems((current) =>
          current.map((item) =>
            item.id === detailItem.id
              ? {
                  ...item,
                  title: editTitle.trim(),
                  description: editDescription.trim() || undefined,
                  ...(payload.status
                    ? {
                        rawStatus: payload.status,
                        status: boardStatus(payload.status),
                      }
                    : {}),
                }
              : item,
          ),
        );
      }

      for (const variant of detailItem.variantRefs) {
        const nextContent = variantDrafts[variant.id]?.trim();
        if (!nextContent || nextContent === variant.content) continue;

        const response = await fetch(
          `/api/workspaces/${encodeURIComponent(workspaceSlug)}/content/${detailItem.id}/variants/${variant.id}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ content: nextContent }),
          },
        );
        const payload = (await response.json()) as {
          error?: string;
          content?: string;
          status?: string;
        };
        if (!response.ok) {
          throw new Error(
            payload.error ||
              `Unable to update ${providerLabel(variant.platform)} variant`,
          );
        }

        setItems((current) =>
          current.map((item) =>
            item.id === detailItem.id
              ? {
                  ...item,
                  rawStatus: ["in_review", "approved"].includes(item.rawStatus)
                    ? "draft"
                    : item.rawStatus,
                  status: ["in_review", "approved"].includes(item.rawStatus)
                    ? "Drafts"
                    : item.status,
                  variantRefs: item.variantRefs.map((entry) =>
                    entry.id === variant.id
                      ? {
                          ...entry,
                          content: payload.content || nextContent,
                          status: payload.status || "draft",
                        }
                      : entry,
                  ),
                }
              : item,
          ),
        );
      }

      setWorkflowMessage(
        ["in_review", "approved"].includes(detailItem.rawStatus)
          ? "Content changes saved. Review was reset to Draft because the copy changed."
          : "Content changes saved.",
      );
      setDetailItemId(null);
    } catch (error) {
      setDetailError(
        error instanceof Error ? error.message : "Unable to save content",
      );
    } finally {
      setIsSavingDetail(false);
    }
  };

  const changeDetailStatus = async (rawStatus: string) => {
    if (!detailItem) return;
    setIsChangingStatus(true);
    setDetailError(null);

    try {
      const ok = await persistStatus(detailItem.id, rawStatus);
      if (!ok) throw new Error("Unable to update content status");

      setWorkflowMessage(
        rawStatus === "approved"
          ? "Content approved and ready to schedule."
          : rawStatus === "in_review"
            ? "Content moved to review."
            : rawStatus === "draft"
              ? "Content returned to drafts."
              : "Content status updated.",
      );

      if (rawStatus !== "approved" && rawStatus !== "in_review") {
        setDetailItemId(null);
      }
    } catch (error) {
      setDetailError(
        error instanceof Error ? error.message : "Unable to update content status",
      );
    } finally {
      setIsChangingStatus(false);
    }
  };

  const openScheduleForItem = (item: ContentItem) => {
    if (item.status !== "Review") {
      setWorkflowMessage("Only reviewed content can be scheduled.");
      return;
    }

    setDetailItemId(null);
    setScheduleError(null);
    setSelectedChannelId(channels[0]?.id ? String(channels[0].id) : "");
    setScheduleCandidate({
      itemId: item.id,
      previousStatus: item.status,
    });
  };

  const confirmSchedule = async () => {
    if (!scheduleCandidate) return;
    const item = items.find((entry) => entry.id === scheduleCandidate.itemId);
    const channel = channels.find(
      (entry) => entry.id === Number(selectedChannelId),
    );

    if (!item || !channel) {
      setScheduleError(
        channels.length
          ? "Choose a publishing channel."
          : "Connect a publishing channel before scheduling content.",
      );
      return;
    }

    const scheduledDate = new Date(scheduleAt);
    if (Number.isNaN(scheduledDate.getTime())) {
      setScheduleError("Choose a valid publishing date and time.");
      return;
    }

    const variant = item.variantRefs.find(
      (entry) =>
        normalizeProvider(entry.platform) === normalizeProvider(channel.provider),
    );

    setIsScheduling(true);
    setScheduleError(null);

    try {
      const scheduleResponse = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/schedules`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            contentItemId: Number(item.id),
            variantId: variant?.id,
            socialAccountId: channel.id,
            scheduledAt: scheduledDate.toISOString(),
          }),
        },
      );

      const schedulePayload = (await scheduleResponse.json()) as {
        id?: number;
        status?: string;
        scheduledAt?: string;
        error?: string;
      };
      if (!scheduleResponse.ok || !schedulePayload.id) {
        throw new Error(schedulePayload.error || "Unable to create schedule");
      }

      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? {
                ...entry,
                status: "Scheduled",
                rawStatus: "scheduled",
                time: scheduledDate.toLocaleString(),
                schedules: [
                  ...entry.schedules,
                  {
                    id: schedulePayload.id as number,
                    status: schedulePayload.status || "scheduled",
                    scheduledAt:
                      schedulePayload.scheduledAt || scheduledDate.toISOString(),
                    provider: channel.provider,
                    accountName: channel.accountName,
                  },
                ],
              }
            : entry,
        ),
      );
      setScheduleCandidate(null);
      setWorkflowMessage(
        `Scheduled on ${channel.accountName || providerLabel(channel.provider)}. The publishing worker owns the next state transition.`,
      );
    } catch (error) {
      setScheduleError(
        error instanceof Error ? error.message : "Unable to schedule content",
      );
    } finally {
      setIsScheduling(false);
    }
  };

  const clearFilters = () => {
    setQuery("");
    setCampaignFilter("all");
    setChannelFilter("all");
    setStatusFilter("all");
  };

  const hasFilters =
    Boolean(query.trim()) ||
    campaignFilter !== "all" ||
    channelFilter !== "all" ||
    statusFilter !== "all";

  const detailLocked =
    detailItem && ["scheduled", "published"].includes(detailItem.rawStatus);

  return (
    <div id="content-workspace" className="space-y-3">
      <section className="sostats-card p-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-xl bg-neutral-50 px-3">
            <Search className="h-3.5 w-3.5 text-neutral-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="min-w-0 flex-1 bg-transparent text-[10px] outline-none placeholder:text-neutral-400"
              placeholder="Search titles, copy, campaigns or channels..."
            />
          </div>

          <div className="grid gap-2 sm:grid-cols-3 xl:flex">
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="h-9 rounded-xl border border-black/[0.06] bg-white px-3 text-[9px] font-semibold text-neutral-600 outline-none"
            >
              <option value="all">All stages</option>
              {columns.map((status) => (
                <option key={status} value={status}>
                  {status} · {counts[status]}
                </option>
              ))}
            </select>

            <select
              value={campaignFilter}
              onChange={(event) => setCampaignFilter(event.target.value)}
              className="h-9 rounded-xl border border-black/[0.06] bg-white px-3 text-[9px] font-semibold text-neutral-600 outline-none"
            >
              <option value="all">All campaigns</option>
              {campaignOptions.map((campaign) => (
                <option key={campaign} value={campaign}>
                  {campaign}
                </option>
              ))}
            </select>

            <select
              value={channelFilter}
              onChange={(event) => setChannelFilter(event.target.value)}
              className="h-9 rounded-xl border border-black/[0.06] bg-white px-3 text-[9px] font-semibold text-neutral-600 outline-none"
            >
              <option value="all">All channels</option>
              {channelOptions.map((channel) => (
                <option key={channel} value={channel}>
                  {providerLabel(channel)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            {hasFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-black/[0.06] bg-white px-3 text-[9px] font-semibold text-neutral-500"
              >
                <FilterX className="h-3.5 w-3.5" />
                Clear
              </button>
            )}

            <div className="flex h-9 items-center rounded-xl border border-black/[0.06] bg-neutral-50 p-1">
              <button
                type="button"
                onClick={() => setViewMode("board")}
                className={
                  viewMode === "board"
                    ? "flex h-7 w-8 items-center justify-center rounded-lg bg-white shadow-sm"
                    : "flex h-7 w-8 items-center justify-center rounded-lg text-neutral-400"
                }
                aria-label="Board view"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode("list")}
                className={
                  viewMode === "list"
                    ? "flex h-7 w-8 items-center justify-center rounded-lg bg-white shadow-sm"
                    : "flex h-7 w-8 items-center justify-center rounded-lg text-neutral-400"
                }
                aria-label="List view"
              >
                <List className="h-3.5 w-3.5" />
              </button>
            </div>

            <Button
              onClick={() => openCreate("Ideas")}
              className="h-9 rounded-xl bg-[#ef2b2d] px-3 text-[9px] hover:bg-[#da2427]"
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              New content
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-black/[0.045] pt-3">
          {columns.map((status) => (
            <span
              key={status}
              className="rounded-full bg-neutral-50 px-2.5 py-1 text-[8px] font-medium text-neutral-500"
            >
              {status} {counts[status]}
            </span>
          ))}
          <span className="ml-auto text-[8px] text-muted-foreground">
            Showing {filteredItems.length} of {items.length}
          </span>
        </div>
      </section>

      {workflowMessage && (
        <div className="flex items-start gap-2 rounded-xl border border-black/[0.06] bg-white px-4 py-3 text-[9px] leading-4 text-muted-foreground">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#ef2b2d]" />
          {workflowMessage}
        </div>
      )}

      {viewMode === "board" ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <div className="flex min-h-[530px] gap-3 overflow-x-auto pb-2 xl:grid xl:grid-cols-5 xl:overflow-visible">
            {columns.map((status) => (
              <ContentColumn
                key={status}
                status={status}
                items={filteredItems.filter((item) => item.status === status)}
                onOpen={openDetail}
                onAdd={openCreate}
              />
            ))}
          </div>
          <DragOverlay>
            {activeItem ? <ContentCard item={activeItem} /> : null}
          </DragOverlay>
        </DndContext>
      ) : (
        <section className="sostats-card overflow-hidden">
          <div className="overflow-x-auto">
            <div className="min-w-[860px]">
              <div className="grid grid-cols-[110px_minmax(280px,1fr)_180px_170px_130px] border-b border-black/[0.05] bg-neutral-50 px-4 py-2.5 text-[8px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                <span>Stage</span>
                <span>Content</span>
                <span>Campaign</span>
                <span>Channels</span>
                <span>Updated</span>
              </div>
              {filteredItems.length ? (
                filteredItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => openDetail(item)}
                    className="grid w-full grid-cols-[110px_minmax(280px,1fr)_180px_170px_130px] items-center border-b border-black/[0.045] px-4 py-3 text-left transition last:border-b-0 hover:bg-neutral-50"
                  >
                    <span className="text-[9px] font-semibold">{item.status}</span>
                    <span className="min-w-0 pr-5">
                      <span className="block truncate text-[10px] font-semibold">
                        {item.title}
                      </span>
                      <span className="mt-0.5 block truncate text-[8px] text-muted-foreground">
                        {item.description || "No description"}
                      </span>
                    </span>
                    <span className="truncate pr-4 text-[9px] text-muted-foreground">
                      {item.campaign || "Unassigned"}
                    </span>
                    <span className="truncate pr-4 text-[9px] text-muted-foreground">
                      {item.variantRefs.length
                        ? item.variantRefs
                            .map((variant) => providerLabel(variant.platform))
                            .join(", ")
                        : "Canonical"}
                    </span>
                    <span className="text-[8px] text-muted-foreground">
                      {item.time}
                    </span>
                  </button>
                ))
              ) : (
                <p className="px-5 py-10 text-center text-[10px] text-muted-foreground">
                  No content matches the current filters.
                </p>
              )}
            </div>
          </div>
        </section>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle className="tracking-[-0.02em]">
              Create {createStatus === "Ideas" ? "content idea" : "draft"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <label className="block">
              <span className="mb-1.5 block text-[9px] font-semibold">Title</span>
              <Input
                value={createTitle}
                onChange={(event) => setCreateTitle(event.target.value)}
                maxLength={255}
                className="rounded-xl"
                placeholder="What should this content become?"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[9px] font-semibold">
                Canonical description / copy
              </span>
              <Textarea
                value={createDescription}
                onChange={(event) => setCreateDescription(event.target.value)}
                className="min-h-28 rounded-xl"
                placeholder="Add the core message. Platform variants can be generated later in AI Studio."
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1.5 block text-[9px] font-semibold">Stage</span>
                <select
                  value={createStatus}
                  onChange={(event) =>
                    setCreateStatus(event.target.value as ContentStatus)
                  }
                  className="h-10 w-full rounded-xl border border-black/[0.07] bg-neutral-50 px-3 text-[10px] outline-none"
                >
                  <option value="Ideas">Idea</option>
                  <option value="Drafts">Draft</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-1.5 block text-[9px] font-semibold">
                  Brand Brain
                </span>
                <select
                  value={createBrandId}
                  onChange={(event) => setCreateBrandId(event.target.value)}
                  className="h-10 w-full rounded-xl border border-black/[0.07] bg-neutral-50 px-3 text-[10px] outline-none"
                >
                  <option value="">No brand</option>
                  {brands.map((brand) => (
                    <option key={brand.id} value={brand.id}>
                      {brand.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {createError && (
              <p className="rounded-xl bg-red-50 p-3 text-[9px] leading-4 text-red-700">
                {createError}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={() => setCreateOpen(false)}
              disabled={isCreating}
            >
              Cancel
            </Button>
            <Button
              className="rounded-xl bg-[#ef2b2d] hover:bg-[#da2427]"
              onClick={createContent}
              disabled={isCreating || !createTitle.trim()}
            >
              {isCreating && (
                <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
              )}
              Create content
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(detailItem)}
        onOpenChange={(open) => {
          if (!open && !isSavingDetail && !isChangingStatus) {
            setDetailItemId(null);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-3xl">
          {detailItem && (
            <>
              <DialogHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <DialogTitle className="tracking-[-0.02em]">
                    Content review
                  </DialogTitle>
                  <span className="rounded-md bg-neutral-100 px-2 py-1 text-[8px] font-semibold text-neutral-600">
                    {detailItem.rawStatus === "approved"
                      ? "Approved"
                      : detailItem.status}
                  </span>
                </div>
              </DialogHeader>

              <div className="space-y-5 py-2">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-black/[0.05] bg-neutral-50 p-3">
                    <p className="text-[8px] uppercase tracking-[0.08em] text-muted-foreground">
                      Campaign
                    </p>
                    <p className="mt-1 truncate text-[9px] font-semibold">
                      {detailItem.campaign || "Unassigned"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-black/[0.05] bg-neutral-50 p-3">
                    <p className="text-[8px] uppercase tracking-[0.08em] text-muted-foreground">
                      Variants
                    </p>
                    <p className="mt-1 text-[9px] font-semibold">
                      {detailItem.variantRefs.length} persisted
                    </p>
                  </div>
                </div>

                <label className="block">
                  <span className="mb-1.5 block text-[9px] font-semibold">Title</span>
                  <Input
                    value={editTitle}
                    onChange={(event) => setEditTitle(event.target.value)}
                    className="rounded-xl"
                    disabled={Boolean(detailLocked)}
                  />
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-[9px] font-semibold">
                    Canonical description / fallback copy
                  </span>
                  <Textarea
                    value={editDescription}
                    onChange={(event) => setEditDescription(event.target.value)}
                    className="min-h-28 rounded-xl"
                    disabled={Boolean(detailLocked)}
                  />
                </label>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-semibold">Channel variants</p>
                      <p className="mt-0.5 text-[8px] text-muted-foreground">
                        Saving an edit creates a previous-copy entry in content_versions.
                      </p>
                    </div>
                  </div>

                  {detailItem.variantRefs.length ? (
                    <div className="space-y-3">
                      {detailItem.variantRefs.map((variant) => (
                        <label
                          key={variant.id}
                          className="block rounded-xl border border-black/[0.055] p-3"
                        >
                          <div className="mb-2 flex items-center justify-between">
                            <span className="text-[9px] font-semibold">
                              {providerLabel(variant.platform)}
                            </span>
                            <span className="text-[8px] capitalize text-muted-foreground">
                              {variant.status}
                            </span>
                          </div>
                          <Textarea
                            value={variantDrafts[variant.id] ?? variant.content}
                            onChange={(event) =>
                              setVariantDrafts((current) => ({
                                ...current,
                                [variant.id]: event.target.value,
                              }))
                            }
                            className="min-h-32 rounded-xl bg-neutral-50 text-[9px] leading-4"
                            disabled={Boolean(detailLocked)}
                          />
                        </label>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-black/[0.08] bg-neutral-50 p-4 text-[9px] leading-4 text-muted-foreground">
                      No platform variants yet. Canonical description is used as the publishing fallback.
                      Use AI Studio for model-backed multi-channel generation.
                    </div>
                  )}
                </div>

                {detailItem.schedules.length > 0 && (
                  <div className="rounded-xl border border-black/[0.055] bg-neutral-50 p-4">
                    <p className="text-[10px] font-semibold">Publication lifecycle</p>
                    <div className="mt-3 space-y-2">
                      {detailItem.schedules.map((schedule) => (
                        <div
                          key={schedule.id}
                          className="flex items-center gap-3 rounded-lg bg-white px-3 py-2"
                        >
                          <CalendarClock className="h-3.5 w-3.5 text-neutral-400" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[9px] font-semibold">
                              {schedule.accountName ||
                                providerLabel(schedule.provider)}
                            </p>
                            <p className="mt-0.5 text-[8px] text-muted-foreground">
                              {new Date(schedule.scheduledAt).toLocaleString()}
                            </p>
                          </div>
                          <span className="text-[8px] font-semibold capitalize text-neutral-500">
                            {schedule.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {detailError && (
                  <p className="rounded-xl bg-red-50 p-3 text-[9px] leading-4 text-red-700">
                    {detailError}
                  </p>
                )}

                {!detailLocked && (
                  <div className="flex flex-wrap gap-2 rounded-xl border border-black/[0.055] bg-neutral-50 p-3">
                    {detailItem.rawStatus === "idea" && (
                      <Button
                        variant="outline"
                        className="h-9 rounded-xl text-[9px]"
                        onClick={() => void changeDetailStatus("draft")}
                        disabled={isChangingStatus}
                      >
                        Move to Draft
                      </Button>
                    )}

                    {detailItem.rawStatus === "draft" && (
                      <Button
                        className="h-9 rounded-xl bg-neutral-950 text-[9px] hover:bg-neutral-800"
                        onClick={() => void changeDetailStatus("in_review")}
                        disabled={isChangingStatus}
                      >
                        <Send className="mr-1.5 h-3.5 w-3.5" />
                        Send to Review
                      </Button>
                    )}

                    {detailItem.rawStatus === "in_review" && (
                      <>
                        <Button
                          variant="outline"
                          className="h-9 rounded-xl text-[9px]"
                          onClick={() => void changeDetailStatus("draft")}
                          disabled={isChangingStatus}
                        >
                          Back to Draft
                        </Button>
                        <Button
                          className="h-9 rounded-xl bg-emerald-600 text-[9px] hover:bg-emerald-700"
                          onClick={() => void changeDetailStatus("approved")}
                          disabled={isChangingStatus}
                        >
                          <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                          Approve
                        </Button>
                      </>
                    )}

                    {detailItem.rawStatus === "approved" && (
                      <>
                        <span className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-emerald-50 px-3 text-[9px] font-semibold text-emerald-700">
                          <Check className="h-3.5 w-3.5" />
                          Approved
                        </span>
                        <Button
                          className="h-9 rounded-xl bg-[#ef2b2d] text-[9px] hover:bg-[#da2427]"
                          onClick={() => openScheduleForItem(detailItem)}
                        >
                          <CalendarClock className="mr-1.5 h-3.5 w-3.5" />
                          Schedule
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setDetailItemId(null)}
                  className="rounded-xl"
                  disabled={isSavingDetail || isChangingStatus}
                >
                  Close
                </Button>
                {!detailLocked && (
                  <Button
                    onClick={saveDetail}
                    disabled={
                      isSavingDetail ||
                      isChangingStatus ||
                      !editTitle.trim()
                    }
                    className="rounded-xl bg-neutral-950 hover:bg-neutral-800"
                  >
                    {isSavingDetail && (
                      <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Save edits
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(scheduleCandidate)}
        onOpenChange={(open) => {
          if (!open && !isScheduling) setScheduleCandidate(null);
        }}
      >
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 tracking-[-0.02em]">
              <CalendarClock className="h-4 w-4 text-[#ef2b2d]" />
              Schedule reviewed content
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <label className="mb-1.5 block text-[9px] font-semibold">
                Publishing channel
              </label>
              <select
                value={selectedChannelId}
                onChange={(event) => setSelectedChannelId(event.target.value)}
                className="h-10 w-full rounded-xl border border-black/[0.07] bg-neutral-50 px-3 text-[10px] outline-none"
              >
                {channels.length === 0 && (
                  <option value="">No connected channels</option>
                )}
                {channels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channel.accountName || providerLabel(channel.provider)} ·{" "}
                    {providerLabel(channel.provider)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-[9px] font-semibold">
                Publish at
              </label>
              <Input
                type="datetime-local"
                value={scheduleAt}
                onChange={(event) => setScheduleAt(event.target.value)}
                className="rounded-xl"
              />
            </div>

            {selectedChannelRequirement(channels, selectedChannelId) && (
              <p className="rounded-xl bg-blue-50 p-3 text-[9px] leading-4 text-blue-800">
                {selectedChannelRequirement(channels, selectedChannelId)}
              </p>
            )}

            {!itemHasCompatibleVariant(
              items,
              scheduleCandidate?.itemId,
              channelProvider(channels, selectedChannelId),
            ) &&
              scheduleCandidate &&
              selectedChannelId && (
                <p className="rounded-xl bg-amber-50 p-3 text-[9px] leading-4 text-amber-800">
                  No platform-specific variant exists for this channel. SoStats will publish
                  the canonical description/title fallback.
                </p>
              )}

            {scheduleError && (
              <p className="rounded-xl bg-red-50 p-3 text-[9px] leading-4 text-red-700">
                {scheduleError}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={() => setScheduleCandidate(null)}
              disabled={isScheduling}
            >
              Cancel
            </Button>
            <Button
              className="rounded-xl bg-[#ef2b2d] hover:bg-[#da2427]"
              onClick={confirmSchedule}
              disabled={isScheduling || !selectedChannelId}
            >
              {isScheduling && (
                <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
              )}
              Add to publishing queue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function channelProvider(
  channels: ScheduleChannel[],
  selectedChannelId: string,
) {
  return channels.find((entry) => entry.id === Number(selectedChannelId))
    ?.provider;
}

function selectedChannelRequirement(
  channels: ScheduleChannel[],
  selectedChannelId: string,
) {
  const channel = channels.find(
    (entry) => entry.id === Number(selectedChannelId),
  );
  if (!channel?.requiresMedia) return null;

  const types = channel.mediaMimeTypes?.join(", ");
  const max = channel.maxMediaItems
    ? ` Up to ${channel.maxMediaItems} attachment(s).`
    : "";

  return `${providerLabel(channel.provider)} requires ready media attached from the Media workspace before scheduling.${types ? ` Accepted: ${types}.` : ""}${max}`;
}

function itemHasCompatibleVariant(
  items: ContentItem[],
  itemId?: string,
  provider?: string,
) {
  if (!itemId || !provider) return true;
  const item = items.find((entry) => entry.id === itemId);
  if (!item?.variantRefs.length) return false;
  return item.variantRefs.some(
    (entry) =>
      normalizeProvider(entry.platform) === normalizeProvider(provider),
  );
}
