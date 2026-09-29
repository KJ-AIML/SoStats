"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Crown,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  MailPlus,
  RefreshCw,
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
  const [confirmTransfer, setConfirmTransfer] = useState<number | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [apiKeyName, setApiKeyName] = useState("");
  const [apiKeyRead, setApiKeyRead] = useState(true);
  const [apiKeyWrite, setApiKeyWrite] = useState(false);
  const [apiKeyExpiry, setApiKeyExpiry] = useState("90");
  const [revealedApiKey, setRevealedApiKey] = useState<string | null>(null);

  const createInvitation = async () => {
    if (!inviteEmail.trim()) {
      setError("Add an email address before creating an invitation.");
      return;
    }

    setBusy("invite-create");
    setError(null);
    setMessage(null);
    setInviteLink(null);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/settings/invitations`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: inviteEmail.trim(),
            role: inviteRole,
          }),
        },
      );
      const payload = (await response.json()) as {
        inviteUrl?: string;
        error?: string;
      };
      if (!response.ok || !payload.inviteUrl) {
        throw new Error(payload.error || "Unable to create invitation");
      }

      setInviteLink(payload.inviteUrl);
      setInviteEmail("");
      setMessage(
        "Invitation created. Copy the secure link below and send it to the invited person.",
      );
      router.refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to create invitation",
      );
    } finally {
      setBusy(null);
    }
  };

  const regenerateInvitation = async (invitationId: number) => {
    setBusy(`invite-regenerate-${invitationId}`);
    setError(null);
    setMessage(null);
    setInviteLink(null);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/settings/invitations/${invitationId}/regenerate`,
        { method: "POST" },
      );
      const payload = (await response.json()) as {
        inviteUrl?: string;
        error?: string;
      };
      if (!response.ok || !payload.inviteUrl) {
        throw new Error(payload.error || "Unable to regenerate invitation");
      }

      setInviteLink(payload.inviteUrl);
      setMessage(
        "A new invitation link was generated. The previous link is now invalid.",
      );
      router.refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to regenerate invitation",
      );
    } finally {
      setBusy(null);
    }
  };

  const revokeInvitation = async (invitationId: number) => {
    setBusy(`invite-revoke-${invitationId}`);
    setError(null);
    setMessage(null);
    setInviteLink(null);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/settings/invitations/${invitationId}`,
        { method: "DELETE" },
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to revoke invitation");
      }

      setMessage("Invitation revoked.");
      router.refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to revoke invitation",
      );
    } finally {
      setBusy(null);
    }
  };

  const copyInviteLink = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setMessage("Invitation link copied to clipboard.");
    } catch {
      setError("Clipboard access failed. Copy the invitation link manually.");
    }
  };

  const createApiKey = async () => {
    const scopes = [
      ...(apiKeyRead ? ["workspace:read"] : []),
      ...(apiKeyWrite ? ["workspace:write"] : []),
    ];

    if (!apiKeyName.trim()) {
      setError("Add a name before creating an API key.");
      return;
    }
    if (!scopes.length) {
      setError("Select at least one API key scope.");
      return;
    }

    setBusy("api-key-create");
    setError(null);
    setMessage(null);
    setRevealedApiKey(null);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/settings/api-keys`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: apiKeyName.trim(),
            scopes,
            expiresInDays: Number(apiKeyExpiry),
          }),
        },
      );
      const payload = (await response.json()) as {
        token?: string;
        error?: string;
      };
      if (!response.ok || !payload.token) {
        throw new Error(payload.error || "Unable to create API key");
      }

      setRevealedApiKey(payload.token);
      setApiKeyName("");
      setMessage(
        "API key created. Copy it now — the raw secret will not be shown again.",
      );
      router.refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to create API key",
      );
    } finally {
      setBusy(null);
    }
  };

  const rotateApiKey = async (keyId: number) => {
    setBusy(`api-key-rotate-${keyId}`);
    setError(null);
    setMessage(null);
    setRevealedApiKey(null);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/settings/api-keys/${keyId}/rotate`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expiresInDays: Number(apiKeyExpiry),
          }),
        },
      );
      const payload = (await response.json()) as {
        token?: string;
        error?: string;
      };
      if (!response.ok || !payload.token) {
        throw new Error(payload.error || "Unable to rotate API key");
      }

      setRevealedApiKey(payload.token);
      setMessage(
        "API key rotated. The previous token is invalid; copy the new token now.",
      );
      router.refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to rotate API key",
      );
    } finally {
      setBusy(null);
    }
  };

  const revokeApiKey = async (keyId: number) => {
    setBusy(`api-key-revoke-${keyId}`);
    setError(null);
    setMessage(null);
    setRevealedApiKey(null);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/settings/api-keys/${keyId}`,
        { method: "DELETE" },
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to revoke API key");
      }

      setMessage("API key revoked.");
      router.refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to revoke API key",
      );
    } finally {
      setBusy(null);
    }
  };

  const copyApiKey = async () => {
    if (!revealedApiKey) return;
    try {
      await navigator.clipboard.writeText(revealedApiKey);
      setMessage("API key copied to clipboard.");
    } catch {
      setError("Clipboard access failed. Copy the API key manually.");
    }
  };

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

  const transferOwnership = async (memberId: number) => {
    setBusy(`transfer-${memberId}`);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/settings/ownership-transfer`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            targetMemberId: memberId,
            previousOwnerRole: "admin",
          }),
        },
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to transfer ownership");
      }

      setConfirmTransfer(null);
      setMessage(
        "Workspace ownership transferred. Your role is now admin.",
      );
      router.refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to transfer ownership",
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
        <div className="flex flex-col gap-3 border-b border-black/[0.055] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <MailPlus className="h-4 w-4 text-[#ef2b2d]" />
              <p className="text-sm font-semibold">Workspace invitations</p>
            </div>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Create expiring bearer links. Raw tokens are shown only when created or regenerated and are stored as hashes in the API.
            </p>
          </div>
          <span className="rounded-lg bg-neutral-100 px-2.5 py-1.5 text-[8px] font-semibold text-neutral-500">
            {initialSettings.invitations.filter((invite) => invite.status === "pending").length} pending
          </span>
        </div>

        {initialSettings.permissions.canManageInvitations ? (
          <div className="border-b border-black/[0.055] p-5">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_150px_auto]">
              <Field label="Invite email">
                <Input
                  type="email"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  placeholder="teammate@example.com"
                  className="rounded-xl"
                />
              </Field>

              <Field label="Role">
                <select
                  value={inviteRole}
                  onChange={(event) => setInviteRole(event.target.value)}
                  className="h-10 w-full rounded-xl border border-black/[0.06] bg-neutral-50 px-3 text-[9px] font-semibold outline-none"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </Field>

              <div className="flex items-end">
                <Button
                  onClick={() => void createInvitation()}
                  disabled={Boolean(busy) || !inviteEmail.trim()}
                  className="h-10 w-full rounded-xl bg-[#ef2b2d] px-4 text-[9px] hover:bg-[#da2427] md:w-auto"
                >
                  {busy === "invite-create" ? (
                    <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <MailPlus className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Create invite
                </Button>
              </div>
            </div>

            {inviteLink && (
              <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                <p className="text-[9px] font-semibold text-emerald-800">
                  Secure invitation link
                </p>
                <p className="mt-1 break-all text-[8px] leading-4 text-emerald-700">
                  {inviteLink}
                </p>
                <Button
                  variant="outline"
                  onClick={() => void copyInviteLink()}
                  className="mt-3 h-8 rounded-xl border-emerald-200 bg-white text-[8px] text-emerald-800"
                >
                  <Copy className="mr-1.5 h-3 w-3" />
                  Copy link
                </Button>
              </div>
            )}

            <p className="mt-3 text-[8px] leading-4 text-muted-foreground">
              Email delivery is not implemented yet. SoStats generates the secure lifecycle and link; send the link through a trusted channel. Regenerating a link invalidates the previous token.
            </p>
          </div>
        ) : (
          <div className="border-b border-black/[0.055] bg-neutral-50 px-5 py-3 text-[9px] text-muted-foreground">
            Only the workspace owner can create, regenerate or revoke invitations.
          </div>
        )}

        <div className="divide-y divide-black/[0.045]">
          {initialSettings.invitations.length ? (
            initialSettings.invitations.map((invitation) => {
              const actionable = ["pending", "expired"].includes(
                invitation.status,
              );
              return (
                <div
                  key={invitation.id}
                  className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_110px_150px_210px]"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-[10px] font-semibold">
                        {invitation.email}
                      </p>
                      <span className="rounded-md bg-neutral-100 px-2 py-1 text-[7px] font-semibold capitalize text-neutral-600">
                        {invitation.role}
                      </span>
                    </div>
                    <p className="mt-1 text-[8px] text-muted-foreground">
                      Invited by {invitation.invitedBy?.name || invitation.invitedBy?.email || "workspace owner"}
                    </p>
                  </div>

                  <div>
                    <p className="text-[7px] uppercase tracking-[0.08em] text-muted-foreground">
                      Status
                    </p>
                    <p
                      className={
                        invitation.status === "pending"
                          ? "mt-1 text-[8px] font-semibold text-blue-700"
                          : invitation.status === "accepted"
                            ? "mt-1 text-[8px] font-semibold text-emerald-700"
                            : "mt-1 text-[8px] font-semibold capitalize text-neutral-500"
                      }
                    >
                      {invitation.status}
                    </p>
                  </div>

                  <div>
                    <p className="text-[7px] uppercase tracking-[0.08em] text-muted-foreground">
                      Expires
                    </p>
                    <p className="mt-1 text-[8px] font-semibold text-neutral-600">
                      {new Intl.DateTimeFormat("en", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(invitation.expiresAt))}
                    </p>
                  </div>

                  <div className="flex items-center justify-end gap-2">
                    {initialSettings.permissions.canManageInvitations &&
                      actionable && (
                        <>
                          <Button
                            variant="outline"
                            disabled={Boolean(busy)}
                            onClick={() =>
                              void regenerateInvitation(invitation.id)
                            }
                            className="h-8 rounded-xl text-[8px]"
                          >
                            {busy ===
                            `invite-regenerate-${invitation.id}` ? (
                              <LoaderCircle className="mr-1.5 h-3 w-3 animate-spin" />
                            ) : (
                              <RefreshCw className="mr-1.5 h-3 w-3" />
                            )}
                            New link
                          </Button>
                          <Button
                            variant="outline"
                            disabled={Boolean(busy)}
                            onClick={() => void revokeInvitation(invitation.id)}
                            className="h-8 rounded-xl border-red-100 text-[8px] text-red-700"
                          >
                            Revoke
                          </Button>
                        </>
                      )}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="px-5 py-8 text-center text-[9px] text-muted-foreground">
              No workspace invitations yet.
            </div>
          )}
        </div>
      </section>

      <section className="sostats-card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-black/[0.055] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-[#ef2b2d]" />
              <p className="text-sm font-semibold">Workspace API keys</p>
            </div>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Owner-managed credentials for workspace-scoped API access. Secrets are shown only on create or rotate and stored as hashes.
            </p>
          </div>
          <span className="rounded-lg bg-neutral-100 px-2.5 py-1.5 text-[8px] font-semibold text-neutral-500">
            {initialSettings.apiKeys.filter((key) => key.status === "active").length} active
          </span>
        </div>

        {initialSettings.permissions.canManageApiKeys ? (
          <div className="border-b border-black/[0.055] p-5">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_150px_minmax(240px,1fr)_auto]">
              <Field label="Key name">
                <Input
                  value={apiKeyName}
                  onChange={(event) => setApiKeyName(event.target.value)}
                  placeholder="Reporting integration"
                  className="rounded-xl"
                />
              </Field>

              <Field label="Expiry">
                <select
                  value={apiKeyExpiry}
                  onChange={(event) => setApiKeyExpiry(event.target.value)}
                  className="h-10 w-full rounded-xl border border-black/[0.06] bg-neutral-50 px-3 text-[9px] font-semibold outline-none"
                >
                  <option value="30">30 days</option>
                  <option value="90">90 days</option>
                  <option value="180">180 days</option>
                  <option value="365">365 days</option>
                </select>
              </Field>

              <Field label="Scopes">
                <div className="flex min-h-10 flex-wrap items-center gap-4 rounded-xl border border-black/[0.06] bg-neutral-50 px-3 py-2">
                  <label className="flex items-center gap-2 text-[8px] font-semibold">
                    <input
                      type="checkbox"
                      checked={apiKeyRead}
                      onChange={(event) => setApiKeyRead(event.target.checked)}
                    />
                    workspace:read
                  </label>
                  <label className="flex items-center gap-2 text-[8px] font-semibold">
                    <input
                      type="checkbox"
                      checked={apiKeyWrite}
                      onChange={(event) => setApiKeyWrite(event.target.checked)}
                    />
                    workspace:write
                  </label>
                </div>
              </Field>

              <div className="flex items-end">
                <Button
                  onClick={() => void createApiKey()}
                  disabled={Boolean(busy) || !apiKeyName.trim()}
                  className="h-10 w-full rounded-xl bg-[#ef2b2d] px-4 text-[9px] hover:bg-[#da2427] lg:w-auto"
                >
                  {busy === "api-key-create" ? (
                    <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <KeyRound className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Create key
                </Button>
              </div>
            </div>

            {revealedApiKey && (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-[9px] font-semibold text-amber-900">
                  Copy this secret now
                </p>
                <p className="mt-1 break-all font-mono text-[8px] leading-4 text-amber-800">
                  {revealedApiKey}
                </p>
                <Button
                  variant="outline"
                  onClick={() => void copyApiKey()}
                  className="mt-3 h-8 rounded-xl border-amber-200 bg-white text-[8px] text-amber-900"
                >
                  <Copy className="mr-1.5 h-3 w-3" />
                  Copy API key
                </Button>
              </div>
            )}

            <p className="mt-3 text-[8px] leading-4 text-muted-foreground">
              API keys work only on workspace-scoped endpoints with the matching x-workspace-id header. Read and write permissions are enforced independently.
            </p>
          </div>
        ) : (
          <div className="border-b border-black/[0.055] bg-neutral-50 px-5 py-3 text-[9px] text-muted-foreground">
            Only the workspace owner can create, rotate or revoke API keys.
          </div>
        )}

        <div className="divide-y divide-black/[0.045]">
          {initialSettings.apiKeys.length ? (
            initialSettings.apiKeys.map((key) => (
              <div
                key={key.id}
                className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_170px_160px_220px]"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-[10px] font-semibold">
                      {key.name}
                    </p>
                    <span
                      className={
                        key.status === "active"
                          ? "rounded-md bg-emerald-50 px-2 py-1 text-[7px] font-semibold text-emerald-700"
                          : "rounded-md bg-neutral-100 px-2 py-1 text-[7px] font-semibold capitalize text-neutral-500"
                      }
                    >
                      {key.status}
                    </span>
                  </div>
                  <p className="mt-1 truncate font-mono text-[8px] text-muted-foreground">
                    {key.displayPrefix}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {key.scopes.map((scope) => (
                      <span
                        key={scope}
                        className="rounded-md bg-blue-50 px-2 py-1 text-[7px] font-semibold text-blue-700"
                      >
                        {scope}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-[7px] uppercase tracking-[0.08em] text-muted-foreground">
                    Expires
                  </p>
                  <p className="mt-1 text-[8px] font-semibold text-neutral-600">
                    {formatSettingDate(key.expiresAt)}
                  </p>
                </div>

                <div>
                  <p className="text-[7px] uppercase tracking-[0.08em] text-muted-foreground">
                    Last used
                  </p>
                  <p className="mt-1 text-[8px] font-semibold text-neutral-600">
                    {key.lastUsedAt ? formatSettingDate(key.lastUsedAt) : "Never"}
                  </p>
                </div>

                <div className="flex items-center justify-end gap-2">
                  {initialSettings.permissions.canManageApiKeys &&
                    key.status !== "revoked" && (
                      <>
                        <Button
                          variant="outline"
                          disabled={Boolean(busy)}
                          onClick={() => void rotateApiKey(key.id)}
                          className="h-8 rounded-xl text-[8px]"
                        >
                          {busy === `api-key-rotate-${key.id}` ? (
                            <LoaderCircle className="mr-1.5 h-3 w-3 animate-spin" />
                          ) : (
                            <RefreshCw className="mr-1.5 h-3 w-3" />
                          )}
                          Rotate
                        </Button>
                        <Button
                          variant="outline"
                          disabled={Boolean(busy)}
                          onClick={() => void revokeApiKey(key.id)}
                          className="h-8 rounded-xl border-red-100 text-[8px] text-red-700"
                        >
                          Revoke
                        </Button>
                      </>
                    )}
                </div>
              </div>
            ))
          ) : (
            <div className="px-5 py-8 text-center text-[9px] text-muted-foreground">
              No workspace API keys yet.
            </div>
          )}
        </div>
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
                className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_150px_280px]"
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

                <div className="flex flex-wrap items-end justify-end gap-2">
                  {canManage &&
                    initialSettings.permissions.canTransferOwnership &&
                    (confirmTransfer === member.id ? (
                      <>
                        <Button
                          variant="outline"
                          disabled={Boolean(busy)}
                          onClick={() => setConfirmTransfer(null)}
                          className="h-9 rounded-xl text-[8px]"
                        >
                          Keep ownership
                        </Button>
                        <Button
                          disabled={Boolean(busy)}
                          onClick={() => void transferOwnership(member.id)}
                          className="h-9 rounded-xl bg-amber-500 text-[8px] text-white hover:bg-amber-600"
                        >
                          {busy === `transfer-${member.id}` ? (
                            <LoaderCircle className="mr-1.5 h-3 w-3 animate-spin" />
                          ) : (
                            <Crown className="mr-1.5 h-3 w-3" />
                          )}
                          Confirm transfer
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="outline"
                        disabled={Boolean(busy)}
                        onClick={() => {
                          setConfirmRemove(null);
                          setConfirmTransfer(member.id);
                        }}
                        className="h-9 rounded-xl text-[8px] text-amber-700"
                      >
                        <Crown className="mr-1.5 h-3 w-3" />
                        Make owner
                      </Button>
                    ))}

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
                        onClick={() => {
                          setConfirmTransfer(null);
                          setConfirmRemove(member.id);
                        }}
                        className="h-9 rounded-xl text-[8px] text-red-700"
                      >
                        <Trash2 className="mr-1.5 h-3 w-3" />
                        Remove
                      </Button>
                    ))}
                  {!canManage && (
                    <span className="text-[8px] text-muted-foreground">
                      {isOwner ? "Current workspace owner" : "Owner permission required"}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="border-t border-black/[0.055] bg-neutral-50 px-5 py-3 text-[9px] leading-4 text-muted-foreground">
          Accepted invitations become persisted workspace membership. Ownership transfer is explicit: the current owner becomes admin and the selected member becomes the single owner in one transaction.
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
                "Expiring hashed bearer tokens + accept/reject + membership creation",
              ],
              [
                "Invitation email delivery",
                initialSettings.productCapabilities.invitationEmailDelivery,
                "Secure links exist; automated email delivery is not implemented yet",
              ],
              [
                "Ownership transfer",
                initialSettings.productCapabilities.ownershipTransfer,
                "Transactional single-owner transfer with DB invariant",
              ],
              [
                "API keys",
                initialSettings.productCapabilities.apiKeys,
                "Generate-once secret, hash-only storage, scoped auth, expiry, last-used, rotate/revoke",
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
              Identity/Admin now includes invitation lifecycle plus transactional ownership transfer and centralized RBAC roles. API-key lifecycle, notification preferences and immutable audit logs remain later slices and stay unavailable rather than simulated.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function formatSettingDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
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
