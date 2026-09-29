import { NextResponse } from "next/server";
import {
  type BrandRecord,
  jsonBody,
  SoStatsApiError,
  workspaceRequest,
} from "@/lib/sostats-api.server";

export async function GET(
  _request: Request,
  context: {
    params: Promise<{ workspaceSlug: string; brandId: string }>;
  },
) {
  try {
    const { workspaceSlug, brandId } = await context.params;
    const brand = await workspaceRequest<BrandRecord>(
      workspaceSlug,
      `/brands/${brandId}`,
    );
    return NextResponse.json(brand);
  } catch (error) {
    const status = error instanceof SoStatsApiError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load brand" },
      { status },
    );
  }
}

export async function PUT(
  request: Request,
  context: {
    params: Promise<{ workspaceSlug: string; brandId: string }>;
  },
) {
  try {
    const { workspaceSlug, brandId } = await context.params;
    const body = (await request.json()) as {
      name?: string;
      description?: string;
      websiteUrl?: string;
    };
    const brand = await workspaceRequest<BrandRecord>(
      workspaceSlug,
      `/brands/${brandId}`,
      {
        method: "PUT",
        body: jsonBody({
          name: body.name,
          description: body.description,
          websiteUrl: body.websiteUrl,
        }),
      },
    );
    return NextResponse.json(brand);
  } catch (error) {
    const status = error instanceof SoStatsApiError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to update brand" },
      { status },
    );
  }
}
