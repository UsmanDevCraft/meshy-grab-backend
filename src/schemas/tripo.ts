export const consumeTripoDownloadBodySchema = {
  type: "object",
  required: ["installationId"],
  properties: {
    installationId: {
      type: "string",
      minLength: 1,
      maxLength: 128,
    },
    tripoModelId: {
      type: ["string", "null"],
      maxLength: 255,
    },
    modelId: {
      type: ["string", "null"],
      maxLength: 255,
    },
    modelKey: {
      type: ["string", "null"],
      maxLength: 255,
    },
    downloadType: {
      type: ["string", "null"],
      maxLength: 128,
    },
    entitlementOrigin: {
      type: ["string", "null"],
      maxLength: 64,
    },
  },
} as const;

export const consumeTripoDownloadResponseSchema = {
  200: {
    type: "object",
    properties: {
      allowed: { type: "boolean" },
      downloadId: { type: "string" },
      plan: { type: "string" },
      tripo: {
        type: "object",
        properties: {
          studioModels: {
            type: "object",
            properties: {
              limit: { type: ["number", "null"] },
              used: { type: "number" },
              remaining: { type: ["number", "null"] },
              unlimited: { type: "boolean" },
            },
          },
        },
      },
    },
  },
  400: {
    type: "object",
    properties: {
      error: { type: "string" },
      message: { type: "string" },
    },
  },
  403: {
    type: "object",
    properties: {
      error: { type: "string" },
      message: { type: "string" },
      tripo: {
        type: "object",
        properties: {
          studioModels: {
            type: "object",
            properties: {
              limit: { type: ["number", "null"] },
              used: { type: "number" },
              remaining: { type: ["number", "null"] },
              unlimited: { type: "boolean" },
            },
          },
        },
      },
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
