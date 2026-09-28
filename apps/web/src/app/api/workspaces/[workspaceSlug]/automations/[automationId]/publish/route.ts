import { NextResponse } from "next/server";
import {
  SoStatsApiError,
  workspaceRequest,
} from "@/lib/sostats-api.server";

export async function POST(
  _request: Request,
  context: {
    params: Promise<{ workspaceSlug: string; automationId: string }>;
  },
) {
  try {
    const { workspaceSlug, automationId } = await context.params;
    const result = await workspaceRequest<Record<string, unknown>>(
      workspaceSlug,
      `/v1/automations/${automationId}/publish`,
      { method: "POST" },
    );
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof SoStatsApiError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Workflow publish failed" },
      { status },
    );
  }
}
