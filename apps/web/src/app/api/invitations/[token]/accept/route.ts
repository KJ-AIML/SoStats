import { NextResponse } from "next/server";
import {
  backendRequest,
  SoStatsApiError,
} from "@/lib/sostats-api.server";

export async function POST(
  _request: Request,
  context: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await context.params;
    const result = await backendRequest<unknown>(
      `/invitations/${encodeURIComponent(token)}/accept`,
      { method: "POST" },
    );
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof SoStatsApiError ? error.status : 500;
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to accept invitation",
      },
      { status },
    );
  }
}
