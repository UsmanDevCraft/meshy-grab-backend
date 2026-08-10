export const FREE_DOWNLOAD_LIMIT = 2;

export const DOWNLOAD_EVENT_STATUSES = {
  CONSUMED: "consumed",
} as const;

export const SUBSCRIPTION_STATUSES = {
  INACTIVE: "inactive",
  ACTIVE: "active",
  TRIALING: "trialing",
  CANCELED: "canceled",
  PAST_DUE: "past_due",
} as const;

export const API = {
  VERSION: "v1",
} as const;
