import { NextResponse } from "next/server";
import {
  SoStatsApiError,
  workspaceRequest,
} from "@/lib/sostats-api.server";

export async function GET(
  _request: Request,
  context: { params: Promise<{ workspaceSlug: string }> },
) {
  try {
    const { workspaceSlug } = await context.params;
    const overview = await workspaceRequest<unknown>(
      workspaceSlug,
      "/integrations/overview",
    );
    return NextResponse.json(overview);
  } catch (error) {
    const status = error instanceof SoStatsApiError ? error.status : 500;
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load integrations overview",
      },
      { status },
    );
  }
}
