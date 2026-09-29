import { NextResponse } from "next/server";
import {
  backendRequest,
  jsonBody,
  resolveWorkspace,
  SoStatsApiError,
} from "@/lib/sostats-api.server";

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceSlug: string }> },
) {
  try {
    const { workspaceSlug } = await context.params;
    const workspace = await resolveWorkspace(workspaceSlug);
    const body = (await request.json()) as {
      name?: string;
      scopes?: string[];
      expiresInDays?: number;
    };

    const result = await backendRequest(
      `/workspaces/${workspace.id}/api-keys`,
      {
        method: "POST",
        body: jsonBody({
          name: body.name,
          scopes: body.scopes,
          expiresInDays: body.expiresInDays,
        }),
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
            : "Unable to create API key",
      },
      { status },
    );
  }
}
