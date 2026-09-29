import type { LucideIcon } from "lucide-react";

type MetricTone = "neutral" | "positive" | "attention";

export function MetricCard({
  label,
  value,
  change,
  icon: Icon,
  bars = [],
  tone = "neutral",
}: {
  label: string;
  value: string;
  change: string;
  icon: LucideIcon;
  bars?: number[];
  tone?: MetricTone;
}) {
  const changeClass =
    tone === "positive"
      ? "text-emerald-600"
      : tone === "attention"
        ? "text-[#df272a]"
        : "text-muted-foreground";

  return (
    <div className="sostats-card min-w-0 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
          <p className="mt-1 text-[25px] font-semibold tracking-[-0.04em] text-neutral-950">
            {value}
          </p>
        </div>
        <div className="sostats-icon h-8 w-8">
          <Icon className="h-3.5 w-3.5 text-neutral-500" />
        </div>
      </div>
      <div className="mt-4 flex items-end justify-between gap-3">
        <p className={`text-[10px] font-medium ${changeClass}`}>{change}</p>
        {bars.length ? (
          <div className="flex h-7 items-end gap-1" aria-label="Live metric distribution">
            {bars.map((height, index) => (
              <span
                key={index}
                className={
                  index === bars.length - 1
                    ? "w-1.5 rounded-full bg-[#ef2b2d]"
                    : "w-1.5 rounded-full bg-neutral-200"
                }
                style={{ height: `${Math.max(4, Math.min(100, height))}%` }}
              />
            ))}
          </div>
        ) : (
          <span className="text-[9px] text-neutral-300">No trend yet</span>
        )}
      </div>
    </div>
  );
}
