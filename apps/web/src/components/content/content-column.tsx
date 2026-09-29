"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { ContentItem, ContentStatus } from "./data";
import { ContentCard } from "./content-card";
import { cn } from "@/lib/utils";

const tone: Record<ContentStatus, string> = {
  Ideas: "bg-neutral-300",
  Drafts: "bg-amber-400",
  Review: "bg-[#ef2b2d]",
  Scheduled: "bg-blue-500",
  Published: "bg-emerald-500",
};

export function ContentColumn({
  status,
  items,
  onOpen,
  onAdd,
}: {
  status: ContentStatus;
  items: ContentItem[];
  onOpen?: (item: ContentItem) => void;
  onAdd?: (status: ContentStatus) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: status,
    data: { type: "Column", status },
    disabled: status === "Published",
  });
  const canAdd = ["Ideas", "Drafts"].includes(status);

  return (
    <section className="flex min-w-[265px] flex-1 flex-col rounded-2xl border border-black/[0.055] bg-black/[0.018] p-2.5 xl:min-w-0">
      <div className="mb-2 flex items-center gap-2 px-1.5 py-1">
        <span className={cn("h-2 w-2 rounded-full", tone[status])} />
        <h3 className="text-[10px] font-semibold text-neutral-700">{status}</h3>
        <span className="ml-auto rounded-md bg-white px-1.5 py-0.5 text-[8px] font-semibold text-muted-foreground shadow-sm">
          {items.length}
        </span>
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-[420px] flex-1 flex-col gap-2.5 rounded-xl transition",
          isOver && status !== "Published" && "bg-[#fff0f0]/50 ring-1 ring-[#ef2b2d]/15",
        )}
      >
        <SortableContext
          items={items.map((item) => item.id)}
          strategy={verticalListSortingStrategy}
        >
          {items.map((item) => (
            <ContentCard key={item.id} item={item} onOpen={onOpen} />
          ))}
        </SortableContext>

        {canAdd && (
          <button
            type="button"
            onClick={() => onAdd?.(status)}
            className="mt-auto rounded-xl border border-dashed border-black/[0.09] px-3 py-2.5 text-[9px] font-medium text-muted-foreground transition hover:border-[#ef2b2d]/25 hover:bg-white hover:text-[#d92023]"
          >
            + Add {status === "Ideas" ? "idea" : "draft"}
          </button>
        )}
      </div>
    </section>
  );
}
