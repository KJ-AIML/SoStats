import { NextResponse } from "next/server";
import {
  loadWorkspaceSnapshot,
  SoStatsApiError,
} from "@/lib/sostats-api.server";

export async function GET(
  _request: Request,
  context: { params: Promise<{ workspaceSlug: string }> },
) {
  try {
    const { workspaceSlug } = await context.params;
    return NextResponse.json(await loadWorkspaceSnapshot(workspaceSlug));
  } catch (error) {
    const status = error instanceof SoStatsApiError ? error.status : 500;
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to load workspace",
      },
      { status },
    );
  }
}
