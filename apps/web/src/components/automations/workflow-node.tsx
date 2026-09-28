import { Handle, Position } from "@xyflow/react";
import type { ReactNode } from "react";
import {
  Calendar,
  CheckCircle2,
  Image as ImageIcon,
  Play,
  Settings,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type WorkflowNodeType =
  | "trigger"
  | "generate"
  | "image"
  | "review"
  | "schedule";

const icons: Record<WorkflowNodeType, ReactNode> = {
  trigger: <Play className="h-3.5 w-3.5 text-emerald-600" />,
  generate: <Sparkles className="h-3.5 w-3.5 text-[#ef2b2d]" />,
  image: <ImageIcon className="h-3.5 w-3.5 text-violet-600" />,
  review: <CheckCircle2 className="h-3.5 w-3.5 text-amber-600" />,
  schedule: <Calendar className="h-3.5 w-3.5 text-blue-600" />,
};

export function WorkflowNode({
  data,
  selected,
}: {
  data: {
    label: string;
    type: WorkflowNodeType;
    description?: string;
  };
  selected?: boolean;
}) {
  return (
    <div
      className={cn(
        "min-w-[220px] rounded-2xl border bg-white shadow-[0_8px_24px_rgba(15,23,42,0.06)] transition",
        selected
          ? "border-[#ef2b2d]/40 ring-4 ring-[#ef2b2d]/8"
          : "border-black/[0.07] hover:border-black/15",
      )}
    >
      {data.type !== "trigger" && (
        <Handle
          type="target"
          position={Position.Left}
          className="!-ml-1.5 !h-3 !w-3 !rounded-full !border-2 !border-white !bg-neutral-400"
        />
      )}

      <div className="flex items-start gap-3 p-4">
        <div className="sostats-icon h-9 w-9 shrink-0">
          {icons[data.type] || <Settings className="h-3.5 w-3.5" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-semibold">{data.label}</p>
          {data.description && (
            <p className="mt-1 line-clamp-2 text-[9px] leading-4 text-muted-foreground">
              {data.description}
            </p>
          )}
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!-mr-1.5 !h-3 !w-3 !rounded-full !border-2 !border-white !bg-[#ef2b2d]"
      />
    </div>
  );
}
