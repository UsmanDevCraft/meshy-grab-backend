export const consumeDownloadBodySchema = {
  type: "object",

  required: ["installationId", "taskId"],

  additionalProperties: false,

  properties: {
    installationId: {
      type: "string",
      minLength: 1,
      maxLength: 128,
    },

    taskId: {
      type: "string",
      minLength: 1,
      maxLength: 128,
    },

    previewUrl: {
      type: ["string", "null"],
      maxLength: 2048,
    },

    modelUrl: {
      type: ["string", "null"],
      maxLength: 2048,
    },
  },
} as const;

export const consumeDownloadResponseSchema = {
  200: {
    type: "object",
    properties: {
      allowed: { type: "boolean" },
      duplicate: { type: "boolean" },
      plan: { type: "string" },
      freeDownloadsUsed: { type: ["number", "null"] },
      freeDownloadsRemaining: { type: ["number", "null"] },
    },
  },
  403: {
    type: "object",
    properties: {
      error: { type: "string" },
      message: { type: "string" },
      freeDownloadsRemaining: { type: "number" },
    },
  },
  404: {
    type: "object",
    properties: {
      error: { type: "string" },
      message: { type: "string" },
    },
  },
} as const;
