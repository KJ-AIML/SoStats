"use client";

import { useState } from "react";
import { Linkedin, LoaderCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

const providers = [
  {
    id: "linkedin",
    label: "LinkedIn",
    description: "Text publishing + member post analytics",
    icon: Linkedin,
  },
  {
    id: "x",
    label: "X",
    description: "Text publishing + post engagement metrics",
    icon: null,
  },
] as const;

export function ChannelConnectPanel({
  workspaceSlug,
  brandId,
  connectedProviders,
}: {
  workspaceSlug: string;
  brandId?: number;
  connectedProviders: string[];
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connect = async (provider: string) => {
    if (!brandId) {
      setError("Create a Brand Brain profile before connecting a channel.");
      return;
    }

    setBusy(provider);
    setError(null);

    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/channels/${encodeURIComponent(provider)}/oauth/start`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            brandId,
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
      <div className="flex items-center justify-between border-b border-black/[0.055] px-5 py-4">
        <div>
          <p className="text-sm font-semibold">Add a publishing channel</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            OAuth is handled server-side with encrypted state. Provider tokens never enter the browser.
          </p>
        </div>
        <Plus className="h-4 w-4 text-[#ef2b2d]" />
      </div>

      <div className="grid gap-3 p-4 md:grid-cols-2">
        {providers.map((provider) => {
          const connected = connectedProviders.includes(provider.id);
          const loading = busy === provider.id;
          const Icon = provider.icon;

          return (
            <div
              key={provider.id}
              className="flex items-center gap-3 rounded-2xl border border-black/[0.055] bg-neutral-50/60 p-4"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-neutral-950 text-white">
                {Icon ? (
                  <Icon className="h-4 w-4" />
                ) : (
                  <span className="text-[14px] font-bold">X</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold">{provider.label}</p>
                <p className="mt-0.5 text-[8px] leading-4 text-muted-foreground">
                  {provider.description}
                </p>
              </div>
              <Button
                variant={connected ? "outline" : "default"}
                disabled={Boolean(busy) || !brandId}
                onClick={() => void connect(provider.id)}
                className={
                  connected
                    ? "h-9 rounded-xl text-[8px]"
                    : "h-9 rounded-xl bg-[#ef2b2d] text-[8px] hover:bg-[#da2427]"
                }
              >
                {loading && (
                  <LoaderCircle className="mr-1.5 h-3 w-3 animate-spin" />
                )}
                {loading
                  ? "Opening..."
                  : connected
                    ? "Reconnect"
                    : "Connect"}
              </Button>
            </div>
          );
        })}
      </div>

      {error && (
        <div className="border-t border-red-100 bg-red-50 px-5 py-3 text-[9px] text-red-700">
          {error}
        </div>
      )}
    </section>
  );
}
