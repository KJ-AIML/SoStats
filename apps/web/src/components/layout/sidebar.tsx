"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  BrainCircuit,
  CalendarDays,
  ChevronDown,
  GalleryVerticalEnd,
  Home,
  Layers3,
  Library,
  Network,
  Settings2,
  Sparkles,
  Workflow,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

const primaryItems = [
  { label: "Home", icon: Home, href: "" },
  { label: "AI Studio", icon: Sparkles, href: "/ai-studio" },
  { label: "Content", icon: Layers3, href: "/content" },
  { label: "Calendar", icon: CalendarDays, href: "/calendar" },
  { label: "Automations", icon: Workflow, href: "/automations" },
  { label: "Analytics", icon: BarChart3, href: "/analytics" },
  { label: "Media", icon: Library, href: "/media" },
  { label: "Channels", icon: Network, href: "/channels" },
];

const contextItems = [
  { label: "Brand Brain", icon: BrainCircuit, href: "/brand-brain" },
  { label: "Integrations", icon: Zap, href: "/integrations" },
];

export function Sidebar() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  const firstSegment = segments[0];
  const workspaceSlug = firstSegment || "demo";
  const base = `/${workspaceSlug}`;

  const isActive = (href: string) => {
    const target = `${base}${href}`;
    return href === "" ? pathname === base : pathname.startsWith(target);
  };

  return (
    <aside className="hidden h-screen w-[248px] shrink-0 border-r border-black/[0.06] bg-white/85 backdrop-blur-xl lg:flex lg:flex-col">
      <div className="flex h-[72px] items-center border-b border-black/[0.055] px-5">
        <Link href={base} className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#ef2b2d] text-white shadow-[0_8px_24px_rgba(239,43,45,0.22)]">
            <GalleryVerticalEnd className="h-[18px] w-[18px]" />
          </span>
          <div className="leading-tight">
            <div className="text-[15px] font-bold tracking-[-0.02em]">SoStats</div>
            <div className="text-[10px] font-medium text-muted-foreground">
              AI Content Automation
            </div>
          </div>
        </Link>
      </div>

      <div className="px-3 pt-4">
        <button className="flex w-full items-center gap-3 rounded-xl border border-black/[0.06] bg-black/[0.025] px-3 py-2.5 text-left transition hover:bg-black/[0.04]">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-900 text-[11px] font-bold text-white">
            SS
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">SoStats Studio</span>
            <span className="block truncate text-[11px] text-muted-foreground">
              Main workspace
            </span>
          </span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-5">
        <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/75">
          Workspace
        </p>
        <div className="space-y-1">
          {primaryItems.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.label}
                href={`${base}${item.href}`}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition",
                  active
                    ? "bg-[#fff0f0] text-[#d92023]"
                    : "text-neutral-600 hover:bg-black/[0.035] hover:text-neutral-950",
                )}
              >
                {active && (
                  <span className="absolute -left-3 h-6 w-[3px] rounded-r-full bg-[#ef2b2d]" />
                )}
                <item.icon
                  className={cn(
                    "h-[17px] w-[17px]",
                    active
                      ? "text-[#e72a2d]"
                      : "text-neutral-400 group-hover:text-neutral-700",
                  )}
                />
                {item.label}
                {item.label === "AI Studio" && (
                  <span className="ml-auto rounded-md bg-[#ef2b2d] px-1.5 py-0.5 text-[9px] font-bold text-white">
                    AI
                  </span>
                )}
              </Link>
            );
          })}
        </div>

        <p className="mb-2 mt-6 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/75">
          Intelligence
        </p>
        <div className="space-y-1">
          {contextItems.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.label}
                href={`${base}${item.href}`}
                className={cn(
                  "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition",
                  active
                    ? "bg-[#fff0f0] text-[#d92023]"
                    : "text-neutral-600 hover:bg-black/[0.035] hover:text-neutral-950",
                )}
              >
                <item.icon className="h-[17px] w-[17px]" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="border-t border-black/[0.055] p-3">
        <Link
          href={`${base}/settings`}
          className={cn(
            "mb-2 flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition",
            pathname.startsWith(`${base}/settings`)
              ? "bg-[#fff0f0] text-[#d92023]"
              : "text-neutral-600 hover:bg-black/[0.035] hover:text-neutral-950",
          )}
        >
          <Settings2 className="h-[17px] w-[17px]" />
          Settings
        </Link>

        <div className="flex items-center gap-3 rounded-xl border border-black/[0.055] p-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-900 text-[10px] font-bold text-white">
            KJ
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold">Workspace Owner</p>
            <p className="truncate text-[10px] text-muted-foreground">SoStats Studio</p>
          </div>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
      </div>
    </aside>
  );
}
