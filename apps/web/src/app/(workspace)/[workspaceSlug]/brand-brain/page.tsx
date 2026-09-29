import Link from "next/link";
import {
  BrainCircuit,
  DatabaseZap,
  FileCheck2,
  Layers3,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { PageHeading } from "@/components/sostats/page-heading";
import { KnowledgeLibrary } from "@/components/brand-brain/knowledge-library";
import { BrandProfileEditor } from "@/components/brand-brain/brand-profile-editor";
import { KnowledgeRetrievalTester } from "@/components/brand-brain/knowledge-retrieval-tester";
import {
  type BrandRecord,
  loadWorkspaceSnapshot,
  workspaceRequest,
} from "@/lib/sostats-api.server";

export default async function BrandBrainPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{
    brandId?: string | string[];
    newBrand?: string | string[];
  }>;
}) {
  const { workspaceSlug } = await params;
  const query = await searchParams;
  let snapshot: Awaited<ReturnType<typeof loadWorkspaceSnapshot>> | null = null;
  let selectedBrand: BrandRecord | null = null;

  try {
    snapshot = await loadWorkspaceSnapshot(workspaceSlug);

    const createNew =
      (Array.isArray(query.newBrand) ? query.newBrand[0] : query.newBrand) === "1";
    const requested = Number.parseInt(
      Array.isArray(query.brandId)
        ? query.brandId[0] || ""
        : query.brandId || "",
      10,
    );
    const requestedBrand = snapshot.brands.find(
      (brand) => brand.id === requested,
    );
    const selectedId = createNew
      ? undefined
      : requestedBrand?.id || snapshot.brands[0]?.id;

    if (selectedId) {
      if (snapshot.brand?.id === selectedId) {
        selectedBrand = snapshot.brand;
      } else {
        selectedBrand = await workspaceRequest<BrandRecord>(
          workspaceSlug,
          `/brands/${selectedId}`,
        );
      }
    }
  } catch {
    snapshot = null;
    selectedBrand = null;
  }

  const sources = (snapshot?.knowledge || []).filter(
    (source) => selectedBrand && source.brandId === selectedBrand.id,
  );
  const readySources = sources.filter((source) => source.activeVersion > 0);
  const pendingSources = sources.filter((source) =>
    ["uploading", "uploaded", "processing"].includes(source.status),
  );
  const failedSources = sources.filter((source) => source.status === "failed");
  const chunks = readySources.reduce(
    (total, source) => total + Number(source.chunkCount || 0),
    0,
  );
  const structuredRecords = selectedBrand
    ? (selectedBrand.voiceProfiles?.length || 0) +
      (selectedBrand.audiences?.length || 0) +
      (selectedBrand.products?.length || 0) +
      (selectedBrand.pillars?.length || 0) +
      (selectedBrand.rules?.length || 0)
    : 0;

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 p-4 md:p-6 xl:p-8">
      <PageHeading
        eyebrow="Brand Brain"
        title={
          selectedBrand
            ? `Teach SoStats how ${selectedBrand.name} thinks`
            : "Build the intelligence layer behind every generation"
        }
        description="Structured brand context and versioned semantic knowledge feed AI Studio, automations and evidence-backed recommendations through the same workspace-scoped Brand Brain."
      />

      {!snapshot && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[10px] text-amber-800">
          Brand Brain is waiting for the API/database stack.
        </div>
      )}

      {snapshot && snapshot.brands.length > 0 && (
        <section className="sostats-card flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="px-1 text-[8px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Brand workspace
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {snapshot.brands.map((brand) => (
                <Link
                  key={brand.id}
                  href={`/${workspaceSlug}/brand-brain?brandId=${brand.id}`}
                  className={
                    selectedBrand?.id === brand.id
                      ? "rounded-xl bg-neutral-950 px-3 py-2 text-[9px] font-semibold text-white"
                      : "rounded-xl border border-black/[0.06] bg-white px-3 py-2 text-[9px] font-semibold text-neutral-500 hover:bg-neutral-50"
                  }
                >
                  {brand.name}
                </Link>
              ))}
              <Link
                href={`/${workspaceSlug}/brand-brain?newBrand=1`}
                className={
                  !selectedBrand
                    ? "rounded-xl bg-[#ef2b2d] px-3 py-2 text-[9px] font-semibold text-white"
                    : "rounded-xl border border-dashed border-black/[0.12] bg-white px-3 py-2 text-[9px] font-semibold text-neutral-500 hover:bg-neutral-50"
                }
              >
                + New Brand Brain
              </Link>
            </div>
          </div>
          <span className="rounded-lg bg-neutral-100 px-2.5 py-1.5 text-[8px] font-semibold text-neutral-500">
            {snapshot.brands.length} Brand Brain
            {snapshot.brands.length === 1 ? "" : "s"}
          </span>
        </section>
      )}

      <section className="relative overflow-hidden rounded-[22px] border border-black/[0.07] bg-neutral-950 p-5 text-white md:p-6">
        <div className="absolute -right-12 -top-20 h-56 w-56 rounded-full bg-[#ef2b2d] opacity-40 blur-3xl" />
        <div className="relative z-10 grid gap-5 lg:grid-cols-[1fr_430px] lg:items-center">
          <div>
            <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold text-red-200">
              <BrainCircuit className="h-4 w-4" />
              BRAND INTELLIGENCE
            </div>
            <h2 className="max-w-2xl text-[23px] font-semibold tracking-[-0.035em]">
              Structured truth first. Retrieved evidence second. Model output last.
            </h2>
            <p className="mt-2 max-w-xl text-[10px] leading-5 text-white/55">
              SoStats combines the selected brand profile with only the active
              version of indexed knowledge. Retrieval provenance remains
              traceable back to source, version and semantic chunk.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {[
              {
                value: String(structuredRecords),
                label: "Structured records",
                Icon: Layers3,
              },
              {
                value: String(readySources.length),
                label: "Indexed sources",
                Icon: FileCheck2,
              },
              {
                value: String(chunks),
                label: "Active chunks",
                Icon: DatabaseZap,
              },
              {
                value: String(failedSources.length + pendingSources.length),
                label: "Sources needing attention",
                Icon: ShieldCheck,
              },
            ].map(({ value, label, Icon }) => (
              <div
                key={label}
                className="rounded-xl border border-white/10 bg-white/[0.06] p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-lg font-semibold">{value}</p>
                    <p className="mt-0.5 text-[8px] text-white/45">{label}</p>
                  </div>
                  <Icon className="h-3.5 w-3.5 text-white/30" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <BrandProfileEditor
        workspaceSlug={workspaceSlug}
        brand={selectedBrand}
      />

      {selectedBrand && (
        <>
          <KnowledgeLibrary
            workspaceSlug={workspaceSlug}
            brandId={selectedBrand.id}
            initialSources={sources}
          />

          <KnowledgeRetrievalTester
            workspaceSlug={workspaceSlug}
            brandId={selectedBrand.id}
            readySourceCount={readySources.length}
          />

          <section className="sostats-card overflow-hidden">
            <div className="border-b border-black/[0.055] px-5 py-4">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-[#ef2b2d]" />
                <p className="text-sm font-semibold">AI context contract</p>
              </div>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                What downstream generation receives from this Brand Brain.
              </p>
            </div>

            <div className="grid gap-px bg-black/[0.045] sm:grid-cols-2 xl:grid-cols-5">
              {[
                ["Voice", selectedBrand.voiceProfiles?.length || 0],
                ["Audiences", selectedBrand.audiences?.length || 0],
                ["Products", selectedBrand.products?.length || 0],
                ["Pillars", selectedBrand.pillars?.length || 0],
                ["Rules", selectedBrand.rules?.length || 0],
              ].map(([label, count]) => (
                <div key={String(label)} className="bg-white p-4">
                  <p className="text-[8px] uppercase tracking-[0.08em] text-muted-foreground">
                    {String(label)}
                  </p>
                  <p className="mt-1 text-xl font-semibold tracking-[-0.03em]">
                    {String(count)}
                  </p>
                </div>
              ))}
            </div>

            <div className="border-t border-black/[0.055] bg-neutral-50 px-5 py-4 text-[9px] leading-5 text-muted-foreground">
              BrandContextService serializes identity, voice, audiences,
              products, pillars and rules. KnowledgeService independently
              retrieves only active-version chunks above the configured
              similarity threshold. Campaign generation stores the resulting
              knowledge evidence as provenance.
            </div>
          </section>
        </>
      )}
    </div>
  );
}
