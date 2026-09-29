import { NextResponse } from "next/server";
import {
  SoStatsApiError,
  workspaceRequest,
} from "@/lib/sostats-api.server";

export async function DELETE(
  _request: Request,
  context: {
    params: Promise<{ workspaceSlug: string; sourceId: string }>;
  },
) {
  try {
    const { workspaceSlug, sourceId } = await context.params;
    const result = await workspaceRequest<{ success: boolean; id: number }>(
      workspaceSlug,
      `/v1/knowledge/${sourceId}`,
      { method: "DELETE" },
    );
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof SoStatsApiError ? error.status : 500;
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Knowledge deletion failed",
      },
      { status },
    );
  }
}
