import { NextResponse } from "next/server";
import {
  jsonBody,
  SoStatsApiError,
  workspaceRequest,
} from "@/lib/sostats-api.server";

export async function PATCH(
  request: Request,
  context: {
    params: Promise<{ workspaceSlug: string; automationId: string }>;
  },
) {
  try {
    const { workspaceSlug, automationId } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    const automation = await workspaceRequest<Record<string, unknown>>(
      workspaceSlug,
      `/v1/automations/${automationId}`,
      {
        method: "PATCH",
        body: jsonBody(body),
      },
    );
    return NextResponse.json(automation);
  } catch (error) {
    const status = error instanceof SoStatsApiError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Automation update failed" },
      { status },
    );
  }
}
