import {
  CheckCircle2,
  ExternalLink,
  Link2,
  RefreshCw,
} from "lucide-react";
import { PageHeading } from "@/components/sostats/page-heading";
import { ChannelConnectPanel } from "@/components/channels/channel-connect-panel";
import { loadWorkspaceSnapshot } from "@/lib/sostats-api.server";

export default async function ChannelsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{
    connected?: string;
    channelError?: string;
    provider?: string;
  }>;
}) {
  const { workspaceSlug } = await params;
  const query = await searchParams;
  let channels: Array<{
    id: number;
    provider: string;
    accountName?: string | null;
    providerAccountId: string;
    status: string;
    updatedAt?: string;
    supported?: boolean;
    capabilities?: {
      text: boolean;
      images: boolean;
      video: boolean;
      carousel: boolean;
      analytics: boolean;
      nativeScheduling: boolean;
    } | null;
  }> = [];
  let brandId: number | undefined;
  let connectionError = false;

  try {
    const snapshot = await loadWorkspaceSnapshot(workspaceSlug);
    channels = snapshot.channels;
    brandId = snapshot.brand?.id;
  } catch {
    connectionError = true;
  }

  const connectedProviders = [
    ...new Set(channels.map((channel) => channel.provider.toLowerCase())),
  ];

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 p-4 md:p-6 xl:p-8">
      <PageHeading
        eyebrow="Channels"
        title="Connect once, publish everywhere"
        description="LinkedIn and X now share the same secure provider boundary for OAuth, publishing, token refresh and analytics."
      />

      {query.connected && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[10px] text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {query.connected === "x" ? "X" : "LinkedIn"} connected successfully.
        </div>
      )}

      {query.channelError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[10px] text-red-700">
          {query.provider ? `${query.provider}: ` : ""}
          {query.channelError}
        </div>
      )}

      {connectionError && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[10px] text-amber-800">
          Channel data is unavailable until the API/database stack is running.
        </div>
      )}

      <ChannelConnectPanel
        workspaceSlug={workspaceSlug}
        brandId={brandId}
        connectedProviders={connectedProviders}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {channels.length ? (
          channels.map((channel) => (
            <section key={channel.id} className="sostats-card p-4">
              <div className="flex items-start justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-neutral-950 text-[11px] font-bold uppercase text-white">
                  {channel.provider === "x"
                    ? "X"
                    : channel.provider.slice(0, 2)}
                </div>
                <div className="sostats-icon h-8 w-8">
                  <ExternalLink className="h-3.5 w-3.5 text-neutral-400" />
                </div>
              </div>
              <p className="mt-4 text-[12px] font-semibold">
                {channel.provider === "x" ? "X" : "LinkedIn"}
              </p>
              <p className="mt-0.5 truncate text-[9px] text-muted-foreground">
                {channel.accountName || channel.providerAccountId}
              </p>

              <div className="mt-4 flex items-center justify-between rounded-xl bg-neutral-50 p-3">
                <div>
                  <p className="text-[8px] text-muted-foreground">Status</p>
                  <p
                    className={
                      channel.status === "active"
                        ? "mt-1 flex items-center gap-1 text-[9px] font-semibold text-emerald-600"
                        : "mt-1 text-[9px] font-semibold text-amber-600"
                    }
                  >
                    {channel.status === "active" && (
                      <CheckCircle2 className="h-3 w-3" />
                    )}
                    {channel.status}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[8px] text-muted-foreground">Account</p>
                  <p className="mt-1 max-w-28 truncate text-[9px] font-semibold">
                    {channel.accountName || "Connected"}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex items-center gap-1 text-[8px] text-muted-foreground">
                <RefreshCw className="h-3 w-3" />
                {channel.supported === false
                  ? "Adapter unavailable"
                  : channel.capabilities?.analytics
                    ? "Publish + analytics ready"
                    : channel.capabilities?.text
                      ? "Text publishing ready"
                      : "Connected"}
              </div>
            </section>
          ))
        ) : (
          <section className="sostats-card col-span-full p-8 text-center">
            <p className="text-sm font-semibold">No channels connected</p>
            <p className="mx-auto mt-1 max-w-md text-[10px] leading-4 text-muted-foreground">
              Connect LinkedIn or X above. Approved content can then use the same scheduling and publishing engine for either provider.
            </p>
          </section>
        )}
      </div>

      <div className="flex items-start gap-2 text-[9px] leading-4 text-muted-foreground">
        <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        OAuth callback state is encrypted and short-lived. X uses PKCE S256 and offline access for refresh tokens; provider credentials remain encrypted inside the API.
      </div>
    </div>
  );
}
