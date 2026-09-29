import Link from "next/link";
import {
  Activity,
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Rss,
  ShieldCheck,
  Webhook,
  Workflow,
} from "lucide-react";
import { PageHeading } from "@/components/sostats/page-heading";
import { workspaceRequest } from "@/lib/sostats-api.server";

type CatalogEntry = {
  key: "rss" | "wordpress" | "webhook" | string;
  name: string;
  mode: string;
  description: string;
  supported: boolean;
  configuredCount: number;
  activeCount: number;
  errorCount: number;
  latestActivityAt?: string | null;
};

type IntegrationInstance = {
  kind: string;
  triggerId: number;
  automationId: number;
  automationName: string;
  automationStatus: string;
  triggerStatus: string;
  feedUrl?: string | null;
  sourceType?: string | null;
  eventName?: string | null;
  publicId?: string | null;
  nextPollAt?: string | null;
  lastPolledAt?: string | null;
  lastReceivedAt?: string | null;
  lastTriggeredAt?: string | null;
  lastError?: string | null;
  recentEventCount: number;
  lastEventAt?: string | null;
  activityAt?: string | null;
};

type IntegrationsOverview = {
  workspaceId: number;
  catalog: CatalogEntry[];
  instances: IntegrationInstance[];
  legacyRecordCount: number;
  productBoundary: {
    configurationOwner: string;
    secretsReadableAfterCreation: boolean;
    wordpressMode: string;
    rssMode: string;
  };
};

function iconFor(kind: string) {
  if (kind === "rss") return Rss;
  return Webhook;
}

function labelFor(kind: string) {
  if (kind === "wordpress") return "WordPress";
  if (kind === "webhook") return "Signed webhook";
  if (kind === "rss") return "RSS";
  return kind;
}

