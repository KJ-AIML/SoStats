import { PageHeading } from "@/components/sostats/page-heading";
import { WorkspaceSettings } from "@/components/settings/workspace-settings";
import {
  backendRequest,
  resolveWorkspace,
  type WorkspaceSettingsRecord,
} from "@/lib/sostats-api.server";

export default async function WorkspaceSettingsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  let settings: WorkspaceSettingsRecord | null = null;

  try {
    const workspace = await resolveWorkspace(workspaceSlug);
    settings = await backendRequest<WorkspaceSettingsRecord>(
      `/workspaces/${workspace.id}/settings`,
    );
  } catch {
    settings = null;
  }

  return (
    <div className="mx-auto w-full max-w-[1450px] space-y-5 p-4 md:p-6 xl:p-8">
      <PageHeading
        eyebrow="Settings"
        title="Workspace administration without fake controls"
        description="Manage persisted workspace identity, timezone, membership roles and inspect authentication/runtime capability boundaries."
      />

      {settings ? (
        <WorkspaceSettings
          workspaceSlug={workspaceSlug}
          initialSettings={settings}
        />
      ) : (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[10px] text-amber-800">
          Settings are unavailable until the API/database stack is running or this user has workspace access.
        </div>
      )}
    </div>
  );
}
