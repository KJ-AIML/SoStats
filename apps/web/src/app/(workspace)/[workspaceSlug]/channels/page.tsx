import {
  CheckCircle2,
  ExternalLink,
  Link2,
  Plus,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeading } from "@/components/sostats/page-heading";
import { loadWorkspaceSnapshot } from "@/lib/sostats-api.server";

export default async function ChannelsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
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
  let connectionError = false;

  try {
    const snapshot = await loadWorkspaceSnapshot(workspaceSlug);
    channels = snapshot.channels;
  } catch {
    connectionError = true;
  }

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 p-4 md:p-6 xl:p-8">
      <PageHeading
        eyebrow="Channels"
        title="Connect once, publish everywhere"
        description="Manage provider health and channel identities behind one adapter layer. Secret tokens never leave the API."
        actions={
          <Button className="h-10 rounded-xl bg-[#ef2b2d] text-[10px] hover:bg-[#da2427]">
            <Plus className="mr-2 h-3.5 w-3.5" />
            Connect channel
          </Button>
        }
      />

      {connectionError && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[10px] text-amber-800">
          Channel data is unavailable until the API/database stack is running.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {channels.length ? (
          channels.map((channel) => (
            <section key={channel.id} className="sostats-card p-4">
              <div className="flex items-start justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-neutral-950 text-[11px] font-bold uppercase text-white">
                  {channel.provider.slice(0, 2)}
                </div>
                <button className="sostats-icon h-8 w-8">
                  <ExternalLink className="h-3.5 w-3.5 text-neutral-400" />
                </button>
              </div>
              <p className="mt-4 text-[12px] font-semibold capitalize">{channel.provider}</p>
              <p className="mt-0.5 truncate text-[9px] text-muted-foreground">
                {channel.accountName || channel.providerAccountId}
              </p>

              <div className="mt-4 flex items-center justify-between rounded-xl bg-neutral-50 p-3">
                <div>
                  <p className="text-[8px] text-muted-foreground">Status</p>
                  <p className={channel.status === "active" ? "mt-1 flex items-center gap-1 text-[9px] font-semibold text-emerald-600" : "mt-1 text-[9px] font-semibold text-amber-600"}>
                    {channel.status === "active" && <CheckCircle2 className="h-3 w-3" />}
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

              <div className="mt-4 flex items-center justify-between text-[8px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <RefreshCw className="h-3 w-3" />
                  {channel.supported === false
                    ? "Adapter unavailable"
                    : channel.capabilities?.analytics
                      ? "Publish + analytics ready"
                      : channel.capabilities?.text
                        ? "Text publishing ready"
                        : "Connected"}
                </span>
                <button className="font-semibold text-neutral-600">Manage</button>
              </div>
            </section>
          ))
        ) : (
          <section className="sostats-card col-span-full p-8 text-center">
            <p className="text-sm font-semibold">No channels connected</p>
            <p className="mx-auto mt-1 max-w-md text-[10px] leading-4 text-muted-foreground">
              Connect a provider before moving approved content into Scheduled. The content board only offers accounts returned by the secure channel API.
            </p>
          </section>
        )}
      </div>

      <div className="flex items-center gap-2 text-[9px] text-muted-foreground">
        <Link2 className="h-3.5 w-3.5" />
        Provider credentials remain encrypted inside the backend adapter layer. Existing LinkedIn connections created before analytics access was enabled may need to reconnect once to grant reporting permission.
      </div>
    </div>
  );
}
