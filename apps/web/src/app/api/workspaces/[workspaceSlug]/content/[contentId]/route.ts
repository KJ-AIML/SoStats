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
    const input = (await request.json()) as {
      title?: string;
      description?: string;
    };

    const content = await workspaceRequest<ContentRecord>(
      workspaceSlug,
      `/v1/content/${contentId}`,
      {
        method: "PATCH",
        body: jsonBody(input),
      },
    );

    return NextResponse.json(content);
  } catch (error) {
    const status = error instanceof SoStatsApiError ? error.status : 500;
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Content update failed",
        details: error instanceof SoStatsApiError ? error.payload : undefined,
      },
      { status },
    );
  }
}
