"use client";

import { useState } from "react";
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
import { AlertCircle, CalendarClock, LoaderCircle } from "lucide-react";
import {
  type ContentStatus,
  type ContentItem,
  initialContentItems,
} from "./data";
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

const columns: ContentStatus[] = [
  "Ideas",
  "Drafts",
  "Review",
  "Scheduled",
  "Published",
];

const apiStatus: Record<ContentStatus, string> = {
  Ideas: "draft",
  Drafts: "draft",
  Review: "in_review",
  Scheduled: "scheduled",
  Published: "published",
};

type ScheduleChannel = {
  id: number;
  provider: string;
  accountName?: string | null;
};

export function ContentBoard({
  workspaceSlug,
  initialItems,
  channels = [],
}: {
  workspaceSlug?: string;
  initialItems?: ContentItem[];
  channels?: ScheduleChannel[];
}) {
  const [items, setItems] = useState<ContentItem[]>(
    initialItems ?? initialContentItems,
  );
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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
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
        const next = [...current];
        next[activeIndex] = {
          ...next[activeIndex],
          status: next[overIndex].status,
        };
        return arrayMove(next, activeIndex, overIndex);
      }

      if (isOverColumn) {
        const next = [...current];
        next[activeIndex] = {
          ...next[activeIndex],
          status: over.id as ContentStatus,
        };
        return next;
      }

      return current;
    });
  };

  const persistStatus = async (
    itemId: string,
    nextStatus: ContentStatus,
  ): Promise<boolean> => {
    if (!workspaceSlug) return true;

    const response = await fetch(
      `/api/workspaces/${encodeURIComponent(workspaceSlug)}/content/${itemId}/status`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: apiStatus[nextStatus] }),
      },
    );
    return response.ok;
  };

  const revertStatus = (itemId: string, status: ContentStatus) => {
    setItems((current) =>
      current.map((item) =>
        item.id === itemId ? { ...item, status } : item,
      ),
    );
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const previousStatus = activeStartStatus;
    setActiveItem(null);
    setActiveStartStatus(null);

    if (!event.over || !previousStatus) return;

    setItems((current) => {
      const activeIndex = current.findIndex((item) => item.id === event.active.id);
      const overIndex = current.findIndex((item) => item.id === event.over?.id);
      const reordered =
        activeIndex >= 0 && overIndex >= 0
          ? arrayMove(current, activeIndex, overIndex)
          : current;
      const moved = reordered.find((item) => item.id === event.active.id);
      if (!moved || moved.status === previousStatus) return reordered;

      if (moved.status === "Published") {
        queueMicrotask(() => {
          revertStatus(moved.id, previousStatus);
          setWorkflowMessage(
            "Published is controlled by the publishing worker. Schedule approved content instead of manually marking it published.",
          );
        });
        return reordered;
      }

      if (moved.status === "Scheduled") {
        queueMicrotask(() => {
          revertStatus(moved.id, previousStatus);
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

      void persistStatus(moved.id, moved.status).then((ok) => {
        if (!ok) {
          revertStatus(moved.id, previousStatus);
          setWorkflowMessage(
            "The status change could not be saved. The card was moved back.",
          );
        }
      });

      return reordered;
    });
  };

  const confirmSchedule = async () => {
    if (!scheduleCandidate || !workspaceSlug) return;
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

    const normalize = (value?: string | null) =>
      (value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const variant =
      item.variantRefs?.find(
        (entry) => normalize(entry.platform) === normalize(channel.provider),
      ) || item.variantRefs?.[0];

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
            scheduledAt: new Date(scheduleAt).toISOString(),
          }),
        },
      );

      const schedulePayload = (await scheduleResponse.json()) as {
        error?: string;
      };
      if (!scheduleResponse.ok) {
        throw new Error(schedulePayload.error || "Unable to create schedule");
      }

      const statusSaved = await persistStatus(item.id, "Scheduled");
      if (!statusSaved) {
        throw new Error(
          "The schedule was created, but content status could not be updated.",
        );
      }

      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? {
                ...entry,
                status: "Scheduled",
                time: new Date(scheduleAt).toLocaleString(),
              }
            : entry,
        ),
      );
      setScheduleCandidate(null);
      setWorkflowMessage(
        `Scheduled on ${channel.accountName || channel.provider}. It will now appear in Calendar.`,
      );
    } catch (error) {
      setScheduleError(
        error instanceof Error ? error.message : "Unable to schedule content",
      );
    } finally {
      setIsScheduling(false);
    }
  };

  return (
    <>
      {workflowMessage && (
        <div className="mb-3 flex items-start gap-2 rounded-xl border border-black/[0.06] bg-white px-4 py-3 text-[9px] leading-4 text-muted-foreground">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#ef2b2d]" />
          {workflowMessage}
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex h-full min-h-[530px] gap-3 overflow-x-auto pb-2 xl:grid xl:grid-cols-5 xl:overflow-visible">
          {columns.map((status) => (
            <ContentColumn
              key={status}
              status={status}
              items={items.filter((item) => item.status === status)}
            />
          ))}
        </div>
        <DragOverlay>{activeItem ? <ContentCard item={activeItem} /> : null}</DragOverlay>
      </DndContext>

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
              Schedule approved content
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
                    {channel.accountName || channel.provider} · {channel.provider}
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
              Add to calendar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
