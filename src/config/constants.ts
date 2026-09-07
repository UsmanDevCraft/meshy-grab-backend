export const FREE_DOWNLOAD_LIMIT = 2;
export const FREE_TEXTURE_DOWNLOAD_LIMIT = 8;

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

export const DOWNLOAD_TYPES = {
  GLB: "glb",
  OBJ: "obj",
  FBX: "fbx",
} as const;

export const ALLOWED_DOWNLOAD_TYPES = ["glb", "obj", "fbx"] as const;
export type DownloadType = (typeof ALLOWED_DOWNLOAD_TYPES)[number];

export const API = {
  VERSION: "v1",
} as const;
