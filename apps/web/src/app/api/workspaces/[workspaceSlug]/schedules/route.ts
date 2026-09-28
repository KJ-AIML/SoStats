import { NextResponse } from "next/server";
import {
  jsonBody,
  ScheduleRecord,
  SoStatsApiError,
  workspaceRequest,
} from "@/lib/sostats-api.server";

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceSlug: string }> },
) {
  try {
    const { workspaceSlug } = await context.params;
    const input = (await request.json()) as {
      contentItemId?: number;
      variantId?: number;
      socialAccountId?: number;
      scheduledAt?: string;
    };

    if (!input.contentItemId || !input.socialAccountId || !input.scheduledAt) {
      return NextResponse.json(
        { error: "contentItemId, socialAccountId and scheduledAt are required" },
        { status: 400 },
      );
    }

    const schedule = await workspaceRequest<ScheduleRecord>(
      workspaceSlug,
      "/v1/schedules",
      {
        method: "POST",
        body: jsonBody(input),
      },
    );

    return NextResponse.json(schedule, { status: 201 });
  } catch (error) {
    const status = error instanceof SoStatsApiError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Scheduling failed" },
      { status },
    );
  }
}
