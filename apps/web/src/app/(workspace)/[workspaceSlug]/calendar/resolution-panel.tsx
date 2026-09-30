"use client";

import { useState } from "react";
import { AlertCircle, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type {
  AttemptEvidenceRecord,
  ReconciliationRecord,
} from "@/lib/sostats-api.server";
import {
  dateKeyInZone,
  fullDateTimeInZone,
  timeInZone,
  zonedWallTimeToUtc,
} from "./zoned-time";

type Action = "mark_published" | "confirm_absent" | "cancel";

const ACTION_LABELS: Record<Action, string> = {
  mark_published: "Mark published",
  confirm_absent: "Confirm not posted & retry",
  cancel: "Cancel publication",
};

const CONFIRM_COPY: Record<Action, string> = {
  mark_published:
    "SoStats will record this publication as live. It will not post anything.",
  confirm_absent:
    "This will publish again at the chosen time. Only continue if you have checked the channel and the post is not there.",
  cancel: "SoStats will cancel this publication. It will not post anything.",
};

const OUTCOME_LABELS: Record<ReconciliationRecord["outcome"], string> = {
  confirmed_published: "Confirmed published",
  inconclusive: "Still unconfirmed",
  confirmed_absent: "Confirmed not posted",
  cancelled: "Cancelled",
};

/** 32B-1 §9: evidence and history for everyone; actions for owners and admins on needs_review. */
export function ResolutionPanel({
  workspaceSlug,
  timezone,
  canResolve,
  post,
  onResolved,
  onConflict,
}: {
  workspaceSlug: string;
  timezone: string;
  canResolve: boolean;
  post: {
    id: number;
    status: string;
    channelConnected: boolean;
    attemptEvidence: AttemptEvidenceRecord | null;
    reconciliations: ReconciliationRecord[];
  };
  onResolved: () => void;
  onConflict: () => void;
}) {
  const [action, setAction] = useState<Action | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [postId, setPostId] = useState("");
  const [postUrl, setPostUrl] = useState("");
  const [note, setNote] = useState("");
  const [retryDate, setRetryDate] = useState("");
  const [retryTime, setRetryTime] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const evidence = post.attemptEvidence;
  const duplicates = [
    ...new Set(post.reconciliations.flatMap((entry) => entry.duplicatePlatformPostIds)),
  ];

  const choose = (next: Action) => {
    setAction(next);
    setConfirming(false);
    setError(null);
    if (next === "confirm_absent") {
      const now = new Date();
      setRetryDate(dateKeyInZone(now, timezone));
      setRetryTime(timeInZone(now, timezone));
    }
  };

  const submit = async () => {
    if (!action) return;
    const body: Record<string, string> = { action };
    if (note.trim()) body.note = note.trim();
    if (action === "mark_published") {
      if (postId.trim()) body.platformPostId = postId.trim();
      if (postUrl.trim()) body.platformPostUrl = postUrl.trim();
    }
    if (action === "confirm_absent") {
      const scheduledAt = zonedWallTimeToUtc(retryDate, retryTime, timezone);
      if (Number.isNaN(scheduledAt.getTime())) {
        setError("Choose a valid date and time.");
        return;
      }
      body.scheduledAt = scheduledAt.toISOString();
    }

    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/schedules/${post.id}/resolution`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        setError(payload.error || "Unable to resolve this publication");
        if (response.status === 403 || response.status === 409) onConflict();
        return;
      }
      onResolved();
    } catch {
      setError("Unable to resolve this publication");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-orange-100 bg-orange-50/60 p-3">
      <p className="text-[9px] font-semibold text-orange-800">
        {post.status === "unknown"
          ? "SoStats is checking whether this post went out."
          : "SoStats could not confirm whether this post went out. Check the channel, then resolve it."}
      </p>

      {evidence && (
        <dl className="grid grid-cols-2 gap-2 text-[8px] text-orange-900">
          <Fact
            label="Request started"
            value={
              evidence.requestStartedAt
                ? fullDateTimeInZone(new Date(evidence.requestStartedAt), timezone)
                : "Not recorded"
            }
          />
          <Fact label="Operation" value={evidence.operationType || "Not recorded"} />
          <Fact label="Operation id" value={evidence.operationId || "Not recorded"} />
          <Fact
            label="Confirmed post id"
            value={evidence.confirmedPlatformPostId || "None"}
          />
        </dl>
      )}

      {duplicates.length > 0 && (
        <p className="text-[8px] text-orange-900">
          Several post ids were recorded: {duplicates.join(", ")}
        </p>
      )}

      {post.reconciliations.length > 0 && (
        <ol className="space-y-1 text-[8px] text-orange-900">
          {post.reconciliations.map((entry, index) => (
            <li key={`${entry.createdAt}-${index}`}>
              {fullDateTimeInZone(new Date(entry.createdAt), timezone)} ·{" "}
              {OUTCOME_LABELS[entry.outcome] ?? entry.outcome} ·{" "}
              {entry.source === "operator" ? entry.actor?.name || "Operator" : "SoStats"}
              {entry.platformPostId ? ` · post ${entry.platformPostId}` : ""}
              {entry.note ? ` · "${entry.note}"` : ""}
            </li>
          ))}
        </ol>
      )}

      {post.status === "needs_review" && canResolve && (
        <div className="space-y-2 border-t border-orange-100 pt-3">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(ACTION_LABELS) as Action[]).map((key) => (
              <Button
                key={key}
                type="button"
                size="sm"
                variant={action === key ? "default" : "outline"}
                className="rounded-xl text-[9px]"
                disabled={pending || (key === "confirm_absent" && !post.channelConnected)}
                onClick={() => choose(key)}
              >
                {ACTION_LABELS[key]}
              </Button>
            ))}
          </div>
          {!post.channelConnected && (
            <p className="text-[8px] text-orange-900">
              Reconnect the channel before confirming the post is missing and retrying.
            </p>
          )}

          {action === "mark_published" && (
            <div className="grid gap-2">
              <Input
                value={postId}
                onChange={(event) => setPostId(event.target.value)}
                placeholder="Post id (optional)"
                maxLength={255}
                className="rounded-xl text-[9px]"
              />
              <Input
                value={postUrl}
                onChange={(event) => setPostUrl(event.target.value)}
                placeholder="https:// post URL (optional)"
                maxLength={1024}
                className="rounded-xl text-[9px]"
              />
            </div>
          )}

          {action === "confirm_absent" && (
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-[8px] font-semibold">
                Date · {timezone}
                <Input
                  type="date"
                  required
                  value={retryDate}
                  onChange={(event) => setRetryDate(event.target.value)}
                  className="mt-1 rounded-xl"
                />
              </label>
              <label className="block text-[8px] font-semibold">
                Time · {timezone}
                <Input
                  type="time"
                  required
                  value={retryTime}
                  onChange={(event) => setRetryTime(event.target.value)}
                  className="mt-1 rounded-xl"
                />
              </label>
            </div>
          )}

          {action && (
            <>
              <Textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Note (optional)"
                maxLength={500}
                className="rounded-xl text-[9px]"
              />
              {confirming ? (
                <div className="space-y-2 rounded-xl bg-white p-2">
                  <p className="text-[8px] leading-4 text-orange-900">
                    {CONFIRM_COPY[action]}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      className="rounded-xl bg-[#ef2b2d] text-[9px] hover:bg-[#da2427]"
                      disabled={pending}
                      onClick={submit}
                    >
                      {pending && <LoaderCircle className="mr-1 h-3 w-3 animate-spin" />}
                      Confirm
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="rounded-xl text-[9px]"
                      disabled={pending}
                      onClick={() => setConfirming(false)}
                    >
                      Back
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-xl text-[9px]"
                  disabled={action === "confirm_absent" && (!retryDate || !retryTime)}
                  onClick={() => setConfirming(true)}
                >
                  Continue
                </Button>
              )}
            </>
          )}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-xl bg-red-50 p-2 text-[9px] text-red-700">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="uppercase tracking-[0.08em] opacity-70">{label}</dt>
      <dd className="mt-0.5 break-all font-semibold">{value}</dd>
    </div>
  );
}
