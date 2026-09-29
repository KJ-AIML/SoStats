import { NextResponse } from "next/server";
import {
  KnowledgeSourceRecord,
  SoStatsApiError,
  workspaceRequest,
} from "@/lib/sostats-api.server";

export async function POST(
  _request: Request,
  context: {
    params: Promise<{ workspaceSlug: string; sourceId: string }>;
  },
) {
  try {
    const { workspaceSlug, sourceId } = await context.params;
    const result = await workspaceRequest<KnowledgeSourceRecord>(
      workspaceSlug,
      `/v1/knowledge/${sourceId}/complete-upload`,
      { method: "POST" },
    );
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof SoStatsApiError ? error.status : 500;
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Knowledge upload completion failed",
      },
      { status },
    );
  }
}
