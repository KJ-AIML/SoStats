import {
  BrainCircuit,
  CheckCircle2,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
  Target,
  Package,
} from "lucide-react";
import { PageHeading } from "@/components/sostats/page-heading";
import { KnowledgeLibrary } from "@/components/brand-brain/knowledge-library";
import { loadWorkspaceSnapshot } from "@/lib/sostats-api.server";

export default async function BrandBrainPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  let snapshot: Awaited<ReturnType<typeof loadWorkspaceSnapshot>> | null = null;
  try {
    snapshot = await loadWorkspaceSnapshot(workspaceSlug);
  } catch {
    snapshot = null;
  }

  const brand = snapshot?.brand || null;
  const voice = brand?.voiceProfiles?.[0];
  const audience = brand?.audiences?.[0];
  const pillars = brand?.pillars || [];
  const rules = brand?.rules || [];
  const products = brand?.products || [];

  const sections = [
    {
      icon: MessageSquareText,
      title: "Brand voice",
      detail: voice?.tone || "Not configured",
      ready: Boolean(voice),
    },
    {
      icon: Target,
      title: "Audience",
      detail: audience?.name || "Not configured",
      ready: Boolean(audience),
    },
    {
      icon: Sparkles,
      title: "Content pillars",
      detail: pillars.length ? pillars.map((item) => item.name).join(", ") : "Not configured",
      ready: pillars.length > 0,
    },
    {
      icon: ShieldCheck,
      title: "Guardrails",
      detail: rules.length ? `${rules.length} rules configured` : "Not configured",
      ready: rules.length > 0,
    },
  ];

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 p-4 md:p-6 xl:p-8">
      <PageHeading
        eyebrow="Brand Brain"
        title={brand ? `Teach SoStats how ${brand.name} thinks` : "Teach SoStats how your brand thinks"}
        description="A shared intelligence layer for every campaign, automation and AI recommendation in your workspace."
      />

      {!snapshot && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[10px] text-amber-800">
          Brand Brain is waiting for the API/database stack.
        </div>
      )}

      <section className="relative overflow-hidden rounded-[22px] border border-black/[0.07] bg-neutral-950 p-5 text-white md:p-6">
        <div className="absolute -right-12 -top-20 h-56 w-56 rounded-full bg-[#ef2b2d] opacity-40 blur-3xl" />
        <div className="relative z-10 grid gap-5 lg:grid-cols-[1fr_330px] lg:items-center">
          <div>
            <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold text-red-200">
              <BrainCircuit className="h-4 w-4" />
              BRAND INTELLIGENCE
            </div>
            <h2 className="max-w-2xl text-[23px] font-semibold tracking-[-0.035em]">
              AI should sound like your brand before it sounds like AI.
            </h2>
            <p className="mt-2 max-w-xl text-[10px] leading-5 text-white/55">
              Generation combines structured brand rules with semantic retrieval from your indexed websites, PDFs and source-of-truth text before calling the AI service.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[
              [String(brand?.voiceProfiles?.length || 0), "Voice profiles"],
              [String(brand?.audiences?.length || 0), "Audiences"],
              [String(products.length), "Products"],
              [String(pillars.length), "Content pillars"],
            ].map(([value, label]) => (
              <div key={label} className="rounded-xl border border-white/10 bg-white/[0.06] p-3">
                <p className="text-lg font-semibold">{value}</p>
                <p className="mt-0.5 text-[8px] text-white/45">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <KnowledgeLibrary
        workspaceSlug={workspaceSlug}
        brandId={brand?.id}
        initialSources={(snapshot?.knowledge || []).filter(
          (source) => !brand || source.brandId === brand.id,
        )}
      />

      <div className="grid gap-4 xl:grid-cols-12">
        <section className="sostats-card xl:col-span-7">
          <div className="border-b border-black/[0.055] px-5 py-4">
            <p className="text-sm font-semibold">Brand profile</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">Core context used across AI workflows</p>
          </div>
          <div className="grid gap-px bg-black/[0.045] sm:grid-cols-2">
            {sections.map((item) => (
              <div key={item.title} className="bg-white p-5">
                <div className="flex items-start gap-3">
                  <div className="sostats-icon">
                    <item.icon className="h-4 w-4 text-neutral-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] font-semibold">{item.title}</p>
                      <span className={item.ready ? "flex items-center gap-1 text-[8px] font-medium text-emerald-600" : "text-[8px] font-medium text-amber-600"}>
                        {item.ready && <CheckCircle2 className="h-3 w-3" />}
                        {item.ready ? "Ready" : "Setup needed"}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[9px] leading-4 text-muted-foreground">{item.detail}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="sostats-card xl:col-span-5">
          <div className="border-b border-black/[0.055] px-5 py-4">
            <p className="text-sm font-semibold">Products & offers</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">Product context available to generation</p>
          </div>
          <div className="space-y-2 p-4">
            {products.length ? (
              products.map((product) => (
                <div key={product.id} className="flex items-start gap-3 rounded-xl border border-black/[0.055] p-3">
                  <div className="sostats-icon h-8 w-8 shrink-0">
                    <Package className="h-3.5 w-3.5 text-neutral-500" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[9px] font-semibold">{product.name}</p>
                    <p className="mt-0.5 line-clamp-2 text-[8px] leading-4 text-muted-foreground">
                      {product.description || product.features || "No description"}
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <p className="py-8 text-center text-[9px] text-muted-foreground">
                No products configured yet.
              </p>
            )}
          </div>
        </section>
      </div>

      <section className="sostats-card overflow-hidden">
        <div className="border-b border-black/[0.055] px-5 py-4">
          <p className="text-sm font-semibold">Brand rules</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">Guardrails injected into AI context</p>
        </div>
        <div className="grid gap-px bg-black/[0.045] md:grid-cols-3">
          {rules.length ? (
            rules.slice(0, 6).map((rule) => (
              <div key={rule.id} className="bg-white p-5">
                <p className="text-[9px] font-semibold uppercase text-[#d92023]">{rule.ruleType}</p>
                <p className="mt-2 text-[10px] leading-5 text-muted-foreground">{rule.description}</p>
              </div>
            ))
          ) : (
            <div className="col-span-full bg-white px-5 py-8 text-center text-[10px] text-muted-foreground">
              Add rules to constrain claims, language and required messaging.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
