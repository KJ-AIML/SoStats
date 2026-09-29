import { NextResponse } from "next/server";
import {
  type AssetRecord,
  jsonBody,
  SoStatsApiError,
  workspaceRequest,
} from "@/lib/sostats-api.server";

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceSlug: string }> },
) {
  try {
    const { workspaceSlug } = await context.params;
    const body = (await request.json()) as {
      fileName: string;
      fileType: string;
      mimeType: string;
      size: number;
      brandId?: number;
    };

    const result = await workspaceRequest<{
      uploadUrl: string;
      asset: AssetRecord;
    }>(workspaceSlug, "/v1/assets/upload-url", {
      method: "POST",
      body: jsonBody(body),
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const status = error instanceof SoStatsApiError ? error.status : 500;
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to create upload",
      },
      { status },
    );
  }
}
