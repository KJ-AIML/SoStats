import { WorkflowCanvas } from '@/components/automations/workflow-canvas';

export default function AutomationsPage() {
  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800">
        <div>
          <h1 className="text-xl font-bold text-zinc-900 dark:text-white">Automations</h1>
          <p className="text-sm text-zinc-500 mt-1">Design your automated content workflows.</p>
        </div>
        <div className="flex gap-2">
          <button className="px-4 py-2 text-sm font-medium text-zinc-700 bg-white border border-zinc-200 rounded-md hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:border-zinc-800 dark:hover:bg-zinc-800 transition-colors">
            Discard Draft
          </button>
          <button className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors">
            Publish Workflow
          </button>
        </div>
      </div>
      
      <WorkflowCanvas />
    </div>
  );
}
