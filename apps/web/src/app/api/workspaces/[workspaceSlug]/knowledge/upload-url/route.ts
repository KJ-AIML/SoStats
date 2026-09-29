import { NextResponse } from "next/server";
import {
  jsonBody,
  KnowledgeSourceRecord,
  SoStatsApiError,
  workspaceRequest,
} from "@/lib/sostats-api.server";

type UploadRequest = {
  brandId?: number;
  title?: string;
  fileName?: string;
  mimeType?: string;
  size?: number;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceSlug: string }> },
) {
  try {
    const { workspaceSlug } = await context.params;
    const input = (await request.json()) as UploadRequest;
    const result = await workspaceRequest<{
      uploadUrl: string;
      source: KnowledgeSourceRecord;
    }>(workspaceSlug, "/v1/knowledge/upload-url", {
      method: "POST",
      body: jsonBody({
        brandId: input.brandId,
        title: input.title,
        fileName: input.fileName,
        mimeType: input.mimeType,
        size: input.size,
      }),
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const status = error instanceof SoStatsApiError ? error.status : 500;
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Knowledge upload initialization failed",
        details: error instanceof SoStatsApiError ? error.payload : undefined,
      },
      { status },
    );
  }
}
