"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Clock3, GripVertical } from "lucide-react";
import type { ContentItem } from "./data";
import { cn } from "@/lib/utils";

export function ContentCard({ item }: { item: ContentItem }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, data: { type: "Item", item } });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      {...attributes}
      {...listeners}
      className={cn(
        "group cursor-grab rounded-xl border border-black/[0.06] bg-white p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.02)] transition hover:-translate-y-0.5 hover:border-black/10 hover:shadow-[0_10px_24px_rgba(15,23,42,0.06)] active:cursor-grabbing",
        isDragging && "opacity-45",
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <span className="rounded-md bg-neutral-100 px-2 py-1 text-[8px] font-semibold text-neutral-600">
              {item.channel || "Content"}
            </span>
            <span className="truncate text-[8px] text-muted-foreground">
              {item.campaign}
            </span>
          </div>
          <h3 className="text-[11px] font-semibold leading-4 text-neutral-900">
            {item.title}
          </h3>
          {item.description && (
            <p className="mt-1.5 line-clamp-2 text-[9px] leading-4 text-muted-foreground">
              {item.description}
            </p>
          )}
        </div>
        <GripVertical className="h-3.5 w-3.5 shrink-0 text-neutral-300 opacity-0 transition group-hover:opacity-100" />
      </div>

      <div className="mt-3 flex items-center border-t border-black/[0.045] pt-2.5">
        <div className="flex -space-x-1.5">
          <span className="h-5 w-5 rounded-full border-2 border-white bg-neutral-900" />
          <span className="h-5 w-5 rounded-full border-2 border-white bg-[#ef2b2d]" />
        </div>
        <span className="ml-auto inline-flex items-center gap-1 text-[8px] text-muted-foreground">
          <Clock3 className="h-2.5 w-2.5" />
          {item.time}
        </span>
      </div>
    </div>
  );
}
