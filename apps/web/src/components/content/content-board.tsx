"use client";

import { useState } from "react";
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
  type ContentStatus,
  type ContentItem,
  initialContentItems,
} from "./data";
import { ContentColumn } from "./content-column";
import { ContentCard } from "./content-card";

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

export function ContentBoard({
  workspaceSlug,
  initialItems,
}: {
  workspaceSlug?: string;
  initialItems?: ContentItem[];
}) {
  const [items, setItems] = useState<ContentItem[]>(
    initialItems ?? initialContentItems,
  );
  const [activeItem, setActiveItem] = useState<ContentItem | null>(null);
  const [activeStartStatus, setActiveStartStatus] =
    useState<ContentStatus | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    const item = items.find((entry) => entry.id === event.active.id) || null;
    setActiveItem(item);
    setActiveStartStatus(item?.status || null);
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
    previousStatus: ContentStatus,
  ) => {
    if (!workspaceSlug || nextStatus === previousStatus) return;

    const response = await fetch(
      `/api/workspaces/${encodeURIComponent(workspaceSlug)}/content/${itemId}/status`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: apiStatus[nextStatus] }),
      },
    );

    if (!response.ok) {
      setItems((current) =>
        current.map((item) =>
          item.id === itemId ? { ...item, status: previousStatus } : item,
        ),
      );
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const previousStatus = activeStartStatus;
    setActiveItem(null);
    setActiveStartStatus(null);

    if (!event.over) return;

    setItems((current) => {
      const activeIndex = current.findIndex((item) => item.id === event.active.id);
      const overIndex = current.findIndex((item) => item.id === event.over?.id);
      const reordered =
        activeIndex >= 0 && overIndex >= 0
          ? arrayMove(current, activeIndex, overIndex)
          : current;

      const moved = reordered.find((item) => item.id === event.active.id);
      if (moved && previousStatus) {
        void persistStatus(String(moved.id), moved.status, previousStatus);
      }
      return reordered;
    });
  };

  return (
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
  );
}
