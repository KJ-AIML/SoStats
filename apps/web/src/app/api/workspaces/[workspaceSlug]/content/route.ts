import { NextResponse } from "next/server";
import {
  ContentRecord,
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
    const input = (await request.json()) as {
      brandId?: number;
      title?: string;
      description?: string;
      status?: string;
    };

    if (!input.title?.trim()) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }

    const content = await workspaceRequest<ContentRecord>(
      workspaceSlug,
      "/v1/content",
      {
        method: "POST",
        body: jsonBody({
          brandId: input.brandId,
          title: input.title.trim(),
          description: input.description?.trim(),
          status: input.status || "draft",
        }),
      },
    );

    return NextResponse.json(content, { status: 201 });
  } catch (error) {
    const status = error instanceof SoStatsApiError ? error.status : 500;
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Content creation failed",
        details: error instanceof SoStatsApiError ? error.payload : undefined,
      },
      { status },
    );
  }
}
