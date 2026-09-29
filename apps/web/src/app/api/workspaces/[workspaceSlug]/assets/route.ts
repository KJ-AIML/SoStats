import { NextResponse } from "next/server";
import {
  type AssetRecord,
  SoStatsApiError,
  workspaceRequest,
} from "@/lib/sostats-api.server";

export async function GET(
  _request: Request,
  context: { params: Promise<{ workspaceSlug: string }> },
) {
  try {
    const { workspaceSlug } = await context.params;
    const assets = await workspaceRequest<AssetRecord[]>(
      workspaceSlug,
      "/v1/assets",
    );
    return NextResponse.json(assets);
  } catch (error) {
    const status = error instanceof SoStatsApiError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load assets" },
      { status },
    );
  }
}
