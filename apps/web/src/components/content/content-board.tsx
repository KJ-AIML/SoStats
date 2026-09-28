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

export function ContentBoard() {
  const [items, setItems] = useState<ContentItem[]>(initialContentItems);
  const [activeItem, setActiveItem] = useState<ContentItem | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveItem(items.find((item) => item.id === event.active.id) || null);
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

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveItem(null);
    if (!event.over || event.active.id === event.over.id) return;

    setItems((current) => {
      const activeIndex = current.findIndex((item) => item.id === event.active.id);
      const overIndex = current.findIndex((item) => item.id === event.over?.id);
      return activeIndex >= 0 && overIndex >= 0
        ? arrayMove(current, activeIndex, overIndex)
        : current;
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
