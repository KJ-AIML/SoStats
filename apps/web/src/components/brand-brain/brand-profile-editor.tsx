"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  LoaderCircle,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BrandRecord } from "@/lib/sostats-api.server";

type Voice = { tone: string; style: string; guidelines: string };
type Audience = { name: string; demographics: string; painPoints: string };
type Product = { name: string; description: string; features: string };
type Pillar = { name: string; description: string };
type Rule = { ruleType: string; description: string };

function rows<T extends Record<string, unknown>>(
  source: T[] | undefined,
  map: (item: T) => Record<string, string>,
) {
  return (source || []).map(map);
}

export function BrandProfileEditor({
  workspaceSlug,
  brand,
}: {
  workspaceSlug: string;
  brand: BrandRecord | null;
}) {
  const router = useRouter();
  const [name, setName] = useState(brand?.name || "");
  const [description, setDescription] = useState(brand?.description || "");
  const [websiteUrl, setWebsiteUrl] = useState(brand?.websiteUrl || "");

  const [voices, setVoices] = useState<Voice[]>(() =>
    rows(brand?.voiceProfiles, (item) => ({
      tone: String(item.tone || ""),
      style: String(item.style || ""),
      guidelines: String(item.guidelines || ""),
    })) as Voice[],
  );
  const [audiences, setAudiences] = useState<Audience[]>(() =>
    rows(brand?.audiences, (item) => ({
      name: String(item.name || ""),
      demographics: String(item.demographics || ""),
      painPoints: String(item.painPoints || ""),
    })) as Audience[],
  );
  const [products, setProducts] = useState<Product[]>(() =>
    rows(brand?.products, (item) => ({
      name: String(item.name || ""),
      description: String(item.description || ""),
      features: String(item.features || ""),
    })) as Product[],
  );
  const [pillars, setPillars] = useState<Pillar[]>(() =>
    rows(brand?.pillars, (item) => ({
      name: String(item.name || ""),
      description: String(item.description || ""),
    })) as Pillar[],
  );
  const [rules, setRules] = useState<Rule[]>(() =>
    rows(brand?.rules, (item) => ({
      ruleType: String(item.ruleType || ""),
      description: String(item.description || ""),
    })) as Rule[],
  );

  const [busy, setBusy] = useState<"create" | "profile" | "context" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);


  const create = async () => {
    if (!name.trim()) {
      setError("Brand name is required.");
      return;
    }
    setBusy("create");
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/brands`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            description: description.trim() || undefined,
            websiteUrl: websiteUrl.trim() || undefined,
          }),
        },
      );
      const payload = (await response.json()) as BrandRecord & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to create brand");
      }
      router.push(
        `/${workspaceSlug}/brand-brain?brandId=${encodeURIComponent(String(payload.id))}`,
      );
      router.refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to create brand",
      );
    } finally {
      setBusy(null);
    }
  };

  const saveProfile = async () => {
    if (!brand) return;
    setBusy("profile");
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/brands/${brand.id}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name,
            description,
            websiteUrl,
          }),
        },
      );
      const payload = (await response.json()) as BrandRecord & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to save brand profile");
      }
      setMessage("Brand profile saved.");
      router.refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to save brand profile",
      );
    } finally {
      setBusy(null);
    }
  };

  const saveContext = async () => {
    if (!brand) return;
    setBusy("context");
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/brands/${brand.id}/context`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            voiceProfiles: voices,
            audiences,
            products,
            pillars,
            rules,
          }),
        },
      );
      const payload = (await response.json()) as BrandRecord & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to save Brand Brain context");
      }
      setMessage(
        "Structured context saved. New AI generations will use this Brand Brain state.",
      );
      router.refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to save Brand Brain context",
      );
    } finally {
      setBusy(null);
    }
  };

  if (!brand) {
    return (
      <section className="sostats-card overflow-hidden">
        <div className="border-b border-black/[0.055] px-5 py-4">
          <p className="text-sm font-semibold">Create your first Brand Brain</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            Start with identity. Voice, audiences, products, guardrails and
            knowledge can be added immediately after creation.
          </p>
        </div>
        <div className="mx-auto max-w-3xl space-y-3 p-5">
          <Field label="Brand name">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="SoStats"
              className="rounded-xl"
            />
          </Field>
          <Field label="Website">
            <Input
              value={websiteUrl}
              onChange={(event) => setWebsiteUrl(event.target.value)}
              placeholder="https://example.com"
              className="rounded-xl"
            />
          </Field>
          <Field label="Description">
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={4}
              className="w-full resize-none rounded-xl border border-black/[0.07] bg-neutral-50 p-3 text-[10px] leading-5 outline-none"
              placeholder="What does this brand do, for whom, and why?"
            />
          </Field>
          {error && <ErrorBox>{error}</ErrorBox>}
          <Button
            onClick={() => void create()}
            disabled={Boolean(busy)}
            className="rounded-xl bg-[#ef2b2d] hover:bg-[#da2427]"
          >
            {busy === "create" && (
              <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
            )}
            Create Brand Brain
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="sostats-card overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-black/[0.055] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold">Structured brand context</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            These records are serialized directly into AI generation context.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => void saveProfile()}
            disabled={Boolean(busy)}
            className="h-9 rounded-xl text-[9px]"
          >
            {busy === "profile" ? (
              <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="mr-1.5 h-3.5 w-3.5" />
            )}
            Save identity
          </Button>
          <Button
            onClick={() => void saveContext()}
            disabled={Boolean(busy)}
            className="h-9 rounded-xl bg-[#ef2b2d] text-[9px] hover:bg-[#da2427]"
          >
            {busy === "context" ? (
              <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="mr-1.5 h-3.5 w-3.5" />
            )}
            Save Brand Brain
          </Button>
        </div>
      </div>

      {(error || message) && (
        <div className="border-b border-black/[0.055] px-5 py-3">
          {error ? (
            <ErrorBox>{error}</ErrorBox>
          ) : (
            <div className="flex items-start gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-[9px] text-emerald-700">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {message}
            </div>
          )}
        </div>
      )}

      <div className="grid gap-px bg-black/[0.045] xl:grid-cols-2">
        <div className="space-y-4 bg-white p-5">
          <SectionTitle title="Identity" hint="Core brand profile" />
          <Field label="Brand name">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="rounded-xl"
            />
          </Field>
          <Field label="Website">
            <Input
              value={websiteUrl}
              onChange={(event) => setWebsiteUrl(event.target.value)}
              placeholder="https://..."
              className="rounded-xl"
            />
          </Field>
          <Field label="Description">
            <TextArea value={description} onChange={setDescription} rows={5} />
          </Field>
        </div>

        <div className="space-y-4 bg-white p-5">
          <SectionTitle
            title="Brand voice"
            hint="Tone, writing style and explicit guidance"
            action={() =>
              setVoices((current) => [
                ...current,
                { tone: "", style: "", guidelines: "" },
              ])
            }
          />
          {voices.map((voice, index) => (
            <EditorCard
              key={index}
              onRemove={() =>
                setVoices((current) =>
                  current.filter((_, row) => row !== index),
                )
              }
            >
              <Input
                value={voice.tone}
                onChange={(event) =>
                  setVoices((current) =>
                    current.map((item, row) =>
                      row === index
                        ? { ...item, tone: event.target.value }
                        : item,
                    ),
                  )
                }
                placeholder="Tone — e.g. clear, confident, warm"
                className="rounded-xl"
              />
              <TextArea
                value={voice.style}
                onChange={(value) =>
                  setVoices((current) =>
                    current.map((item, row) =>
                      row === index ? { ...item, style: value } : item,
                    ),
                  )
                }
                placeholder="Style"
              />
              <TextArea
                value={voice.guidelines}
                onChange={(value) =>
                  setVoices((current) =>
                    current.map((item, row) =>
                      row === index ? { ...item, guidelines: value } : item,
                    ),
                  )
                }
                placeholder="Guidelines"
              />
            </EditorCard>
          ))}
          {!voices.length && <EmptyRows label="voice profile" />}
        </div>

        <div className="space-y-4 bg-white p-5">
          <SectionTitle
            title="Audiences"
            hint="Who content is written for"
            action={() =>
              setAudiences((current) => [
                ...current,
                { name: "", demographics: "", painPoints: "" },
              ])
            }
          />
          {audiences.map((audience, index) => (
            <EditorCard
              key={index}
              onRemove={() =>
                setAudiences((current) =>
                  current.filter((_, row) => row !== index),
                )
              }
            >
              <Input
                value={audience.name}
                onChange={(event) =>
                  setAudiences((current) =>
                    current.map((item, row) =>
                      row === index
                        ? { ...item, name: event.target.value }
                        : item,
                    ),
                  )
                }
                placeholder="Audience name"
                className="rounded-xl"
              />
              <TextArea
                value={audience.demographics}
                onChange={(value) =>
                  setAudiences((current) =>
                    current.map((item, row) =>
                      row === index
                        ? { ...item, demographics: value }
                        : item,
                    ),
                  )
                }
                placeholder="Demographics / context"
              />
              <TextArea
                value={audience.painPoints}
                onChange={(value) =>
                  setAudiences((current) =>
                    current.map((item, row) =>
                      row === index ? { ...item, painPoints: value } : item,
                    ),
                  )
                }
                placeholder="Pain points / jobs to be done"
              />
            </EditorCard>
          ))}
          {!audiences.length && <EmptyRows label="audience" />}
        </div>

        <div className="space-y-4 bg-white p-5">
          <SectionTitle
            title="Products & offers"
            hint="What the brand can credibly talk about"
            action={() =>
              setProducts((current) => [
                ...current,
                { name: "", description: "", features: "" },
              ])
            }
          />
          {products.map((product, index) => (
            <EditorCard
              key={index}
              onRemove={() =>
                setProducts((current) =>
                  current.filter((_, row) => row !== index),
                )
              }
            >
              <Input
                value={product.name}
                onChange={(event) =>
                  setProducts((current) =>
                    current.map((item, row) =>
                      row === index
                        ? { ...item, name: event.target.value }
                        : item,
                    ),
                  )
                }
                placeholder="Product / offer name"
                className="rounded-xl"
              />
              <TextArea
                value={product.description}
                onChange={(value) =>
                  setProducts((current) =>
                    current.map((item, row) =>
                      row === index
                        ? { ...item, description: value }
                        : item,
                    ),
                  )
                }
                placeholder="Description"
              />
              <TextArea
                value={product.features}
                onChange={(value) =>
                  setProducts((current) =>
                    current.map((item, row) =>
                      row === index ? { ...item, features: value } : item,
                    ),
                  )
                }
                placeholder="Features / differentiators"
              />
            </EditorCard>
          ))}
          {!products.length && <EmptyRows label="product" />}
        </div>

        <div className="space-y-4 bg-white p-5">
          <SectionTitle
            title="Content pillars"
            hint="Recurring strategic themes"
            action={() =>
              setPillars((current) => [
                ...current,
                { name: "", description: "" },
              ])
            }
          />
          {pillars.map((pillar, index) => (
            <EditorCard
              key={index}
              onRemove={() =>
                setPillars((current) =>
                  current.filter((_, row) => row !== index),
                )
              }
            >
              <Input
                value={pillar.name}
                onChange={(event) =>
                  setPillars((current) =>
                    current.map((item, row) =>
                      row === index
                        ? { ...item, name: event.target.value }
                        : item,
                    ),
                  )
                }
                placeholder="Pillar name"
                className="rounded-xl"
              />
              <TextArea
                value={pillar.description}
                onChange={(value) =>
                  setPillars((current) =>
                    current.map((item, row) =>
                      row === index
                        ? { ...item, description: value }
                        : item,
                    ),
                  )
                }
                placeholder="What belongs in this pillar?"
              />
            </EditorCard>
          ))}
          {!pillars.length && <EmptyRows label="content pillar" />}
        </div>

        <div className="space-y-4 bg-white p-5">
          <SectionTitle
            title="Rules & guardrails"
            hint="Hard constraints injected into AI context"
            action={() =>
              setRules((current) => [
                ...current,
                { ruleType: "do", description: "" },
              ])
            }
          />
          {rules.map((rule, index) => (
            <EditorCard
              key={index}
              onRemove={() =>
                setRules((current) =>
                  current.filter((_, row) => row !== index),
                )
              }
            >
              <select
                value={rule.ruleType}
                onChange={(event) =>
                  setRules((current) =>
                    current.map((item, row) =>
                      row === index
                        ? { ...item, ruleType: event.target.value }
                        : item,
                    ),
                  )
                }
                className="h-10 w-full rounded-xl border border-black/[0.07] bg-neutral-50 px-3 text-[9px] font-semibold outline-none"
              >
                <option value="do">Do</option>
                <option value="dont">Don&apos;t</option>
                <option value="must_include">Must include</option>
                <option value="claim">Claim constraint</option>
                <option value="compliance">Compliance</option>
              </select>
              <TextArea
                value={rule.description}
                onChange={(value) =>
                  setRules((current) =>
                    current.map((item, row) =>
                      row === index
                        ? { ...item, description: value }
                        : item,
                    ),
                  )
                }
                placeholder="Describe the constraint"
              />
            </EditorCard>
          ))}
          {!rules.length && <EmptyRows label="rule" />}
        </div>
      </div>
    </section>
  );
}