function formatDate(value?: string | null) {
  if (!value) return "No activity yet";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function IntegrationsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  let overview: IntegrationsOverview | null = null;

  try {
    overview = await workspaceRequest<IntegrationsOverview>(
      workspaceSlug,
      "/integrations/overview",
    );
  } catch {
    overview = null;
  }

  const catalog = overview?.catalog || [];
  const instances = overview?.instances || [];
  const active = catalog.reduce((sum, item) => sum + item.activeCount, 0);
  const errors = catalog.reduce((sum, item) => sum + item.errorCount, 0);
  const configured = catalog.reduce(
    (sum, item) => sum + item.configuredCount,
    0,
  );

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 p-4 md:p-6 xl:p-8">
      <PageHeading
        eyebrow="Integrations"
        title="External signals backed by the real automation runtime"
        description="SoStats only presents integrations that execute through persisted trigger infrastructure. RSS polls safely; WordPress and generic external events enter through signed, replay-protected webhooks."
        actions={
          <Link
            href={`/${workspaceSlug}/automations`}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#ef2b2d] px-4 text-[10px] font-semibold text-white transition hover:bg-[#da2427]"
          >
            <Workflow className="h-3.5 w-3.5" />
            Configure in Automations
          </Link>
        }
      />

      {!overview && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[10px] text-amber-800">
          Integration runtime data is unavailable until the API/database stack is running.
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "Supported runtime types",
            value: catalog.length,
            hint: "Only production-backed trigger modes",
            Icon: ShieldCheck,
          },
          {
            label: "Configured triggers",
            value: configured,
            hint: "Persisted external automation triggers",
            Icon: Workflow,
          },
          {
            label: "Active triggers",
            value: active,
            hint: "Automation + trigger both active",
            Icon: CheckCircle2,
          },
          {
            label: "Needs attention",
            value: errors,
            hint: "Triggers with persisted runtime errors",
            Icon: AlertCircle,
          },
        ].map(({ label, value, hint, Icon }) => (
          <div key={label} className="sostats-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[9px] text-muted-foreground">{label}</p>
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

      <section className="grid gap-4 lg:grid-cols-3">
        {catalog.map((item) => {
          const Icon = iconFor(item.key);
          const healthy =
            item.configuredCount > 0 && item.errorCount === 0;
          return (
            <article key={item.key} className="sostats-card p-5">
              <div className="flex items-start gap-3">
                <div className="sostats-icon h-10 w-10 shrink-0">
                  <Icon className="h-4 w-4 text-neutral-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[11px] font-semibold">{item.name}</p>
                    <span className="rounded-lg bg-emerald-50 px-2 py-1 text-[7px] font-semibold text-emerald-700">
                      Runtime supported
                    </span>
                  </div>
                  <p className="mt-1.5 text-[9px] leading-4 text-muted-foreground">
                    {item.description}
                  </p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2">
                <MiniMetric label="Configured" value={item.configuredCount} />
                <MiniMetric label="Active" value={item.activeCount} />
                <MiniMetric label="Errors" value={item.errorCount} />
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-black/[0.05] pt-3">
                <div>
                  <p className="text-[7px] uppercase tracking-[0.08em] text-muted-foreground">
                    Mode
                  </p>
                  <p className="mt-1 text-[8px] font-semibold">
                    {item.mode.replaceAll("_", " ")}
                  </p>
                </div>
                <span
                  className={
                    item.configuredCount === 0
                      ? "rounded-lg bg-neutral-100 px-2 py-1 text-[8px] font-semibold text-neutral-500"
                      : healthy
                        ? "rounded-lg bg-emerald-50 px-2 py-1 text-[8px] font-semibold text-emerald-700"
                        : "rounded-lg bg-amber-50 px-2 py-1 text-[8px] font-semibold text-amber-700"
                  }
                >
                  {item.configuredCount === 0
                    ? "Not configured"
                    : healthy
                      ? "Healthy"
                      : "Check runtime"}
                </span>
              </div>

              <p className="mt-2 text-[8px] text-muted-foreground">
                Latest activity · {formatDate(item.latestActivityAt)}
              </p>
            </article>
          );
        })}
      </section>

      <section className="sostats-card overflow-hidden">
        <div className="flex items-end justify-between gap-3 border-b border-black/[0.055] px-5 py-4">
          <div>
            <p className="text-sm font-semibold">Configured runtime instances</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Persisted trigger state owned by Automations — not a decorative integration catalog.
            </p>
          </div>
          <Link
            href={`/${workspaceSlug}/automations`}
            className="inline-flex items-center gap-1 text-[9px] font-semibold text-[#d92023]"
          >
            Manage workflows
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        <div className="divide-y divide-black/[0.045]">
          {instances.length ? (
            instances.map((instance) => {
              const Icon = iconFor(instance.kind);
              const hasError = Boolean(instance.lastError);
              return (
                <div
                  key={instance.triggerId}
                  className="grid gap-3 px-5 py-4 md:grid-cols-[40px_minmax(0,1fr)_140px_150px]"
                >
                  <div className="sostats-icon h-9 w-9">
                    <Icon className="h-3.5 w-3.5 text-neutral-500" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-[10px] font-semibold">
                        {instance.automationName}
                      </p>
                      <span className="rounded-md bg-neutral-100 px-2 py-1 text-[7px] font-semibold text-neutral-500">
                        {labelFor(instance.kind)}
                      </span>
                      <span
                        className={
                          hasError
                            ? "rounded-md bg-red-50 px-2 py-1 text-[7px] font-semibold text-red-700"
                            : instance.triggerStatus === "active"
                              ? "rounded-md bg-emerald-50 px-2 py-1 text-[7px] font-semibold text-emerald-700"
                              : "rounded-md bg-amber-50 px-2 py-1 text-[7px] font-semibold text-amber-700"
                        }
                      >
                        {hasError ? "Error" : instance.triggerStatus}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-[8px] text-muted-foreground">
                      {instance.feedUrl ||
                        (instance.eventName
                          ? `${instance.sourceType || "generic"} · ${instance.eventName}`
                          : "External trigger")}
                    </p>
                    {instance.lastError && (
                      <p className="mt-1 line-clamp-2 text-[8px] text-red-600">
                        {instance.lastError}
                      </p>
                    )}
                  </div>
                  <div>
                    <p className="text-[7px] uppercase tracking-[0.08em] text-muted-foreground">
                      Last activity
                    </p>
                    <p className="mt-1 text-[8px] font-semibold text-neutral-600">
                      {formatDate(instance.activityAt)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[7px] uppercase tracking-[0.08em] text-muted-foreground">
                      Runtime
                    </p>
                    <p className="mt-1 text-[8px] font-semibold text-neutral-600">
                      {instance.kind === "rss"
                        ? instance.nextPollAt
                          ? `Next poll · ${formatDate(instance.nextPollAt)}`
                          : "Polling paused"
                        : `${instance.recentEventCount} recent persisted event${instance.recentEventCount === 1 ? "" : "s"}`}
                    </p>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="px-5 py-10 text-center">
              <Activity className="mx-auto h-5 w-5 text-neutral-300" />
              <p className="mt-2 text-[10px] font-semibold">
                No external runtime triggers configured
              </p>
              <p className="mt-1 text-[9px] text-muted-foreground">
                Create an RSS or signed webhook workflow in Automations.
              </p>
            </div>
          )}
        </div>
      </section>

      {Boolean(overview?.legacyRecordCount) && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[9px] leading-4 text-amber-800">
          <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {overview?.legacyRecordCount} legacy generic integration record
          {overview?.legacyRecordCount === 1 ? "" : "s"} exist in storage.
          Product configuration no longer uses that dummy adapter path; migrate external triggers through Automations before removing legacy records.
        </div>
      )}

      <div className="flex items-start gap-2 text-[9px] leading-4 text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        WordPress is implemented as a signed webhook source, not a separate WordPress API client. Signing secrets are encrypted at rest, revealed only on creation/rotation, and never returned by this overview.
      </div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-neutral-50 p-2.5 text-center">
      <p className="text-[7px] uppercase tracking-[0.07em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-[10px] font-semibold">{value}</p>
    </div>
  );
}
