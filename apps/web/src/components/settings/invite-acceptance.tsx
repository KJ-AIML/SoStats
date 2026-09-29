"use client";

import { useState } from "react";
import {
  CheckCircle2,
  LoaderCircle,
  ShieldCheck,
  UserPlus,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";

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

export function InviteAcceptance({
  token,
  preview,
}: {
  token: string;
  preview: InvitePreview;
}) {
  const [busy, setBusy] = useState<"accept" | "reject" | null>(null);
  const [status, setStatus] = useState(preview.status);
  const [error, setError] = useState<string | null>(null);
  const [acceptedWorkspace, setAcceptedWorkspace] = useState<{
    name: string;
    slug: string;
  } | null>(null);

  const act = async (action: "accept" | "reject") => {
    setBusy(action);
    setError(null);

    try {
      const response = await fetch(
        `/api/invitations/${encodeURIComponent(token)}/${action}`,
        { method: "POST" },
      );
      const payload = (await response.json()) as {
        error?: string;
        status?: string;
        workspace?: { name: string; slug: string };
      };
      if (!response.ok) {
        throw new Error(payload.error || `Unable to ${action} invitation`);
      }

      setStatus(payload.status || action === "accept" ? "accepted" : "rejected");
      if (action === "accept" && payload.workspace) {
        setAcceptedWorkspace(payload.workspace);
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : `Unable to ${action} invitation`,
      );
    } finally {
      setBusy(null);
    }
  };

  const pending = status === "pending";

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[720px] items-center px-4 py-10">
      <section className="w-full overflow-hidden rounded-[28px] border border-black/[0.07] bg-white shadow-[0_28px_90px_rgba(0,0,0,0.08)]">
        <div className="relative overflow-hidden bg-neutral-950 px-6 py-8 text-white sm:px-8">
          <div className="absolute -right-10 -top-20 h-48 w-48 rounded-full bg-[#ef2b2d] opacity-40 blur-3xl" />
          <div className="relative z-10">
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10">
              <UserPlus className="h-5 w-5" />
            </div>
            <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-white/45">
              SoStats workspace invitation
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-[-0.04em]">
              Join {preview.workspace.name}
            </h1>
            <p className="mt-2 max-w-lg text-[10px] leading-5 text-white/55">
              This secure invitation grants the invited identity a{" "}
              <span className="font-semibold text-white/80">{preview.role}</span>{" "}
              workspace membership after acceptance.
            </p>
          </div>
        </div>

        <div className="space-y-5 p-6 sm:p-8">
          <div className="grid gap-3 sm:grid-cols-3">
            <Info label="Invited identity" value={preview.email} />
            <Info label="Role" value={preview.role} />
            <Info
              label="Expires"
              value={new Intl.DateTimeFormat("en", {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(preview.expiresAt))}
            />
          </div>

          <div className="flex items-start gap-3 rounded-2xl bg-neutral-50 p-4">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <p className="text-[9px] leading-5 text-muted-foreground">
              The raw invitation token is not stored by SoStats. Acceptance only
              provisions membership for the invited email. Workspace access still
              requires authentication with that verified email identity.
            </p>
          </div>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[9px] text-red-700">
              {error}
            </div>
          )}

          {pending ? (
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                disabled={Boolean(busy)}
                onClick={() => void act("reject")}
                className="h-10 rounded-xl text-[9px]"
              >
                {busy === "reject" ? (
                  <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <XCircle className="mr-1.5 h-3.5 w-3.5" />
                )}
                Decline invitation
              </Button>
              <Button
                disabled={Boolean(busy)}
                onClick={() => void act("accept")}
                className="h-10 rounded-xl bg-[#ef2b2d] px-5 text-[9px] hover:bg-[#da2427]"
              >
                {busy === "accept" ? (
                  <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                )}
                Accept invitation
              </Button>
            </div>
          ) : (
            <div
              className={
                status === "accepted"
                  ? "rounded-2xl border border-emerald-200 bg-emerald-50 p-4"
                  : "rounded-2xl border border-neutral-200 bg-neutral-50 p-4"
              }
            >
              <div className="flex items-start gap-3">
                {status === "accepted" ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" />
                )}
                <div>
                  <p className="text-[10px] font-semibold capitalize">
                    Invitation {status}
                  </p>
                  <p className="mt-1 text-[9px] leading-5 text-muted-foreground">
                    {status === "accepted"
                      ? `Membership for the invited email is provisioned in ${acceptedWorkspace?.name || preview.workspace.name}. Sign in with that verified email identity to access the workspace.`
                      : "This invitation can no longer provision workspace access. Ask the workspace owner for a new link if needed."}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-black/[0.055] p-4">
      <p className="text-[7px] uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 break-words text-[9px] font-semibold capitalize">
        {value}
      </p>
    </div>
  );
}
