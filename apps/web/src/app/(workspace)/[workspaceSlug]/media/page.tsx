import {
  FileImage,
  Film,
  Folder,
  Image as ImageIcon,
  Plus,
  Search,
  Sparkles,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeading } from "@/components/sostats/page-heading";

const assets = [
  ["Product workflow", "Image · 1600×900", "from-red-500/80 via-orange-400/40 to-neutral-950"],
  ["Launch teaser", "Video · 00:18", "from-neutral-950 via-red-950 to-red-500/70"],
  ["Dashboard hero", "Image · 1920×1080", "from-neutral-200 via-white to-red-100"],
  ["Founder clip", "Video · 00:32", "from-stone-900 via-neutral-700 to-red-500/50"],
  ["AI insight card", "Image · 1200×1200", "from-red-50 via-white to-neutral-200"],
  ["Campaign carousel", "Image · 1080×1350", "from-neutral-950 via-neutral-800 to-orange-500/60"],
];

export default function MediaPage() {
  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 p-4 md:p-6 xl:p-8">
      <PageHeading
        eyebrow="Media"
        title="Every asset, ready for every channel"
        description="Manage uploaded, generated and brand-owned media without turning your content workflow into a file manager."
        actions={
          <>
            <Button variant="outline" className="h-10 rounded-xl text-[10px]">
              <Upload className="mr-2 h-3.5 w-3.5" />
              Upload
            </Button>
            <Button className="h-10 rounded-xl bg-[#ef2b2d] text-[10px] hover:bg-[#da2427]">
              <Sparkles className="mr-2 h-3.5 w-3.5" />
              Generate asset
            </Button>
          </>
        }
      />

      <div className="grid gap-3 md:grid-cols-[1fr_auto]">
        <div className="sostats-card flex h-11 items-center gap-2 px-3">
          <Search className="h-3.5 w-3.5 text-neutral-400" />
          <input className="min-w-0 flex-1 bg-transparent text-[10px] outline-none" placeholder="Search assets, tags or campaigns..." />
        </div>
        <div className="flex gap-2">
          {["All assets", "Images", "Video", "Brand"].map((item, index) => (
            <button
              key={item}
              className={
                index === 0
                  ? "rounded-xl bg-neutral-950 px-3 text-[9px] font-semibold text-white"
                  : "rounded-xl border border-black/[0.06] bg-white px-3 text-[9px] font-medium text-neutral-500"
              }
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="sostats-card self-start p-3">
          <p className="px-2 py-2 text-[10px] font-semibold">Collections</p>
          {[
            { icon: Folder, label: "All assets", count: "48" },
            { icon: FileImage, label: "Brand system", count: "12" },
            { icon: Film, label: "Product demos", count: "8" },
            { icon: ImageIcon, label: "Campaign visuals", count: "18" },
          ].map((item, index) => (
            <button
              key={item.label}
              className={
                index === 0
                  ? "flex w-full items-center gap-2 rounded-xl bg-[#fff0f0] px-2.5 py-2 text-[9px] font-semibold text-[#d92023]"
                  : "flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-[9px] font-medium text-neutral-500 hover:bg-neutral-50"
              }
            >
              <item.icon className="h-3.5 w-3.5" />
              {item.label}
              <span className="ml-auto text-[8px]">{item.count}</span>
            </button>
          ))}
          <button className="mt-2 flex w-full items-center gap-2 rounded-xl border border-dashed border-black/[0.08] px-2.5 py-2 text-[9px] text-muted-foreground">
            <Plus className="h-3.5 w-3.5" /> New collection
          </button>
        </aside>

        <main className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {assets.map(([title, meta, gradient]) => (
            <article key={title} className="sostats-card overflow-hidden">
              <div className={`aspect-[16/10] bg-gradient-to-br ${gradient} p-4`}>
                <div className="flex h-full items-end">
                  <span className="rounded-lg border border-white/20 bg-black/25 px-2 py-1 text-[8px] font-semibold text-white backdrop-blur">
                    SoStats
                  </span>
                </div>
              </div>
              <div className="p-3.5">
                <p className="text-[10px] font-semibold">{title}</p>
                <p className="mt-0.5 text-[8px] text-muted-foreground">{meta}</p>
                <div className="mt-3 flex items-center gap-1.5">
                  {["Launch", "Product"].map((tag) => (
                    <span key={tag} className="rounded-md bg-neutral-100 px-2 py-1 text-[8px] text-neutral-500">{tag}</span>
                  ))}
                  <button className="ml-auto text-[8px] font-semibold text-neutral-500">•••</button>
                </div>
              </div>
            </article>
          ))}
        </main>
      </div>
    </div>
  );
}
