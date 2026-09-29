import { NextResponse } from "next/server";
import {
  backendRequest,
  jsonBody,
  resolveWorkspace,
  SoStatsApiError,
} from "@/lib/sostats-api.server";

export async function PUT(
  request: Request,
  context: {
    params: Promise<{ workspaceSlug: string; memberId: string }>;
  },
) {
  try {
    const { workspaceSlug, memberId } = await context.params;
    const workspace = await resolveWorkspace(workspaceSlug);
    const body = (await request.json()) as { role?: string };
    const updated = await backendRequest(
      `/workspaces/${workspace.id}/members/${memberId}/role`,
      {
        method: "PUT",
        body: jsonBody({ role: body.role }),
      },
    );
    return NextResponse.json(updated);
  } catch (error) {
    const status = error instanceof SoStatsApiError ? error.status : 500;
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to update member role",
      },
      { status },
    );
  }
}
