import { NextResponse } from "next/server";
import {
  type AssetRecord,
  SoStatsApiError,
  workspaceRequest,
} from "@/lib/sostats-api.server";

export async function DELETE(
  _request: Request,
  context: {
    params: Promise<{
      workspaceSlug: string;
      assetId: string;
      attachmentId: string;
    }>;
  },
) {
  try {
    const { workspaceSlug, assetId, attachmentId } = await context.params;
    const asset = await workspaceRequest<AssetRecord>(
      workspaceSlug,
      `/v1/assets/${assetId}/attachments/${attachmentId}`,
      { method: "DELETE" },
    );
    return NextResponse.json(asset);
  } catch (error) {
    const status = error instanceof SoStatsApiError ? error.status : 500;
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to detach media",
      },
      { status },
    );
  }
}
