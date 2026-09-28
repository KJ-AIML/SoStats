import { NextResponse } from "next/server";
import {
  AutomationRunRecord,
  SoStatsApiError,
  workspaceRequest,
} from "@/lib/sostats-api.server";

export async function GET(
  _request: Request,
  context: {
    params: Promise<{ workspaceSlug: string; automationId: string }>;
  },
) {
  try {
    const { workspaceSlug, automationId } = await context.params;
    const runs = await workspaceRequest<AutomationRunRecord[]>(
      workspaceSlug,
      `/v1/automations/${automationId}/runs`,
    );
    return NextResponse.json(runs);
  } catch (error) {
    const status = error instanceof SoStatsApiError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load runs" },
      { status },
    );
  }
}
