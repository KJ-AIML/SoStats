import {
  Bell,
  KeyRound,
  LockKeyhole,
  Save,
  Settings2,
  Shield,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeading } from "@/components/sostats/page-heading";

export default function SettingsPage() {
  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-5 p-4 md:p-6 xl:p-8">
      <PageHeading
        eyebrow="Settings"
        title="Workspace preferences"
        description="Manage team access, security and product defaults for SoStats Studio."
        actions={
          <Button className="h-10 rounded-xl bg-[#ef2b2d] text-[10px] hover:bg-[#da2427]">
            <Save className="mr-2 h-3.5 w-3.5" />
            Save changes
          </Button>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="sostats-card self-start p-2">
          {[
            { icon: Settings2, label: "Workspace" },
            { icon: Users, label: "Team & roles" },
            { icon: Bell, label: "Notifications" },
            { icon: KeyRound, label: "API keys" },
            { icon: Shield, label: "Security" },
          ].map((item, index) => (
            <button
              key={item.label}
              className={
                index === 0
                  ? "flex w-full items-center gap-2 rounded-xl bg-[#fff0f0] px-3 py-2.5 text-[9px] font-semibold text-[#d92023]"
                  : "flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-[9px] font-medium text-neutral-500 hover:bg-neutral-50"
              }
            >
              <item.icon className="h-3.5 w-3.5" />
              {item.label}
            </button>
          ))}
        </aside>

        <section className="sostats-card overflow-hidden">
          <div className="border-b border-black/[0.055] px-5 py-4">
            <p className="text-sm font-semibold">Workspace</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">Default identity and scheduling behavior</p>
          </div>
          <div className="space-y-5 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              {[
                ["Workspace name", "SoStats Studio"],
                ["Workspace slug", "sostats-studio"],
                ["Timezone", "Asia/Bangkok"],
                ["Default language", "English"],
              ].map(([label, value]) => (
                <label key={label}>
                  <span className="mb-1.5 block text-[9px] font-semibold text-neutral-600">{label}</span>
                  <input
                    defaultValue={value}
                    className="h-10 w-full rounded-xl border border-black/[0.07] bg-neutral-50 px-3 text-[10px] outline-none focus:border-[#ef2b2d]/25 focus:bg-white"
                  />
                </label>
              ))}
            </div>

            <div className="rounded-xl border border-black/[0.055] p-4">
              <div className="flex items-start gap-3">
                <div className="sostats-icon">
                  <LockKeyhole className="h-4 w-4 text-neutral-500" />
                </div>
                <div>
                  <p className="text-[10px] font-semibold">Human approval before publish</p>
                  <p className="mt-1 text-[9px] leading-4 text-muted-foreground">
                    Keep final publishing behind review by default. Individual automations can apply stricter policies but cannot silently weaken workspace policy.
                  </p>
                </div>
                <button className="ml-auto mt-1 h-5 w-9 rounded-full bg-[#ef2b2d] p-0.5">
                  <span className="block h-4 w-4 translate-x-4 rounded-full bg-white shadow-sm" />
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
