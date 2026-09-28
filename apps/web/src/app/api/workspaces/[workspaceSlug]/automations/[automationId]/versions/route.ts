import { NextResponse } from "next/server";
import {
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
    const body = (await request.json()) as Record<string, unknown>;
    const version = await workspaceRequest<Record<string, unknown>>(
      workspaceSlug,
      `/v1/automations/${automationId}/versions`,
      {
        method: "POST",
        body: jsonBody(body),
      },
    );
    return NextResponse.json(version, { status: 201 });
  } catch (error) {
    const status = error instanceof SoStatsApiError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Version save failed" },
      { status },
    );
  }
}
