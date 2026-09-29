"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Clock3, GripVertical, Layers3 } from "lucide-react";
import type { ContentItem } from "./data";
import { cn } from "@/lib/utils";

function platformLabel(value?: string | null) {
  if (!value) return "Generic";
  if (value.toLowerCase() === "x") return "X";
  if (value.toLowerCase() === "linkedin") return "LinkedIn";
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function ContentCard({
  item,
  onOpen,
}: {
  item: ContentItem;
  onOpen?: (item: ContentItem) => void;
}) {
  const draggable = !["Scheduled", "Published"].includes(item.status);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: item.id,
    data: { type: "Item", item },
    disabled: !draggable,
  });

  return (
    <article
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        "group rounded-xl border border-black/[0.06] bg-white p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.02)] transition hover:-translate-y-0.5 hover:border-black/10 hover:shadow-[0_10px_24px_rgba(15,23,42,0.06)]",
        isDragging && "opacity-45",
      )}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => onOpen?.(item)}
          className="min-w-0 flex-1 text-left"
        >
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {item.variantRefs.length ? (
              item.variantRefs.slice(0, 3).map((variant) => (
                <span
                  key={variant.id}
                  className="rounded-md bg-neutral-100 px-2 py-1 text-[8px] font-semibold text-neutral-600"
                >
                  {platformLabel(variant.platform)}
                </span>
              ))
            ) : (
              <span className="rounded-md bg-neutral-100 px-2 py-1 text-[8px] font-semibold text-neutral-500">
                Canonical
              </span>
            )}
            {item.variantRefs.length > 3 && (
              <span className="text-[8px] text-muted-foreground">
                +{item.variantRefs.length - 3}
              </span>
            )}
          </div>
          <h3 className="text-[11px] font-semibold leading-4 text-neutral-900">
            {item.title}
          </h3>
          {item.description && (
            <p className="mt-1.5 line-clamp-2 text-[9px] leading-4 text-muted-foreground">
              {item.description}
            </p>
          )}
          <p className="mt-2 truncate text-[8px] text-muted-foreground">
            {item.campaign || "Unassigned"}
          </p>
        </button>

        {draggable ? (
          <button
            type="button"
            aria-label={`Move ${item.title}`}
            {...attributes}
            {...listeners}
            className="cursor-grab rounded-md p-1 text-neutral-300 transition hover:bg-neutral-50 hover:text-neutral-500 active:cursor-grabbing"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
        ) : (
          <span
            className="rounded-md bg-neutral-50 p-1 text-neutral-300"
            title="Scheduling and publishing own this state"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={() => onOpen?.(item)}
        className="mt-3 flex w-full items-center border-t border-black/[0.045] pt-2.5 text-left"
      >
        <span className="inline-flex items-center gap-1 text-[8px] text-muted-foreground">
          <Layers3 className="h-2.5 w-2.5" />
          {item.variantRefs.length} variant{item.variantRefs.length === 1 ? "" : "s"}
        </span>
        <span className="ml-auto inline-flex items-center gap-1 text-[8px] text-muted-foreground">
          <Clock3 className="h-2.5 w-2.5" />
          {item.time || "Updated recently"}
        </span>
      </button>
    </article>
  );
}
