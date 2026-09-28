import { NextResponse } from "next/server";
import {
  AutomationRecord,
  jsonBody,
  SoStatsApiError,
  workspaceRequest,
} from "@/lib/sostats-api.server";

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceSlug: string }> },
) {
  try {
    const { workspaceSlug } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    const automation = await workspaceRequest<AutomationRecord>(
      workspaceSlug,
      "/v1/automations",
      {
        method: "POST",
        body: jsonBody(body),
      },
    );
    return NextResponse.json(automation, { status: 201 });
  } catch (error) {
    const status = error instanceof SoStatsApiError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Automation creation failed" },
      { status },
    );
  }
}
