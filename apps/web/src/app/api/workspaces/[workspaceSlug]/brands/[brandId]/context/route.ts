import { NextResponse } from "next/server";
import {
  type BrandRecord,
  jsonBody,
  SoStatsApiError,
  workspaceRequest,
} from "@/lib/sostats-api.server";

export async function PUT(
  request: Request,
  context: {
    params: Promise<{ workspaceSlug: string; brandId: string }>;
  },
) {
  try {
    const { workspaceSlug, brandId } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    const brand = await workspaceRequest<BrandRecord>(
      workspaceSlug,
      `/brands/${brandId}/context`,
      {
        method: "PUT",
        body: jsonBody(body),
      },
    );
    return NextResponse.json(brand);
  } catch (error) {
    const status = error instanceof SoStatsApiError ? error.status : 500;
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to update Brand Brain context",
      },
      { status },
    );
  }
}
