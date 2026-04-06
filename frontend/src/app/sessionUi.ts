export type SessionStatus = "none" | "active" | "completed" | "failed";
export type SessionType = "primary" | "bonus";

export function getGenerateButtonLabel(
  sessionStatus: SessionStatus,
  sessionType: SessionType,
  generating: boolean
) {
  if (generating) return "Generating...";
  if (sessionStatus === "active") return "Continue Today";
  if (sessionStatus === "failed") return "Retry Session";
  if (sessionStatus === "completed" && sessionType === "primary") return "Do More Today";
  if (sessionStatus === "completed" && sessionType === "bonus") return "Daily Limit Reached";
  return "Start Today";
}

export function isGenerateDisabled(
  sessionStatus: SessionStatus,
  sessionType: SessionType,
  generating: boolean,
  hasGoalId: boolean,
  planCompleted: boolean
) {
  return (
    !hasGoalId ||
    planCompleted ||
    generating ||
    (sessionStatus === "completed" && sessionType === "bonus")
  );
}

export function getCompletionCtaVariant(sessionType: SessionType) {
  if (sessionType === "primary") {
    return {
      heading: "You completed today's tasks",
      subheading: "Continue tomorrow or do one bonus session today.",
      actions: ["Continue Tomorrow", "Do More Today"] as const,
    };
  }

  return {
    heading: "Great momentum!",
    subheading: "You've done extra work today.",
    actions: ["Come Back Tomorrow"] as const,
  };
}
