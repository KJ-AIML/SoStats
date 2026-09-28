"use client";

import React from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ContentStatus, ContentItem } from "./data";
import { ContentCard } from "./content-card";
import { cn } from "cn";

interface ContentColumnProps {
  status: ContentStatus;
  items: ContentItem[];
}

export function ContentColumn({ status, items }: ContentColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: status,
    data: {
      type: "Column",
      status,
    },
  });

  return (
    <div className="flex flex-col flex-1 min-w-[250px] bg-muted/30 rounded-xl p-4 gap-4">
      <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">
        {status} ({items.length})
      </h3>
      
      <div
        ref={setNodeRef}
        className={cn(
          "flex flex-col gap-3 flex-1 transition-colors min-h-[200px] rounded-lg p-1",
          isOver && "bg-muted/50"
        )}
      >
        <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          {items.map((item) => (
            <ContentCard key={item.id} item={item} />
          ))}
        </SortableContext>
      </div>
    </div>
  );
}
