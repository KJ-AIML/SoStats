"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Activity,
  AlertCircle,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  LoaderCircle,
  LogOut,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import type { SocialAccountRecord } from "@/lib/sostats-api.server";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function providerLabel(value: string) {
  if (value.toLowerCase() === "x") return "X";
  if (value.toLowerCase() === "linkedin") return "LinkedIn";
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value?: string | null) {
  if (!value) return "No expiry reported";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function credentialLabel(account: SocialAccountRecord) {
  switch (account.credentialState) {
    case "active":
      return "Token active";
    case "no_expiry":
      return "No expiry reported";
    case "expiring":
      return account.hasRefreshToken
        ? "Expiring soon · refreshable"
        : "Expiring soon · reconnect recommended";
    case "refresh_required":
      return "Expired · refresh available";
    case "expired":
      return "Expired · reconnect required";
    case "disconnected":
      return "Disconnected";
    case "missing_token":
      return "Credentials unavailable";
    default:
      return account.status;
  }
}

function credentialTone(account: SocialAccountRecord) {
  if (
    account.credentialState === "active" ||
    account.credentialState === "no_expiry"
  ) {
    return "bg-emerald-50 text-emerald-700";
  }
  if (
    account.credentialState === "expiring" ||
    account.credentialState === "refresh_required"
  ) {
    return "bg-amber-50 text-amber-700";
  }
  return "bg-red-50 text-red-700";
}

function readinessLabel(ready?: boolean) {
  return ready ? "Ready" : "Unavailable";
}

export function ChannelAccountGrid({
  workspaceSlug,
  initialAccounts,
}: {
  workspaceSlug: string;
  initialAccounts: SocialAccountRecord[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] =
    useState<SocialAccountRecord | null>(null);

  const refreshCredentials = async (account: SocialAccountRecord) => {
    setBusy(`refresh-${account.id}`);
    setError(null);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/channels/${account.id}/refresh`,
        { method: "POST" },
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to refresh credentials");
      }
      router.refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to refresh credentials",
      );
    } finally {
      setBusy(null);
    }
  };

  const reconnect = async (account: SocialAccountRecord) => {
    setBusy(`reconnect-${account.id}`);
    setError(null);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/channels/${encodeURIComponent(account.provider)}/oauth/start`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            brandId: account.brandId,
            returnTo: `/${workspaceSlug}/channels`,
          }),
        },
      );
      const payload = (await response.json()) as {
        authorizationUrl?: string;
        error?: string;
      };
      if (!response.ok || !payload.authorizationUrl) {
        throw new Error(payload.error || "Unable to start OAuth reconnect");
      }
      window.location.assign(payload.authorizationUrl);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to start OAuth reconnect",
      );
      setBusy(null);
    }
  };

  const disconnect = async () => {
    if (!confirmDisconnect) return;
    const account = confirmDisconnect;
    setBusy(`disconnect-${account.id}`);
    setError(null);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/channels/${account.id}`,
        { method: "DELETE" },
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to disconnect channel");
      }
      setConfirmDisconnect(null);
      router.refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to disconnect channel",
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[9px] leading-4 text-red-700">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {initialAccounts.length ? (
          initialAccounts.map((account) => {
            const disconnected = account.status === "disconnected";
            const needsRefresh =
              account.credentialState === "refresh_required";
            const shouldReconnect =
              disconnected ||
              account.credentialState === "expired" ||
              account.credentialState === "missing_token";
            const activeSchedules = account.activeScheduleCount || 0;

            return (
              <section key={account.id} className="sostats-card p-5">
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-neutral-950 text-[13px] font-bold uppercase text-white">
                    {account.provider === "x"
                      ? "X"
                      : account.provider.slice(0, 2)}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[12px] font-semibold">
                        {providerLabel(account.provider)}
                      </p>
                      <span
                        className={`rounded-lg px-2 py-1 text-[7px] font-semibold ${credentialTone(account)}`}
                      >
                        {credentialLabel(account)}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[9px] text-muted-foreground">
                      {account.accountName || account.providerAccountId}
                    </p>
                    <p className="mt-1 text-[8px] text-muted-foreground">
                      {account.brand?.name
                        ? `Brand · ${account.brand.name}`
                        : "Brand association unavailable"}
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <HealthMetric
                    icon={Send}
                    label="Publishing"
                    value={readinessLabel(account.publishingReady)}
                    active={Boolean(account.publishingReady)}
                  />
                  <HealthMetric
                    icon={BarChart3}
                    label="Analytics"
                    value={readinessLabel(account.analyticsReady)}
                    active={Boolean(account.analyticsReady)}
                  />
                  <HealthMetric
                    icon={CalendarClock}
                    label="Queued"
                    value={String(activeSchedules)}
                    active={activeSchedules === 0}
                  />
                  <HealthMetric
                    icon={Activity}
                    label="Published"
                    value={String(account.publishedCount || 0)}
                    active
                  />
                </div>

                <div className="mt-4 grid gap-3 rounded-xl bg-neutral-50 p-3 sm:grid-cols-3">
                  <Info
                    label="Credential expiry"
                    value={formatDate(account.expiresAt)}
                  />
                  <Info
                    label="Last publish"
                    value={formatDate(account.lastPublishedAt)}
                  />
                  <Info
                    label="Latest analytics"
                    value={formatDate(account.latestAnalyticsAt)}
                  />
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-black/[0.05] pt-4">
                  {needsRefresh && account.hasRefreshToken && (
                    <Button
                      variant="outline"
                      onClick={() => void refreshCredentials(account)}
                      disabled={Boolean(busy)}
                      className="h-9 rounded-xl text-[8px]"
                    >
                      {busy === `refresh-${account.id}` ? (
                        <LoaderCircle className="mr-1.5 h-3 w-3 animate-spin" />
                      ) : (
                        <RefreshCw className="mr-1.5 h-3 w-3" />
                      )}
                      Refresh credentials
                    </Button>
                  )}

                  {(shouldReconnect ||
                    account.credentialState === "expiring") && (
                    <Button
                      variant="outline"
                      onClick={() => void reconnect(account)}
                      disabled={Boolean(busy)}
                      className="h-9 rounded-xl text-[8px]"
                    >
                      {busy === `reconnect-${account.id}` ? (
                        <LoaderCircle className="mr-1.5 h-3 w-3 animate-spin" />
                      ) : (
                        <ShieldCheck className="mr-1.5 h-3 w-3" />
                      )}
                      Reconnect OAuth
                    </Button>
                  )}

                  {!disconnected && (
                    <Button
                      variant="outline"
                      onClick={() => setConfirmDisconnect(account)}
                      disabled={Boolean(busy) || activeSchedules > 0}
                      className="h-9 rounded-xl border-red-100 text-[8px] text-red-700 hover:bg-red-50"
                      title={
                        activeSchedules > 0
                          ? "Cancel or move active scheduled publications first"
                          : "Disconnect credentials and preserve history"
                      }
                    >
                      <LogOut className="mr-1.5 h-3 w-3" />
                      Disconnect
                    </Button>
                  )}

                  {activeSchedules > 0 && (
                    <Link
                      href={`/${workspaceSlug}/calendar`}
                      className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-xl bg-amber-50 px-3 text-[8px] font-semibold text-amber-700"
                    >
                      <ShieldAlert className="h-3 w-3" />
                      Resolve {activeSchedules} queued
                    </Link>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {account.capabilities &&
                    Object.entries(account.capabilities).map(
                      ([capability, enabled]) => (
                        <span
                          key={capability}
                          className={
                            enabled
                              ? "rounded-md bg-emerald-50 px-2 py-1 text-[7px] font-medium text-emerald-700"
                              : "rounded-md bg-neutral-50 px-2 py-1 text-[7px] font-medium text-neutral-400"
                          }
                        >
                          {capability.replaceAll("_", " ")} ·{" "}
                          {enabled ? "yes" : "no"}
                        </span>
                      ),
                    )}
                </div>
              </section>
            );
          })
        ) : (
          <section className="sostats-card col-span-full p-8 text-center">
            <p className="text-sm font-semibold">No channels connected</p>
            <p className="mx-auto mt-1 max-w-md text-[10px] leading-4 text-muted-foreground">
              Choose a provider from the registry catalog above. Credentials stay
              encrypted inside the API and never enter the browser.
            </p>
          </section>
        )}
      </div>

      <Dialog
        open={Boolean(confirmDisconnect)}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirmDisconnect(null);
        }}
      >
        <DialogContent className="rounded-2xl">
          {confirmDisconnect && (
            <>
              <DialogHeader>
                <DialogTitle className="tracking-[-0.02em]">
                  Disconnect {providerLabel(confirmDisconnect.provider)}?
                </DialogTitle>
              </DialogHeader>

              <div className="py-2">
                <p className="text-[10px] leading-5 text-muted-foreground">
                  SoStats will remove the encrypted access/refresh credentials and
                  mark this account disconnected. Historical schedules,
                  publication results and analytics remain intact.
                </p>
                <div className="mt-3 rounded-xl bg-amber-50 p-3 text-[9px] leading-4 text-amber-800">
                  Reconnecting later uses the normal OAuth flow and reactivates
                  the existing provider account record when the provider account
                  id matches.
                </div>
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setConfirmDisconnect(null)}
                  disabled={Boolean(busy)}
                  className="rounded-xl"
                >
                  Keep connected
                </Button>
                <Button
                  onClick={() => void disconnect()}
                  disabled={Boolean(busy)}
                  className="rounded-xl bg-red-600 hover:bg-red-700"
                >
                  {busy === `disconnect-${confirmDisconnect.id}` ? (
                    <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <LogOut className="mr-2 h-4 w-4" />
                  )}
                  Disconnect credentials
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function HealthMetric({
  icon: Icon,
  label,
  value,
  active,
}: {
  icon: typeof CheckCircle2;
  label: string;
  value: string;
  active: boolean;
}) {
  return (
    <div className="rounded-xl border border-black/[0.05] bg-neutral-50 p-3">
      <div className="flex items-center gap-1.5">
        <Icon
          className={
            active ? "h-3 w-3 text-emerald-600" : "h-3 w-3 text-neutral-400"
          }
        />
        <p className="text-[7px] uppercase tracking-[0.07em] text-muted-foreground">
          {label}
        </p>
      </div>
      <p
        className={
          active
            ? "mt-1.5 text-[9px] font-semibold text-neutral-700"
            : "mt-1.5 text-[9px] font-semibold text-neutral-400"
        }
      >
        {value}
      </p>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[7px] uppercase tracking-[0.07em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 truncate text-[8px] font-semibold text-neutral-600">
        {value}
      </p>
    </div>
  );
}
