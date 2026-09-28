import { NextResponse } from "next/server";
import {
  jsonBody,
  SoStatsApiError,
  workspaceRequest,
} from "@/lib/sostats-api.server";

type InsightResponse = {
  insights: Array<{
    finding: string;
    recommendation: string;
    impact_estimate: string;
  }>;
  summary: string;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceSlug: string }> },
) {
  try {
    const { workspaceSlug } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      brandId?: number;
    };

    const insight = await workspaceRequest<InsightResponse>(
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
