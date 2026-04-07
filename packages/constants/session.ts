export const SESSION_STATUS = {
  NONE: "none",
  ACTIVE: "active",
  COMPLETED: "completed",
  FAILED: "failed",
} as const;

export const SESSION_TYPE = {
  PRIMARY: "primary",
  BONUS: "bonus",
} as const;

export const DEFAULT_SESSION_TYPE = SESSION_TYPE.PRIMARY;
