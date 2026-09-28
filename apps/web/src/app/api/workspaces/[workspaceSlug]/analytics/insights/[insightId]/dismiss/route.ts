import { NextResponse } from "next/server";
import {
  type AiInsightRecord,
  SoStatsApiError,
  workspaceRequest,
} from "@/lib/sostats-api.server";

export async function POST(
  _request: Request,
  context: {
    params: Promise<{ workspaceSlug: string; insightId: string }>;
  },
) {
  try {
    const { workspaceSlug, insightId } = await context.params;
    const insight = await workspaceRequest<AiInsightRecord>(
      workspaceSlug,
      `/v1/analytics/insights/${insightId}/dismiss`,
      { method: "POST" },
    );
    return NextResponse.json(insight);
  } catch (error) {
    const status = error instanceof SoStatsApiError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Insight dismiss failed" },
      { status },
    );
  }
}
