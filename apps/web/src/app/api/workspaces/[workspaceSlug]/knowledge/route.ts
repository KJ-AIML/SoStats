import { NextResponse } from "next/server";
import {
  jsonBody,
  KnowledgeSourceRecord,
  SoStatsApiError,
  workspaceRequest,
} from "@/lib/sostats-api.server";

type CreateKnowledgeRequest = {
  brandId?: number;
  sourceType?: "text" | "url";
  title?: string;
  url?: string;
  text?: string;
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ workspaceSlug: string }> },
) {
  try {
    const { workspaceSlug } = await context.params;
    const sources = await workspaceRequest<KnowledgeSourceRecord[]>(
      workspaceSlug,
      "/v1/knowledge",
    );
    return NextResponse.json(sources);
  } catch (error) {
    const status = error instanceof SoStatsApiError ? error.status : 500;
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Knowledge load failed",
      },
      { status },
    );
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceSlug: string }> },
) {
  try {
    const { workspaceSlug } = await context.params;
    const input = (await request.json()) as CreateKnowledgeRequest;
    const source = await workspaceRequest<KnowledgeSourceRecord>(
      workspaceSlug,
      "/v1/knowledge",
      {
        method: "POST",
        body: jsonBody({
          brandId: input.brandId,
          sourceType: input.sourceType,
          title: input.title,
          url: input.url,
          text: input.text,
        }),
      },
    );
    return NextResponse.json(source, { status: 201 });
  } catch (error) {
    const status = error instanceof SoStatsApiError ? error.status : 500;
    const details =
      error instanceof SoStatsApiError ? error.payload : undefined;
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Knowledge ingestion failed",
        details,
      },
      { status },
    );
  }
}
