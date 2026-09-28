import { PageHeading } from "@/components/sostats/page-heading";
import { AutomationWorkspace } from "@/components/automations/automation-workspace";
import { loadWorkspaceSnapshot } from "@/lib/sostats-api.server";

export default async function AutomationsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  let snapshot: Awaited<ReturnType<typeof loadWorkspaceSnapshot>> | null = null;

  try {
    snapshot = await loadWorkspaceSnapshot(workspaceSlug);
  } catch {
    snapshot = null;
  }

  const channels = (snapshot?.channels || [])
    .filter(
      (channel) =>
        channel.status === "active" &&
        channel.supported !== false &&
        channel.capabilities?.text !== false,
    )
    .map((channel) => ({
      id: channel.id,
      provider: channel.provider,
      accountName: channel.accountName,
    }));

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 p-4 md:p-6 xl:p-8">
      <PageHeading
        eyebrow="Automations"
        title="Design and run the content engine"
        description="Version workflows, execute them through BullMQ, pause for human review and resume into the same scheduling and publishing boundaries used everywhere else in SoStats."
      />

      {!snapshot && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[10px] text-amber-800">
          Automation runtime data is unavailable until the API/database stack is running.
        </div>
      )}

      <AutomationWorkspace
        workspaceSlug={workspaceSlug}
        initialAutomations={snapshot?.automations || []}
        channels={channels}
      />
    </div>
  );
}
