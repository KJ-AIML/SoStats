import { NextResponse } from "next/server";
import {
  jsonBody,
  ScheduleRecord,
  SoStatsApiError,
  workspaceRequest,
} from "@/lib/sostats-api.server";

export async function PATCH(
  request: Request,
  context: {
    params: Promise<{ workspaceSlug: string; scheduleId: string }>;
  },
) {
  try {
    const { workspaceSlug, scheduleId } = await context.params;
    const input = (await request.json()) as {
      scheduledAt?: string;
      status?: string;
    };

    const schedule = await workspaceRequest<ScheduleRecord>(
      workspaceSlug,
      `/v1/schedules/${scheduleId}`,
      {
        method: "PATCH",
        body: jsonBody(input),
      },
    );

    return NextResponse.json(schedule);
  } catch (error) {
    const status = error instanceof SoStatsApiError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Schedule update failed" },
      { status },
    );
  }
}
