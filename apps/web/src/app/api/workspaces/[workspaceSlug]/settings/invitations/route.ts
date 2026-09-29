import { NextResponse } from "next/server";
import {
  backendRequest,
  jsonBody,
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
  context: { params: Promise<{ workspaceSlug: string }> },
) {
  try {
    const { workspaceSlug } = await context.params;
    const workspace = await resolveWorkspace(workspaceSlug);
    const body = (await request.json()) as {
      email?: string;
      role?: string;
    };
    const result = await backendRequest<{
      invitation: unknown;
      token: string;
    }>(`/workspaces/${workspace.id}/invitations`, {
      method: "POST",
      body: jsonBody({
        email: body.email,
        role: body.role,
      }),
    });

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
            : "Unable to create workspace invitation",
      },
      { status },
    );
  }
}
