import { NextResponse } from "next/server";
import {
  jsonBody,
  SoStatsApiError,
  workspaceRequest,
} from "@/lib/sostats-api.server";

export type KnowledgeSearchResult = {
  chunkId: number;
  sourceId: number;
  sourceTitle: string;
  sourceUrl?: string | null;
  sourceType: string;
  versionNumber: number;
  content: string;
  similarity: number;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceSlug: string }> },
) {
  try {
    const { workspaceSlug } = await context.params;
    const body = (await request.json()) as {
      brandId?: number;
      query?: string;
      limit?: number;
    };
    const results = await workspaceRequest<KnowledgeSearchResult[]>(
      workspaceSlug,
      "/v1/knowledge/search",
      {
        method: "POST",
        body: jsonBody({
          brandId: body.brandId,
          query: body.query,
          limit: body.limit,
        }),
      },
    );
    return NextResponse.json(results);
  } catch (error) {
    const status = error instanceof SoStatsApiError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Knowledge search failed" },
      { status },
    );
  }
}
