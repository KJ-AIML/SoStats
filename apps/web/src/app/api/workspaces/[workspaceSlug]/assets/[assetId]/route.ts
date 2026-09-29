import { NextResponse } from "next/server";
import {
  type AssetRecord,
  SoStatsApiError,
  workspaceRequest,
} from "@/lib/sostats-api.server";

export async function GET(
  _request: Request,
  context: {
    params: Promise<{ workspaceSlug: string; assetId: string }>;
  },
) {
  try {
    const { workspaceSlug, assetId } = await context.params;
    const asset = await workspaceRequest<AssetRecord>(
      workspaceSlug,
      `/v1/assets/${assetId}`,
    );
    return NextResponse.json(asset);
  } catch (error) {
    const status = error instanceof SoStatsApiError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load asset" },
      { status },
    );
  }
}

export async function DELETE(
  _request: Request,
  context: {
    params: Promise<{ workspaceSlug: string; assetId: string }>;
  },
) {
  try {
    const { workspaceSlug, assetId } = await context.params;
    const result = await workspaceRequest<{ success: boolean }>(
      workspaceSlug,
      `/v1/assets/${assetId}`,
      { method: "DELETE" },
    );
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof SoStatsApiError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Asset deletion failed" },
      { status },
    );
  }
}
