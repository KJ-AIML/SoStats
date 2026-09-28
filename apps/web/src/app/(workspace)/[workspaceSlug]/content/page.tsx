import {
  Filter,
  LayoutGrid,
  List,
  Plus,
  Search,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContentBoard } from "@/components/content/content-board";
import { PageHeading } from "@/components/sostats/page-heading";

export default function ContentPage() {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1600px] flex-col gap-5 p-4 md:p-6 xl:p-8">
      <PageHeading
        eyebrow="Content"
        title="Your content pipeline"
        description="Move every idea through drafting, review, scheduling and publishing without losing the campaign context behind it."
        actions={
          <>
            <Button variant="outline" className="h-10 rounded-xl text-[10px]">
              <Sparkles className="mr-2 h-3.5 w-3.5" />
              AI generate
            </Button>
            <Button className="h-10 rounded-xl bg-[#ef2b2d] text-[10px] hover:bg-[#da2427]">
              <Plus className="mr-2 h-3.5 w-3.5" />
              New content
            </Button>
          </>
        }
      />

      <div className="sostats-card flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
        <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-xl bg-neutral-50 px-3">
          <Search className="h-3.5 w-3.5 text-neutral-400" />
          <input
            className="min-w-0 flex-1 bg-transparent text-[10px] outline-none placeholder:text-neutral-400"
            placeholder="Search content, campaigns or channels..."
          />
        </div>
        <div className="flex items-center gap-2">
          <button className="inline-flex h-9 items-center gap-2 rounded-xl border border-black/[0.06] bg-white px-3 text-[9px] font-semibold text-neutral-600">
            <Filter className="h-3.5 w-3.5" />
            Filter
          </button>
          <div className="flex h-9 items-center rounded-xl border border-black/[0.06] bg-neutral-50 p-1">
            <button className="flex h-7 w-8 items-center justify-center rounded-lg bg-white shadow-sm">
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <button className="flex h-7 w-8 items-center justify-center rounded-lg text-neutral-400">
              <List className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-[560px] flex-1">
        <ContentBoard />
      </div>
    </div>
  );
}
