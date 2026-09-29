import {
  BarChart3,
  CheckCircle2,
  KeyRound,
  Link2,
  Send,
} from "lucide-react";
import { PageHeading } from "@/components/sostats/page-heading";
import { ChannelConnectPanel } from "@/components/channels/channel-connect-panel";
import { ChannelAccountGrid } from "@/components/channels/channel-account-grid";
import { loadWorkspaceSnapshot } from "@/lib/sostats-api.server";

function providerLabel(value?: string) {
  if (!value) return "Provider";
  if (value.toLowerCase() === "x") return "X";
  if (value.toLowerCase() === "linkedin") return "LinkedIn";
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

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
  let snapshot: Awaited<ReturnType<typeof loadWorkspaceSnapshot>> | null = null;

  try {
    snapshot = await loadWorkspaceSnapshot(workspaceSlug);
  } catch {
    snapshot = null;
  }

  const channels = snapshot?.channels || [];
  const providers = snapshot?.providers || [];
  const brands =
    snapshot?.brands.map((brand) => ({
      id: brand.id,
      name: brand.name,
    })) || [];

  const connectedProviders = [
    ...new Set(
      channels
        .filter((channel) => channel.status !== "disconnected")
        .map((channel) => channel.provider.toLowerCase()),
    ),
  ];

  const activeAccounts = channels.filter(
    (channel) => channel.status === "active",
  ).length;
  const publishingReady = channels.filter(
    (channel) => channel.publishingReady,
  ).length;
  const analyticsReady = channels.filter(
    (channel) => channel.analyticsReady,
  ).length;
  const attention = channels.filter((channel) =>
    [
      "expiring",
      "refresh_required",
      "expired",
      "missing_token",
      "disconnected",
    ].includes(channel.credentialState || ""),
  ).length;

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 p-4 md:p-6 xl:p-8">
      <PageHeading
        eyebrow="Channels"
        title="Provider connections you can trust"
        description="The ProviderRegistry is the source of truth for connectable channels and capabilities. OAuth credentials stay encrypted in the API while publishing, analytics and token health remain visible here."
      />

      {query.connected && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[10px] text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {providerLabel(query.connected)} connected successfully.
        </div>
      )}

      {query.channelError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[10px] text-red-700">
          {query.provider ? `${providerLabel(query.provider)}: ` : ""}
          {query.channelError}
        </div>
      )}

      {!snapshot && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[10px] text-amber-800">
          Channel data is unavailable until the API/database stack is running.
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "Active accounts",
            value: activeAccounts,
            hint: `${providers.length} registered provider adapter${providers.length === 1 ? "" : "s"}`,
            Icon: Link2,
          },
          {
            label: "Publishing ready",
            value: publishingReady,
            hint: "Usable credential + text adapter",
            Icon: Send,
          },
          {
            label: "Analytics ready",
            value: analyticsReady,
            hint: "Usable credential + metrics adapter",
            Icon: BarChart3,
          },
          {
            label: "Needs attention",
            value: attention,
            hint: "Expiry, missing token or disconnected",
            Icon: KeyRound,
          },
        ].map(({ label, value, hint, Icon }) => (
          <div key={label} className="sostats-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[9px] font-medium text-muted-foreground">
                  {label}
                </p>
                <p className="mt-1 text-2xl font-semibold tracking-[-0.04em]">
                  {value}
                </p>
                <p className="mt-2 text-[8px] text-muted-foreground">{hint}</p>
              </div>
              <div className="sostats-icon h-8 w-8">
                <Icon className="h-3.5 w-3.5 text-neutral-500" />
              </div>
            </div>
          </div>
        ))}
      </section>

      <ChannelConnectPanel
        workspaceSlug={workspaceSlug}
        brands={brands}
        providers={providers}
        connectedProviders={connectedProviders}
      />

      <section>
        <div className="mb-3 flex items-end justify-between gap-3 px-1">
          <div>
            <p className="text-sm font-semibold">Connected accounts</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Credential lifecycle, provider capability and execution readiness.
            </p>
          </div>
          <span className="text-[9px] text-muted-foreground">
            {channels.length} persisted account{channels.length === 1 ? "" : "s"}
          </span>
        </div>

        <ChannelAccountGrid
          workspaceSlug={workspaceSlug}
          initialAccounts={channels}
        />
      </section>

      <div className="flex items-start gap-2 text-[9px] leading-4 text-muted-foreground">
        <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        OAuth callback state is encrypted and short-lived. X uses PKCE S256.
        Access and refresh tokens remain encrypted at rest and are removed on
        disconnect without deleting historical publication or analytics records.
      </div>
    </div>
  );
}
