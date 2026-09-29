import { NextResponse } from "next/server";
import {
  backendRequest,
  resolveWorkspace,
  SoStatsApiError,
} from "@/lib/sostats-api.server";

export async function DELETE(
  _request: Request,
  context: {
    params: Promise<{ workspaceSlug: string; keyId: string }>;
  },
) {
  try {
    const { workspaceSlug, keyId } = await context.params;
    const workspace = await resolveWorkspace(workspaceSlug);
    const result = await backendRequest(
      `/workspaces/${workspace.id}/api-keys/${keyId}`,
      { method: "DELETE" },
    );

    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof SoStatsApiError ? error.status : 500;
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to revoke API key",
      },
      { status },
    );
  }
}
