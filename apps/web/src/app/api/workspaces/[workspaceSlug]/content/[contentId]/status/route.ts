import { NextResponse } from "next/server";
import {
  ContentRecord,
  jsonBody,
  SoStatsApiError,
  workspaceRequest,
} from "@/lib/sostats-api.server";

export async function PATCH(
  request: Request,
  context: {
    params: Promise<{ workspaceSlug: string; contentId: string }>;
  },
) {
  try {
    const { workspaceSlug, contentId } = await context.params;
    const input = (await request.json()) as { status?: string };
    if (!input.status) {
      return NextResponse.json({ error: "status is required" }, { status: 400 });
    }

    const content = await workspaceRequest<ContentRecord>(
      workspaceSlug,
      `/v1/content/${contentId}/status`,
      {
        method: "PATCH",
        body: jsonBody({ status: input.status }),
      },
    );

    return NextResponse.json(content);
  } catch (error) {
    const status = error instanceof SoStatsApiError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Status update failed" },
      { status },
    );
  }
}
