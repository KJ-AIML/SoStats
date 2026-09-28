import { CalendarPlus, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeading } from "@/components/sostats/page-heading";
import { loadWorkspaceSnapshot } from "@/lib/sostats-api.server";
import { CalendarView } from "./calendar-view";

export default async function CalendarPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  let schedules: Array<{
    id: number;
    title: string;
    channel: string;
    scheduledAt: string;
  }> = [];
  let connectionError = false;

  try {
    const snapshot = await loadWorkspaceSnapshot(workspaceSlug);
    schedules = snapshot.calendar.map((schedule) => ({
      id: schedule.id,
      title:
        schedule.contentItem?.title ||
        schedule.variant?.content?.slice(0, 90) ||
        "Scheduled content",
      channel: schedule.socialAccount?.provider || "Channel",
      scheduledAt: schedule.scheduledAt,
    }));
  } catch {
    connectionError = true;
  }

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 p-4 md:p-6 xl:p-8">
      <PageHeading
        eyebrow="Calendar"
        title="Plan every channel in one view"
        description="Review coverage, spot gaps and move approved content into the right publishing window."
        actions={
          <>
            <Button variant="outline" className="h-10 rounded-xl text-[10px]">
              <Filter className="mr-2 h-3.5 w-3.5" />
              Channels
            </Button>
            <Button className="h-10 rounded-xl bg-[#ef2b2d] text-[10px] hover:bg-[#da2427]">
              <CalendarPlus className="mr-2 h-3.5 w-3.5" />
              Schedule content
            </Button>
          </>
        }
      />
      {connectionError && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[10px] text-amber-800">
          Calendar data is unavailable until the API/database stack is running.
        </div>
      )}
      <CalendarView workspaceSlug={workspaceSlug} initialSchedules={schedules} />
    </div>
  );
}
