import type { SessionStatus, SessionType } from "@repo/types";
import { SESSION_STATUS, SESSION_TYPE } from "@repo/constants";

export type { SessionStatus, SessionType };

export function getGenerateButtonLabel(
  sessionStatus: SessionStatus,
  sessionType: SessionType,
  generating: boolean
) {
  if (generating) return "Generating...";
  if (sessionStatus === SESSION_STATUS.ACTIVE) return "Continue Today";
  if (sessionStatus === SESSION_STATUS.FAILED) return "Retry Session";
  if (sessionStatus === SESSION_STATUS.COMPLETED && sessionType === SESSION_TYPE.PRIMARY) return "Do More Today";
  if (sessionStatus === SESSION_STATUS.COMPLETED && sessionType === SESSION_TYPE.BONUS) return "Daily Limit Reached";
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
    (sessionStatus === SESSION_STATUS.COMPLETED && sessionType === SESSION_TYPE.BONUS)
  );
}

export function getCompletionCtaVariant(sessionType: SessionType) {
  if (sessionType === SESSION_TYPE.PRIMARY) {
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
