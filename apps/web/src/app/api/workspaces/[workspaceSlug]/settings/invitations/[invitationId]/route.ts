import { NextResponse } from "next/server";
import {
  backendRequest,
  resolveWorkspace,
  SoStatsApiError,
} from "@/lib/sostats-api.server";

export async function DELETE(
  _request: Request,
  context: {
    params: Promise<{ workspaceSlug: string; invitationId: string }>;
  },
) {
  try {
    const { workspaceSlug, invitationId } = await context.params;
    const workspace = await resolveWorkspace(workspaceSlug);
    const result = await backendRequest(
      `/workspaces/${workspace.id}/invitations/${invitationId}`,
      { method: "DELETE" },
    );
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof SoStatsApiError ? error.status : 500;
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to revoke invitation",
      },
      { status },
    );
  }
}
