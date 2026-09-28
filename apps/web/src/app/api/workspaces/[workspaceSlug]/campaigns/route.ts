import { NextResponse } from "next/server";
import {
  CampaignRecord,
  jsonBody,
  SoStatsApiError,
  workspaceRequest,
} from "@/lib/sostats-api.server";

type CreateCampaignRequest = {
  brandId?: number;
  name?: string;
  description?: string;
  goal?: string;
  channels?: string[];
  topic?: string;
  instructions?: string;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceSlug: string }> },
) {
  try {
    const { workspaceSlug } = await context.params;
    const input = (await request.json()) as CreateCampaignRequest;
    const name = input.name?.trim() || input.goal?.trim() || "AI Campaign";

    const campaign = await workspaceRequest<CampaignRecord>(
      workspaceSlug,
      "/v1/campaigns",
      {
        method: "POST",
        body: jsonBody({
          brandId: input.brandId,
          name,
          description: input.description,
          goal: input.goal,
          channels: input.channels || [],
        }),
      },
    );

    const generated = await workspaceRequest<CampaignRecord>(
      workspaceSlug,
      `/v1/campaigns/${campaign.id}/generate`,
      {
        method: "POST",
        body: jsonBody({
          topic: input.topic || input.goal || name,
          instructions: input.instructions,
        }),
      },
    );

    return NextResponse.json(generated, { status: 201 });
  } catch (error) {
    const status = error instanceof SoStatsApiError ? error.status : 500;
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Campaign generation failed",
        details: error instanceof SoStatsApiError ? error.payload : undefined,
      },
      { status },
    );
  }
}
