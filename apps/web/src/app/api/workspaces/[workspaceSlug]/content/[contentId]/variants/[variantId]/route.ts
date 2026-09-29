import { NextResponse } from "next/server";
import {
  ContentVariantRecord,
  jsonBody,
  SoStatsApiError,
  workspaceRequest,
} from "@/lib/sostats-api.server";

export async function PATCH(
  request: Request,
  context: {
    params: Promise<{
      workspaceSlug: string;
      contentId: string;
      variantId: string;
    }>;
  },
) {
  try {
    const { workspaceSlug, contentId, variantId } = await context.params;
    const input = (await request.json()) as { content?: string };

    if (!input.content?.trim()) {
      return NextResponse.json(
        { error: "variant content is required" },
        { status: 400 },
      );
    }

    const variant = await workspaceRequest<ContentVariantRecord>(
      workspaceSlug,
      `/v1/content/${contentId}/variants/${variantId}`,
      {
        method: "PATCH",
        body: jsonBody({ content: input.content.trim() }),
      },
    );

    return NextResponse.json(variant);
  } catch (error) {
    const status = error instanceof SoStatsApiError ? error.status : 500;
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Variant update failed",
        details: error instanceof SoStatsApiError ? error.payload : undefined,
      },
      { status },
    );
  }
}
