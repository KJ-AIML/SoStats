import Link from "next/link";
import { ArrowRight, CalendarPlus } from "lucide-react";
import { PageHeading } from "@/components/sostats/page-heading";
import { loadWorkspaceSnapshot } from "@/lib/sostats-api.server";
import { CalendarView, type CalendarSchedule } from "./calendar-view";

export default async function CalendarPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  let schedules: CalendarSchedule[] = [];
  let timezone = "UTC";
  let canResolve = false;
  let connectionError = false;

  try {
    const snapshot = await loadWorkspaceSnapshot(workspaceSlug);
    timezone = snapshot.workspace.timezone || "UTC";
    // 32B-1 §9: only owners and admins see resolution actions; the API enforces it too.
    canResolve = ["owner", "admin"].includes(snapshot.workspace.role || "");

    schedules = snapshot.calendar.map((schedule) => {
      const jobs = [...(schedule.jobs || [])].sort(
        (a, b) =>
          new Date(b.lastAttemptAt || 0).getTime() -
          new Date(a.lastAttemptAt || 0).getTime(),
      );
      const results = jobs
        .flatMap((job) => job.results || [])
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
      const latest = results[0];
      const posted = results.find((result) => result.platformPostId);
      const reconciliations = schedule.reconciliations || [];
      const attested = reconciliations.find(
        (entry) => entry.outcome === "confirmed_published" && entry.platformPostId,
      );
      const published = schedule.status === "published";
      const recordedPostIds = [
        ...new Set(
          results.flatMap((result) =>
            result.platformPostId ? [result.platformPostId] : [],
          ),
        ),
      ];
      const latestPublished = reconciliations.find(
        (entry) => entry.outcome === "confirmed_published",
      );

      return {
        id: schedule.id,
        contentItemId: schedule.contentItemId,
        title:
          schedule.contentItem?.title ||
          schedule.variant?.content?.slice(0, 90) ||
          "Scheduled content",
        campaign: schedule.contentItem?.campaign?.name || "Unassigned",
        channel: schedule.socialAccount?.provider || "Channel",
        accountName:
          schedule.socialAccount?.accountName ||
          schedule.socialAccount?.provider ||
          "Channel",
        channelConnected: schedule.socialAccount?.status === "active",
        variantLabel: schedule.variant?.platform || "Canonical",
        variantCopy: schedule.variant?.content || undefined,
        scheduledAt: schedule.scheduledAt,
        status: schedule.status,
        attempts: jobs.reduce((total, job) => total + (job.attempts || 0), 0),
        failureType:
          schedule.status === "failed" ? latest?.errorType || undefined : undefined,
        failureReason:
          schedule.status === "failed"
            ? latest?.errorMessage || undefined
            : undefined,
        postUrl: published
          ? posted?.platformPostUrl || attested?.platformPostUrl || undefined
          : undefined,
        platformPostId: published
          ? posted?.platformPostId || attested?.platformPostId || undefined
          : undefined,
        resultAt: published
          ? posted?.createdAt || attested?.createdAt || undefined
          : undefined,
        analyticsUnavailable: published && !posted,
        recordedPostIds,
        publishedBy:
          latestPublished?.source === "operator"
            ? ("operator" as const)
            : ("provider" as const),
        attemptEvidence: schedule.attemptEvidence ?? null,
        reconciliations,
      };
    });
  } catch {
    connectionError = true;
  }

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 p-4 md:p-6 xl:p-8">
      <PageHeading
        eyebrow="Calendar"
        title="Control the publishing lifecycle"
        description="Plan by month, week or day, filter real provider schedules, reschedule safely and inspect provider outcomes without leaving the publishing command center."
        actions={
          <Link
            href={`/${workspaceSlug}/content`}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#ef2b2d] px-4 text-[10px] font-semibold text-white transition hover:bg-[#da2427]"
          >
            <CalendarPlus className="h-3.5 w-3.5" />
            Schedule from Content
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        }
      />

      {connectionError && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[10px] text-amber-800">
          Calendar data is unavailable until the API/database stack is running.
        </div>
      )}

      <CalendarView
        workspaceSlug={workspaceSlug}
        timezone={timezone}
        initialSchedules={schedules}
        canResolve={canResolve}
      />
    </div>
  );
}
