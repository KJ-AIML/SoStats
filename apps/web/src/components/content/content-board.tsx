"use client";

import React, { useState } from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates, arrayMove } from "@dnd-kit/sortable";
import { ContentStatus, ContentItem, initialContentItems } from "./data";
import { ContentColumn } from "./content-column";
import { ContentCard } from "./content-card";

const columns: ContentStatus[] = ["Ideas", "Drafts", "Review", "Scheduled", "Published"];

export function ContentBoard() {
  const [items, setItems] = useState<ContentItem[]>(initialContentItems);
  const [activeItem, setActiveItem] = useState<ContentItem | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const item = items.find((i) => i.id === active.id);
    if (item) {
      setActiveItem(item);
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id;
    const overId = over.id;

    if (activeId === overId) return;

    const isActiveTask = active.data.current?.type === "Item";
    const isOverTask = over.data.current?.type === "Item";
    const isOverColumn = over.data.current?.type === "Column";

    if (!isActiveTask) return;

    // Dropping a Task over another Task
    if (isActiveTask && isOverTask) {
      setItems((prev) => {
        const activeIndex = prev.findIndex((t) => t.id === activeId);
        const overIndex = prev.findIndex((t) => t.id === overId);

        if (prev[activeIndex].status !== prev[overIndex].status) {
          const newItems = [...prev];
          newItems[activeIndex] = {
            ...newItems[activeIndex],
            status: prev[overIndex].status,
          };
          return arrayMove(newItems, activeIndex, overIndex);
        }

        return arrayMove(prev, activeIndex, overIndex);
      });
    }

    // Dropping a Task over a Column
    if (isActiveTask && isOverColumn) {
      setItems((prev) => {
        const activeIndex = prev.findIndex((t) => t.id === activeId);
        const newStatus = overId as ContentStatus;

        if (prev[activeIndex].status !== newStatus) {
          const newItems = [...prev];
          newItems[activeIndex] = {
            ...newItems[activeIndex],
            status: newStatus,
          };
          return arrayMove(newItems, activeIndex, activeIndex); // maintain relative index for now
        }
        return prev;
      });
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveItem(null);
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id;
    const overId = over.id;

    if (activeId === overId) return;

    setItems((prev) => {
      const activeIndex = prev.findIndex((t) => t.id === activeId);
      const overIndex = prev.findIndex((t) => t.id === overId);

      if (activeIndex !== -1 && overIndex !== -1) {
        return arrayMove(prev, activeIndex, overIndex);
      }
      return prev;
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
      <div className="flex flex-row gap-6 overflow-x-auto pb-4 h-full">
        {columns.map((status) => (
          <ContentColumn
            key={status}
            status={status}
            items={items.filter((item) => item.status === status)}
          />
        ))}
      </div>

      <DragOverlay>
        {activeItem ? <ContentCard item={activeItem} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
