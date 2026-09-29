import { InviteAcceptance } from "@/components/settings/invite-acceptance";
import {
  backendRequest,
  SoStatsApiError,
} from "@/lib/sostats-api.server";

type InvitePreview = {
  workspace: {
    id: number;
    name: string;
    slug: string;
  };
  email: string;
  role: string;
  status: string;
  expiresAt: string;
};

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  let preview: InvitePreview | null = null;
  let error: string | null = null;

  try {
    preview = await backendRequest<InvitePreview>(
      `/invitations/${encodeURIComponent(token)}`,
    );
  } catch (requestError) {
    error =
      requestError instanceof SoStatsApiError && requestError.status === 404
        ? "This invitation link is invalid or no longer exists."
        : requestError instanceof Error
          ? requestError.message
          : "Unable to inspect invitation.";
  }

  if (!preview) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-[720px] items-center px-4 py-10">
        <div className="w-full rounded-[28px] border border-black/[0.07] bg-white p-8 text-center shadow-[0_28px_90px_rgba(0,0,0,0.08)]">
          <p className="text-sm font-semibold">Invitation unavailable</p>
          <p className="mt-2 text-[10px] leading-5 text-muted-foreground">
            {error}
          </p>
        </div>
      </div>
    );
  }

  return <InviteAcceptance token={token} preview={preview} />;
}
