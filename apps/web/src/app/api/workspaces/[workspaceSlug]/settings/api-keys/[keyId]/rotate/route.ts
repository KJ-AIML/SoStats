import { NextResponse } from "next/server";
import {
  backendRequest,
  jsonBody,
  resolveWorkspace,
  SoStatsApiError,
} from "@/lib/sostats-api.server";

export async function POST(
  request: Request,
  context: {
    params: Promise<{ workspaceSlug: string; keyId: string }>;
  },
) {
  try {
    const { workspaceSlug, keyId } = await context.params;
    const workspace = await resolveWorkspace(workspaceSlug);
    const body = (await request.json()) as {
      expiresInDays?: number;
    };

    const result = await backendRequest(
      `/workspaces/${workspace.id}/api-keys/${keyId}/rotate`,
      {
        method: "POST",
        body: jsonBody({
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
          error instanceof Error ? error.message : "Unable to rotate API key",
      },
      { status },
    );
  }
}
