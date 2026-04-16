"use client";

type Task = {
  id: string;
  goal_id: string;
  status: string;
  completed_at?: string;
  skipped_at?: string;
  created_at: string;
  scheduled_date: string;
};

export default function DailySummary({
  tasks,
  onOpenCoachFlow,
}: {
  tasks: Task[];
  onOpenCoachFlow?: () => void;
}) {
  if (!tasks || tasks.length === 0) return null;

  const today = new Date().toISOString().split("T")[0];

  const completedToday = tasks.filter(
    t => t.completed_at?.startsWith(today)
  );

  const skippedToday = tasks.filter(
    t => t.skipped_at?.startsWith(today)
  );

  const totalToday = completedToday.length + skippedToday.length;

  const done = completedToday.length;
  const skipped = skippedToday.length;
  const completionRate = totalToday ? done / totalToday : 0;
  const percent = Math.round(completionRate * 100);

  return (
    <div className="max-w-2xl mx-auto mt-6 p-4 border rounded bg-gray-50">
      <h2 className="text-lg font-semibold mb-2">Your Progress</h2>

      {/* Stats */}
      <div className="text-sm text-gray-700 space-y-1">
        <p>Done today: {done}</p>
        <p>Skipped today: {skipped}</p>
        <p>Completion: {percent}%</p>
      </div>

      {/* Progress Bar */}
      <div className="w-full bg-gray-200 rounded h-2 mt-3">
        <div
          className="bg-blue-500 h-2 rounded transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* Feedback Layer (UX upgrade) */}
      <div className="mt-3 text-sm font-medium">
        {percent === 100 && "🔥 Perfect day. Keep the streak alive."}
        {percent >= 60 && percent < 100 && "💪 Good progress. Finish strong."}
        {percent > 0 && percent < 60 && "⚡ Momentum started. Keep going."}
        {percent === 0 && "🚀 Start small. Just complete one task."}
      </div>

      {onOpenCoachFlow ? (
        <button
          type="button"
          onClick={onOpenCoachFlow}
          className="mt-4 inline-flex items-center rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-100 transition hover:bg-slate-800"
        >
          Open Coach Flow
        </button>
      ) : null}
    </div>
  );
}