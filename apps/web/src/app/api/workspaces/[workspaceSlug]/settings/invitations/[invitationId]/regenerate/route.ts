import { NextResponse } from "next/server";
import {
  backendRequest,
  resolveWorkspace,
  SoStatsApiError,
} from "@/lib/sostats-api.server";

function inviteUrl(request: Request, token: string) {
  return new URL(
    `/invite/${encodeURIComponent(token)}`,
    new URL(request.url).origin,
  ).toString();
}

export async function POST(
  request: Request,
  context: {
    params: Promise<{ workspaceSlug: string; invitationId: string }>;
  },
) {
  try {
    const { workspaceSlug, invitationId } = await context.params;
    const workspace = await resolveWorkspace(workspaceSlug);
    const result = await backendRequest<{
      invitation: unknown;
      token: string;
    }>(
      `/workspaces/${workspace.id}/invitations/${invitationId}/regenerate`,
      { method: "POST" },
    );

    return NextResponse.json({
      invitation: result.invitation,
      inviteUrl: inviteUrl(request, result.token),
    });
  } catch (error) {
    const status = error instanceof SoStatsApiError ? error.status : 500;
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to regenerate invitation link",
      },
      { status },
    );
  }
}
