"use client";

import { useState } from "react";
import { Link2, LoaderCircle, Plus, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SocialProviderRecord } from "@/lib/sostats-api.server";

type BrandOption = {
  id: number;
  name: string;
};

function providerLabel(value: string) {
  if (value.toLowerCase() === "x") return "X";
  if (value.toLowerCase() === "linkedin") return "LinkedIn";
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function capabilitySummary(provider: SocialProviderRecord) {
  const parts = [];
  if (provider.capabilities.text) parts.push("text");
  if (provider.capabilities.images) parts.push("images");
  if (provider.capabilities.video) parts.push("video");
  if (provider.capabilities.carousel) parts.push("carousel");
  if (provider.capabilities.analytics) parts.push("analytics");
  if (provider.capabilities.requiresMedia) parts.push("media required");
  return parts.length ? parts.join(" + ") : "No exposed capabilities";
}

export function ChannelConnectPanel({
  workspaceSlug,
  brands,
  providers,
  connectedProviders,
}: {
  workspaceSlug: string;
  brands: BrandOption[];
  providers: SocialProviderRecord[];
  connectedProviders: string[];
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [brandId, setBrandId] = useState(
    brands[0]?.id ? String(brands[0].id) : "",
  );

  const connect = async (provider: string) => {
    if (!brandId) {
      setError("Create or select a Brand Brain profile before connecting a channel.");
      return;
    }

    setBusy(provider);
    setError(null);

    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/channels/oauth/${encodeURIComponent(provider)}/start`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            brandId: Number(brandId),
            returnTo: `/${workspaceSlug}/channels`,
          }),
        },
      );
      const payload = (await response.json()) as {
        authorizationUrl?: string;
        error?: string;
      };
      if (!response.ok || !payload.authorizationUrl) {
        throw new Error(payload.error || "Unable to start OAuth connection");
      }

      window.location.assign(payload.authorizationUrl);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to start OAuth connection",
      );
      setBusy(null);
    }
  };

  return (
    <section className="sostats-card overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-black/[0.055] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold">Provider catalog</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            Only adapters registered in SoStats are shown as connectable providers.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {brands.length > 0 && (
            <select
              value={brandId}
              onChange={(event) => setBrandId(event.target.value)}
              className="h-9 rounded-xl border border-black/[0.06] bg-neutral-50 px-3 text-[9px] font-semibold text-neutral-600 outline-none"
            >
              {brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                </option>
              ))}
            </select>
          )}
          <Plus className="h-4 w-4 text-[#ef2b2d]" />
        </div>
      </div>

      <div className="grid gap-3 p-4 md:grid-cols-2">
        {providers.map((provider) => {
          const connected = connectedProviders.includes(
            provider.provider.toLowerCase(),
          );
          const loading = busy === provider.provider;

          return (
            <div
              key={provider.provider}
              className="rounded-2xl border border-black/[0.055] bg-neutral-50/60 p-4"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-neutral-950 text-white">
                  {provider.provider === "x" ? (
                    <span className="text-[14px] font-bold">X</span>
                  ) : (
                    <Link2 className="h-4 w-4" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[11px] font-semibold">
                      {providerLabel(provider.provider)}
                    </p>
                    <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1 text-[7px] font-semibold text-emerald-700">
                      <ShieldCheck className="h-2.5 w-2.5" />
                      Adapter enabled
                    </span>
                  </div>
                  <p className="mt-1 text-[8px] leading-4 text-muted-foreground">
                    {capabilitySummary(provider)}
                  </p>
                  <p className="mt-1 text-[8px] text-muted-foreground">
                    OAuth {provider.oauth?.pkce ? "with PKCE S256" : "authorization code"}
                  </p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2">
                <Capability
                  label="Publish"
                  active={provider.capabilities.text}
                />
                <Capability
                  label="Analytics"
                  active={provider.capabilities.analytics}
                />
                <Capability
                  label="Media"
                  active={
                    provider.capabilities.images || provider.capabilities.video
                  }
                />
              </div>

              {provider.capabilities.requiresMedia && (
                <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[8px] leading-4 text-amber-800">
                  Publishing requires media
                  {provider.capabilities.mediaMimeTypes?.length
                    ? ` · ${provider.capabilities.mediaMimeTypes.join(", ")}`
                    : ""}
                  {provider.capabilities.maxMediaItems
                    ? ` · max ${provider.capabilities.maxMediaItems}`
                    : ""}
                </p>
              )}

              <Button
                variant={connected ? "outline" : "default"}
                disabled={Boolean(busy) || !brandId}
                onClick={() => void connect(provider.provider)}
                className={
                  connected
                    ? "mt-4 h-9 w-full rounded-xl text-[8px]"
                    : "mt-4 h-9 w-full rounded-xl bg-[#ef2b2d] text-[8px] hover:bg-[#da2427]"
                }
              >
                {loading && (
                  <LoaderCircle className="mr-1.5 h-3 w-3 animate-spin" />
                )}
                {loading
                  ? "Opening OAuth..."
                  : connected
                    ? "Connect another / reconnect"
                    : "Connect provider"}
              </Button>
            </div>
          );
        })}

        {!providers.length && (
          <div className="col-span-full rounded-xl border border-dashed border-black/[0.08] p-8 text-center text-[10px] text-muted-foreground">
            No provider adapters are registered in the API.
          </div>
        )}
      </div>

      {error && (
        <div className="border-t border-red-100 bg-red-50 px-5 py-3 text-[9px] text-red-700">
          {error}
        </div>
      )}
    </section>
  );
}

function Capability({
  label,
  active,
}: {
  label: string;
  active: boolean;
}) {
  return (
    <div className="rounded-xl bg-white p-2.5 text-center">
      <p className="text-[7px] uppercase tracking-[0.07em] text-muted-foreground">
        {label}
      </p>
      <p
        className={
          active
            ? "mt-1 text-[8px] font-semibold text-emerald-600"
            : "mt-1 text-[8px] font-semibold text-neutral-400"
        }
      >
        {active ? "Ready" : "Not supported"}
      </p>
    </div>
  );
}