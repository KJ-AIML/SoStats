import { NextResponse } from "next/server";
import {
  type BrandRecord,
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
    const body = (await request.json()) as {
      name?: string;
      description?: string;
      websiteUrl?: string;
    };
    const brand = await workspaceRequest<BrandRecord>(
      workspaceSlug,
      "/brands",
      {
        method: "POST",
        body: jsonBody({
          name: body.name,
          description: body.description,
          websiteUrl: body.websiteUrl,
        }),
      },
    );
    return NextResponse.json(brand, { status: 201 });
  } catch (error) {
    const status = error instanceof SoStatsApiError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create brand" },
      { status },
    );
  }
}
