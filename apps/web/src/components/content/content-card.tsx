"use client";

import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ContentItem } from "./data";
import { cn } from "cn";

interface ContentCardProps {
  item: ContentItem;
}

export function ContentCard({ item }: ContentCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, data: { type: "Item", item } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-50"
      )}
    >
      <Card className="hover:ring-2 hover:ring-primary/50 transition-shadow">
        <CardHeader>
          <CardTitle className="text-sm">{item.title}</CardTitle>
          {item.description && (
            <CardDescription className="text-xs line-clamp-2">
              {item.description}
            </CardDescription>
          )}
        </CardHeader>
      </Card>
    </div>
  );
}
