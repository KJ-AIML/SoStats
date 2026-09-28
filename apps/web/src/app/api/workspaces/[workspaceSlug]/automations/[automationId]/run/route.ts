import { NextResponse } from "next/server";
import {
  AutomationRunRecord,
  jsonBody,
  SoStatsApiError,
  workspaceRequest,
} from "@/lib/sostats-api.server";

export async function POST(
  request: Request,
  context: {
    params: Promise<{ workspaceSlug: string; automationId: string }>;
  },
) {
  try {
    const { workspaceSlug, automationId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const run = await workspaceRequest<AutomationRunRecord>(
      workspaceSlug,
      `/v1/automations/${automationId}/run`,
      {
        method: "POST",
        body: jsonBody(body),
      },
    );
    return NextResponse.json(run, { status: 201 });
  } catch (error) {
    const status = error instanceof SoStatsApiError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Automation run failed" },
      { status },
    );
  }
}
