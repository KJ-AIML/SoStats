import { NextResponse } from "next/server";
import {
  jsonBody,
  ScheduleRecord,
  SoStatsApiError,
  workspaceRequest,
} from "@/lib/sostats-api.server";

/** 32B-1 §9: forwards an owner/admin resolution. The API enforces the role. */
export async function POST(
  request: Request,
  context: {
    params: Promise<{ workspaceSlug: string; scheduleId: string }>;
  },
) {
  try {
    const { workspaceSlug, scheduleId } = await context.params;
    const input = (await request.json()) as {
      action?: string;
      platformPostId?: string;
      platformPostUrl?: string;
      scheduledAt?: string;
      note?: string;
    };

    const schedule = await workspaceRequest<ScheduleRecord>(
      workspaceSlug,
      `/v1/schedules/${encodeURIComponent(scheduleId)}/resolution`,
      { method: "POST", body: jsonBody(input) },
    );

    return NextResponse.json(schedule);
  } catch (error) {
    const status = error instanceof SoStatsApiError ? error.status : 500;
    const apiMessage =
      error instanceof SoStatsApiError
        ? (error.payload as { message?: unknown } | null)?.message
        : undefined;
    return NextResponse.json(
      {
        error:
          typeof apiMessage === "string" ? apiMessage : "Resolution failed",
      },
      { status },
    );
  }
}
