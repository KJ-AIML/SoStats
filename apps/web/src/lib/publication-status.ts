export function statusTone(status: string) {
  switch (status) {
    case "published":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "failed":
      return "border-red-200 bg-red-50 text-red-700";
    case "publishing":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "cancelled":
      return "border-neutral-200 bg-neutral-100 text-neutral-500";
    case "unknown":
    case "needs_review":
      return "border-orange-200 bg-orange-50 text-orange-700";
    default:
      return "border-[#ef2b2d]/10 bg-[#fff7f7] text-[#d92023]";
  }
}

export function statusLabel(status: string) {
  if (status === "unknown") return "Unconfirmed";
  if (status === "needs_review") return "Needs review";
  return status.replaceAll("_", " ");
}