function SectionTitle({
  title,
  hint,
  action,
}: {
  title: string;
  hint: string;
  action?: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-[11px] font-semibold">{title}</p>
        <p className="mt-0.5 text-[8px] text-muted-foreground">{hint}</p>
      </div>
      {action && (
        <button
          type="button"
          onClick={action}
          className="inline-flex h-8 items-center gap-1 rounded-lg border border-black/[0.06] px-2.5 text-[8px] font-semibold"
        >
          <Plus className="h-3 w-3" />
          Add
        </button>
      )}
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
    <label className="block">
      <span className="mb-1.5 block text-[9px] font-semibold text-neutral-500">
        {label}
      </span>
      {children}
    </label>
  );
}

function TextArea({
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full resize-none rounded-xl border border-black/[0.07] bg-neutral-50 p-3 text-[9px] leading-4 outline-none"
    />
  );
}

function EditorCard({
  children,
  onRemove,
}: {
  children: React.ReactNode;
  onRemove: () => void;
}) {
  return (
    <div className="relative space-y-2 rounded-2xl border border-black/[0.055] bg-neutral-50/50 p-3 pr-11">
      {children}
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-lg text-neutral-400 hover:bg-red-50 hover:text-red-600"
        aria-label="Remove row"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function EmptyRows({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed border-black/[0.08] p-5 text-center text-[9px] text-muted-foreground">
      No {label} configured.
    </div>
  );
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-[9px] text-red-700">
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      {children}
    </div>
  );
}
