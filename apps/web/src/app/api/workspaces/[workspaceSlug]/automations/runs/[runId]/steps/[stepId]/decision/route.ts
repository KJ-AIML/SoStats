import { NextResponse } from "next/server";
import {
  jsonBody,
  SoStatsApiError,
  workspaceRequest,
} from "@/lib/sostats-api.server";

export async function POST(
  request: Request,
  context: {
    params: Promise<{
      workspaceSlug: string;
      runId: string;
      stepId: string;
    }>;
  },
) {
  try {
    const { workspaceSlug, runId, stepId } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    const result = await workspaceRequest<Record<string, unknown>>(
      workspaceSlug,
      `/v1/automations/runs/${runId}/steps/${encodeURIComponent(stepId)}/decision`,
      {
        method: "POST",
        body: jsonBody(body),
      },
    );
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof SoStatsApiError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Review decision failed" },
      { status },
    );
  }
}
