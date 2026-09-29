import { NextResponse } from "next/server";
import {
  type AssetRecord,
  SoStatsApiError,
  workspaceRequest,
} from "@/lib/sostats-api.server";

export async function POST(
  _request: Request,
  context: {
    params: Promise<{ workspaceSlug: string; assetId: string }>;
  },
) {
  try {
    const { workspaceSlug, assetId } = await context.params;
    const asset = await workspaceRequest<AssetRecord>(
      workspaceSlug,
      `/v1/assets/${assetId}/retry`,
      { method: "POST" },
    );
    return NextResponse.json(asset);
  } catch (error) {
    const status = error instanceof SoStatsApiError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Asset retry failed" },
      { status },
    );
  }
}
