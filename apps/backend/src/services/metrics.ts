export function computeMetrics(tasks: any[]) {
  const total = tasks.length;

  const done = tasks.filter((t) => t.status === "done").length;
  const skipped = tasks.filter((t) => t.status === "skipped").length;

  const completionRate = total === 0 ? 0 : done / total;

  return {
    total,
    done,
    skipped,
    completionRate,
  };
}