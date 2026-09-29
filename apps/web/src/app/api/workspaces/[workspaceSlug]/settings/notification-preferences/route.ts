import { NextResponse } from "next/server";
import {
  backendRequest,
  jsonBody,
  resolveWorkspace,
  SoStatsApiError,
} from "@/lib/sostats-api.server";

export async function PUT(
  request: Request,
  context: { params: Promise<{ workspaceSlug: string }> },
) {
  try {
    const { workspaceSlug } = await context.params;
    const workspace = await resolveWorkspace(workspaceSlug);
    const body = (await request.json()) as {
      securityEvents?: boolean;
      publishingFailures?: boolean;
      automationFailures?: boolean;
      weeklyDigest?: boolean;
    };

    const result = await backendRequest(
      `/workspaces/${workspace.id}/notification-preferences`,
      {
        method: "PUT",
        body: jsonBody(body),
      },
    );

    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof SoStatsApiError ? error.status : 500;
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to update notification preferences",
      },
      { status },
    );
  }
}
