import { NextResponse } from "next/server";
import {
  type AssetRecord,
  jsonBody,
  SoStatsApiError,
  workspaceRequest,
} from "@/lib/sostats-api.server";

export async function POST(
  request: Request,
  context: {
    params: Promise<{ workspaceSlug: string; assetId: string }>;
  },
) {
  try {
    const { workspaceSlug, assetId } = await context.params;
    const body = (await request.json()) as {
      contentItemId?: number;
      variantId?: number;
    };

    if (!body.contentItemId) {
      return NextResponse.json(
        { error: "contentItemId is required" },
        { status: 400 },
      );
    }

    const asset = await workspaceRequest<AssetRecord>(
      workspaceSlug,
      `/v1/assets/${assetId}/attachments`,
      {
        method: "POST",
        body: jsonBody({
          contentItemId: body.contentItemId,
          variantId: body.variantId,
        }),
      },
    );
    return NextResponse.json(asset);
  } catch (error) {
    const status = error instanceof SoStatsApiError ? error.status : 500;
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to attach media",
      },
      { status },
    );
  }
}
