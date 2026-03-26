export function adaptPlan(metrics: any) {
  if (metrics.completionRate < 0.4) {
    return {
      action: "reduce_difficulty",
      reason: "User struggling",
    };
  }

  if (metrics.completionRate > 0.8) {
    return {
      action: "increase_difficulty",
      reason: "User performing well",
    };
  }

  return {
    action: "maintain",
    reason: "Balanced performance",
  };
}