"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Save,
  ShieldCheck,
  Trash2,
  UserCog,
  Users,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { WorkspaceSettingsRecord } from "@/lib/sostats-api.server";

export function WorkspaceSettings({
  workspaceSlug,
  initialSettings,
}: {
  workspaceSlug: string;
  initialSettings: WorkspaceSettingsRecord;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialSettings.workspace.name);
  const [timezone, setTimezone] = useState(initialSettings.workspace.timezone);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<number | null>(null);

  const saveWorkspace = async () => {
    setBusy("workspace");
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/settings`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, timezone }),
        },
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to save workspace settings");
      }
      setMessage("Workspace settings saved.");
      router.refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to save workspace settings",
      );
    } finally {
      setBusy(null);
    }
  };

  const updateRole = async (memberId: number, role: string) => {
    setBusy(`role-${memberId}`);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/settings/members/${memberId}/role`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role }),
        },
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to update member role");
      }
      setMessage("Member role updated.");
      router.refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to update member role",
      );
    } finally {
      setBusy(null);
    }
  };

  const removeMember = async (memberId: number) => {
    setBusy(`remove-${memberId}`);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/settings/members/${memberId}`,
        { method: "DELETE" },
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to remove member");
      }
      setConfirmRemove(null);
      setMessage("Workspace member removed.");
      router.refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to remove member",
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      {(error || message) && (
        <div
          className={
            error
              ? "flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[9px] text-red-700"
              : "flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[9px] text-emerald-700"
          }
        >
          {error ? (
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          ) : (
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
          {error || message}
        </div>
      )}

      <section className="sostats-card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-black/[0.055] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold">Workspace</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Persisted identity and IANA timezone used by scheduling/read models.
            </p>
          </div>
          <Button
            onClick={() => void saveWorkspace()}
            disabled={
              !initialSettings.permissions.canManageWorkspace ||
              busy === "workspace"
            }
            className="h-9 rounded-xl bg-[#ef2b2d] text-[9px] hover:bg-[#da2427]"
          >
            {busy === "workspace" ? (
              <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="mr-1.5 h-3.5 w-3.5" />
            )}
            Save workspace
          </Button>
        </div>

        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Workspace name">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={!initialSettings.permissions.canManageWorkspace}
              className="rounded-xl"
            />
          </Field>
          <Field label="Workspace slug">
            <Input
              value={initialSettings.workspace.slug}
              readOnly
              className="rounded-xl bg-neutral-100 text-neutral-500"
            />
          </Field>
          <Field label="Timezone">
            <Input
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              disabled={!initialSettings.permissions.canManageWorkspace}
              placeholder="Asia/Bangkok"
              className="rounded-xl"
            />
          </Field>
          <Field label="Your workspace role">
            <Input
              value={initialSettings.workspace.role || "member"}
              readOnly
              className="rounded-xl bg-neutral-100 capitalize text-neutral-500"
            />
          </Field>
        </div>

        {!initialSettings.permissions.canManageWorkspace && (
          <div className="border-t border-black/[0.055] bg-neutral-50 px-5 py-3 text-[9px] text-muted-foreground">
            Only workspace owners and admins can change identity/timezone.
          </div>
        )}
      </section>

      <section className="sostats-card overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-black/[0.055] px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-[#ef2b2d]" />
              <p className="text-sm font-semibold">Team & roles</p>
            </div>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Membership is persisted in workspace_members. Owners control role changes and removals.
            </p>
          </div>
          <span className="rounded-lg bg-neutral-100 px-2.5 py-1.5 text-[8px] font-semibold text-neutral-500">
            {initialSettings.members.length} member
            {initialSettings.members.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="divide-y divide-black/[0.045]">
          {initialSettings.members.map((member) => {
            const isOwner = member.role === "owner";
            const canManage =
              initialSettings.permissions.canManageMembers && !isOwner;
            return (
              <div
                key={member.id}
                className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_150px_170px]"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-950 text-[9px] font-bold text-white">
                    {(member.name || member.email || "U")
                      .slice(0, 2)
                      .toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-[10px] font-semibold">
                        {member.name || "Unnamed user"}
                      </p>
                      {member.isCurrentUser && (
                        <span className="rounded-md bg-blue-50 px-2 py-1 text-[7px] font-semibold text-blue-700">
                          You
                        </span>
                      )}
                      {isOwner && (
                        <span className="rounded-md bg-amber-50 px-2 py-1 text-[7px] font-semibold text-amber-700">
                          Owner
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-[8px] text-muted-foreground">
                      {member.email || "Email unavailable"}
                    </p>
                  </div>
                </div>

                <div>
                  <p className="mb-1 text-[7px] uppercase tracking-[0.08em] text-muted-foreground">
                    Role
                  </p>
                  {canManage ? (
                    <select
                      value={member.role}
                      disabled={Boolean(busy)}
                      onChange={(event) =>
                        void updateRole(member.id, event.target.value)
                      }
                      className="h-9 w-full rounded-xl border border-black/[0.06] bg-neutral-50 px-3 text-[8px] font-semibold capitalize outline-none"
                    >
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                    </select>
                  ) : (
                    <div className="flex h-9 items-center rounded-xl bg-neutral-50 px-3 text-[8px] font-semibold capitalize text-neutral-600">
                      {member.role}
                    </div>
                  )}
                </div>

                <div className="flex items-end justify-end gap-2">
                  {canManage &&
                    (confirmRemove === member.id ? (
                      <>
                        <Button
                          variant="outline"
                          disabled={Boolean(busy)}
                          onClick={() => setConfirmRemove(null)}
                          className="h-9 rounded-xl text-[8px]"
                        >
                          Keep
                        </Button>
                        <Button
                          disabled={Boolean(busy)}
                          onClick={() => void removeMember(member.id)}
                          className="h-9 rounded-xl bg-red-600 text-[8px] hover:bg-red-700"
                        >
                          {busy === `remove-${member.id}` ? (
                            <LoaderCircle className="mr-1.5 h-3 w-3 animate-spin" />
                          ) : (
                            <Trash2 className="mr-1.5 h-3 w-3" />
                          )}
                          Remove
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="outline"
                        disabled={Boolean(busy)}
                        onClick={() => setConfirmRemove(member.id)}
                        className="h-9 rounded-xl text-[8px] text-red-700"
                      >
                        <Trash2 className="mr-1.5 h-3 w-3" />
                        Remove
                      </Button>
                    ))}
                  {!canManage && (
                    <span className="text-[8px] text-muted-foreground">
                      {isOwner
                        ? "Ownership transfer not implemented"
                        : "Owner permission required"}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="border-t border-black/[0.055] bg-neutral-50 px-5 py-3 text-[9px] leading-4 text-muted-foreground">
          Invitations are intentionally not shown as an action because the current data model has no invitation lifecycle. Members shown here already have persisted user + workspace membership records.
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="sostats-card overflow-hidden">
          <div className="border-b border-black/[0.055] px-5 py-4">
            <div className="flex items-center gap-2">
              <LockKeyhole className="h-4 w-4 text-[#ef2b2d]" />
              <p className="text-sm font-semibold">Authentication & security</p>
            </div>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Sanitized runtime capability state; no issuer, audience or secret values are exposed.
            </p>
          </div>

          <div className="grid gap-px bg-black/[0.045] sm:grid-cols-2">
            <SecurityCell
              label="Auth mode"
              value={
                initialSettings.security.authMode === "development_bypass"
                  ? "Development bypass"
                  : "Bearer JWT"
              }
              healthy={!initialSettings.security.developmentBypassEnabled}
            />
            <SecurityCell
              label="Production token"
              value={
                initialSettings.security.productionRequiresBearerToken
                  ? "Required"
                  : "Not required"
              }
              healthy={initialSettings.security.productionRequiresBearerToken}
            />
            <SecurityCell
              label="JWT issuer config"
              value={
                initialSettings.security.jwtIssuerConfigured
                  ? "Configured"
                  : "Not configured"
              }
              healthy={initialSettings.security.jwtIssuerConfigured}
            />
            <SecurityCell
              label="JWT audience config"
              value={
                initialSettings.security.jwtAudienceConfigured
                  ? "Configured"
                  : "Not configured"
              }
              healthy={initialSettings.security.jwtAudienceConfigured}
            />
          </div>

          {initialSettings.security.developmentBypassEnabled && (
            <div className="border-t border-amber-100 bg-amber-50 px-5 py-3 text-[9px] leading-4 text-amber-800">
              Development auth bypass is active in this non-production environment. The API guard explicitly disables that path in production.
            </div>
          )}
        </section>

        <section className="sostats-card overflow-hidden">
          <div className="border-b border-black/[0.055] px-5 py-4">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-[#ef2b2d]" />
              <p className="text-sm font-semibold">Settings capability matrix</p>
            </div>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Product controls appear only when a persistence/runtime boundary exists.
            </p>
          </div>

          <div className="divide-y divide-black/[0.045]">
            {[
              [
                "Team roles",
                initialSettings.productCapabilities.teamRoles,
                "Owner/admin/member membership roles",
              ],
              [
                "Workspace timezone",
                initialSettings.productCapabilities.workspaceTimezone,
                "Persisted IANA timezone",
              ],
              [
                "Invitations",
                initialSettings.productCapabilities.invitations,
                "No invitation lifecycle table/service yet",
              ],
              [
                "API keys",
                initialSettings.productCapabilities.apiKeys,
                "Bearer auth exists; user-managed API key lifecycle does not",
              ],
              [
                "Notification preferences",
                initialSettings.productCapabilities.notificationPreferences,
                "No persisted notification preference model yet",
              ],
              [
                "Audit log",
                initialSettings.productCapabilities.auditLog,
                "No immutable audit-event store yet",
              ],
              [
                "Workspace publish policy",
                initialSettings.productCapabilities.workspacePublishPolicy,
                "Review state exists in Content/Automations; no mutable workspace policy record",
              ],
            ].map(([label, available, detail]) => (
              <div
                key={String(label)}
                className="flex items-start gap-3 px-5 py-3.5"
              >
                {available ? (
                  <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                ) : (
                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-300" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[9px] font-semibold">{String(label)}</p>
                    <span
                      className={
                        available
                          ? "rounded-md bg-emerald-50 px-2 py-1 text-[7px] font-semibold text-emerald-700"
                          : "rounded-md bg-neutral-100 px-2 py-1 text-[7px] font-semibold text-neutral-500"
                      }
                    >
                      {available ? "Available" : "Not implemented"}
                    </span>
                  </div>
                  <p className="mt-1 text-[8px] leading-4 text-muted-foreground">
                    {String(detail)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="sostats-card p-5">
        <div className="flex items-start gap-3">
          <div className="sostats-icon">
            <UserCog className="h-4 w-4 text-neutral-500" />
          </div>
          <div>
            <p className="text-[10px] font-semibold">Administrative boundary</p>
            <p className="mt-1 max-w-4xl text-[9px] leading-5 text-muted-foreground">
              This Stage 12 surface completes the settings UX over capabilities SoStats already owns. Invitations, API-key lifecycle, notifications, immutable audit logs and ownership transfer belong to the later identity/hardening stage and are deliberately represented as unavailable rather than simulated.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label>
      <span className="mb-1.5 block text-[9px] font-semibold text-neutral-600">
        {label}
      </span>
      {children}
    </label>
  );
}

function SecurityCell({
  label,
  value,
  healthy,
}: {
  label: string;
  value: string;
  healthy: boolean;
}) {
  return (
    <div className="bg-white p-5">
      <div className="flex items-center gap-2">
        {healthy ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
        ) : (
          <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
        )}
        <p className="text-[8px] uppercase tracking-[0.08em] text-muted-foreground">
          {label}
        </p>
      </div>
      <p className="mt-2 text-[10px] font-semibold">{value}</p>
    </div>
  );
}
