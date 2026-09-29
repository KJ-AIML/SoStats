import { NextResponse } from "next/server";
import {
  type AiInsightRecord,
  jsonBody,
  SoStatsApiError,
  workspaceRequest,
} from "@/lib/sostats-api.server";

type GeneratedInsightResponse = {
  generationId: string;
  summary: string;
  insights: AiInsightRecord[];
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ workspaceSlug: string }> },
) {
  try {
    const { workspaceSlug } = await context.params;
    const insights = await workspaceRequest<AiInsightRecord[]>(
      workspaceSlug,
      "/v1/analytics/insights?limit=30",
    );
    return NextResponse.json(insights);
  } catch (error) {
    const status = error instanceof SoStatsApiError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load insights" },
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
    const body = (await request.json().catch(() => ({}))) as {
      brandId?: number;
    };

    const insight = await workspaceRequest<GeneratedInsightResponse>(
      workspaceSlug,
      "/v1/analytics/insights",
      {
        method: "POST",
        body: jsonBody({ brandId: body.brandId }),
      },
    );

    return NextResponse.json(insight);
  } catch (error) {
    const status = error instanceof SoStatsApiError ? error.status : 500;
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Insight generation failed",
        details: error instanceof SoStatsApiError ? error.payload : undefined,
      },
      { status },
    );
  }
}
