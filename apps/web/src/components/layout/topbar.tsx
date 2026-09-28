"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Menu, Plus, Search } from "lucide-react";

export function Topbar() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  const workspaceSlug =
    segments[0] && segments[0] !== "settings" ? segments[0] : "demo";

  return (
    <header className="relative z-20 flex h-[72px] shrink-0 items-center gap-4 border-b border-black/[0.055] bg-white/80 px-4 backdrop-blur-xl md:px-6">
      <button
        aria-label="Open navigation"
        className="flex h-9 w-9 items-center justify-center rounded-xl border border-black/[0.07] bg-white lg:hidden"
      >
        <Menu className="h-4 w-4" />
      </button>

      <div className="hidden max-w-[420px] flex-1 md:block">
        <div className="group flex h-10 items-center gap-2 rounded-xl border border-black/[0.065] bg-black/[0.022] px-3 text-sm transition focus-within:border-black/15 focus-within:bg-white">
          <Search className="h-4 w-4 text-neutral-400" />
          <input
            aria-label="Search"
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-neutral-400"
            placeholder="Search campaigns, posts, automations..."
          />
          <kbd className="rounded-md border border-black/[0.07] bg-white px-1.5 py-0.5 text-[9px] font-medium text-neutral-400">
            ⌘ K
          </kbd>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Link
          href={`/${workspaceSlug}/ai-studio`}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#ef2b2d] px-4 text-[13px] font-semibold text-white shadow-[0_8px_22px_rgba(239,43,45,0.18)] transition hover:bg-[#da2427]"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Create</span>
        </Link>
        <button
          aria-label="Notifications"
          className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-black/[0.065] bg-white text-neutral-600 transition hover:bg-neutral-50"
        >
          <Bell className="h-[17px] w-[17px]" />
          <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-[#ef2b2d]" />
        </button>
        <div className="ml-1 flex h-10 w-10 items-center justify-center rounded-full bg-neutral-900 text-[11px] font-bold text-white">
          KJ
        </div>
      </div>
    </header>
  );
}
