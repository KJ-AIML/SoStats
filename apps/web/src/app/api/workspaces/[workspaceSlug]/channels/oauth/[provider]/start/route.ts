import { NextResponse } from "next/server";
import {
  jsonBody,
  SoStatsApiError,
  workspaceRequest,
} from "@/lib/sostats-api.server";

export async function POST(
  request: Request,
  context: {
    params: Promise<{ workspaceSlug: string; provider: string }>;
  },
) {
  try {
    const { workspaceSlug, provider } = await context.params;
    const body = (await request.json()) as {
      brandId: number;
      returnTo: string;
    };

    const result = await workspaceRequest<{
      provider: string;
      authorizationUrl: string;
      expiresInSeconds: number;
    }>(
      workspaceSlug,
      `/v1/channels/${encodeURIComponent(provider)}/oauth/start`,
      {
        method: "POST",
        body: jsonBody({
          brandId: body.brandId,
          returnTo: body.returnTo,
        }),
      },
    );

    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof SoStatsApiError ? error.status : 500;
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to start provider connection",
      },
      { status },
    );
  }
}