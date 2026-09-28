import { Handle, Position } from '@xyflow/react';
import { type ReactNode } from 'react';
import { Settings, Play, Image as ImageIcon, CheckCircle, Calendar, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

export type WorkflowNodeType = 'trigger' | 'generate' | 'image' | 'review' | 'schedule';

interface WorkflowNodeProps {
  data: {
    label: string;
    type: WorkflowNodeType;
    description?: string;
  };
  selected?: boolean;
}

const icons: Record<WorkflowNodeType, ReactNode> = {
  trigger: <Play className="w-4 h-4 text-green-500" />,
  generate: <FileText className="w-4 h-4 text-blue-500" />,
  image: <ImageIcon className="w-4 h-4 text-purple-500" />,
  review: <CheckCircle className="w-4 h-4 text-orange-500" />,
  schedule: <Calendar className="w-4 h-4 text-indigo-500" />,
};

export function WorkflowNode({ data, selected }: WorkflowNodeProps) {
  return (
    <div
      className={cn(
        "min-w-[200px] bg-white dark:bg-zinc-900 border-2 rounded-xl shadow-sm transition-all",
        selected ? "border-blue-500 shadow-md ring-4 ring-blue-500/10" : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700"
      )}
    >
      {/* Target handle (input) */}
      {data.type !== 'trigger' && (
        <Handle
          type="target"
          position={Position.Left}
          className="w-3 h-3 border-2 border-white dark:border-zinc-900 bg-zinc-400 dark:bg-zinc-600 rounded-full -ml-1.5"
        />
      )}
      
      <div className="p-4 flex items-start gap-3">
        <div className="p-2 bg-zinc-50 dark:bg-zinc-800 rounded-lg flex-shrink-0">
          {icons[data.type] || <Settings className="w-4 h-4 text-zinc-500" />}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
            {data.label}
          </h3>
          {data.description && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2 mt-1">
              {data.description}
            </p>
          )}
        </div>
      </div>

      {/* Source handle (output) */}
      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 border-2 border-white dark:border-zinc-900 bg-blue-500 rounded-full -mr-1.5"
      />
    </div>
  );
}
