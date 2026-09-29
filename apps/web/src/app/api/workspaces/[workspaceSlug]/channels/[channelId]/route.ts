import { NextResponse } from "next/server";
import {
  SoStatsApiError,
  workspaceRequest,
} from "@/lib/sostats-api.server";

export async function DELETE(
  _request: Request,
  context: {
    params: Promise<{ workspaceSlug: string; channelId: string }>;
  },
) {
  try {
    const { workspaceSlug, channelId } = await context.params;
    const result = await workspaceRequest<{
      id: number;
      status: string;
      updatedAt?: string;
    }>(
      workspaceSlug,
      `/v1/channels/${channelId}`,
      { method: "DELETE" },
    );
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof SoStatsApiError ? error.status : 500;
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to disconnect channel",
      },
      { status },
    );
  }
}
