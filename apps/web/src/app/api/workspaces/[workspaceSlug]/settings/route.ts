import { NextResponse } from "next/server";
import {
  backendRequest,
  jsonBody,
  resolveWorkspace,
  SoStatsApiError,
  type WorkspaceSettingsRecord,
} from "@/lib/sostats-api.server";

export async function GET(
  _request: Request,
  context: { params: Promise<{ workspaceSlug: string }> },
) {
  try {
    const { workspaceSlug } = await context.params;
    const workspace = await resolveWorkspace(workspaceSlug);
    const settings = await backendRequest<WorkspaceSettingsRecord>(
      `/workspaces/${workspace.id}/settings`,
    );
    return NextResponse.json(settings);
  } catch (error) {
    const status = error instanceof SoStatsApiError ? error.status : 500;
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load workspace settings",
      },
      { status },
    );
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ workspaceSlug: string }> },
) {
  try {
    const { workspaceSlug } = await context.params;
    const workspace = await resolveWorkspace(workspaceSlug);
    const body = (await request.json()) as {
      name?: string;
      timezone?: string;
    };
    const updated = await backendRequest(
      `/workspaces/${workspace.id}/settings`,
      {
        method: "PUT",
        body: jsonBody({
          name: body.name,
          timezone: body.timezone,
        }),
      },
    );
    return NextResponse.json(updated);
  } catch (error) {
    const status = error instanceof SoStatsApiError ? error.status : 500;
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to update workspace settings",
      },
      { status },
    );
  }
}
