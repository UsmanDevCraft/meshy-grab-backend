export const consumeTextureBodySchema = {
  type: "object",
  required: ["installationId"],
  additionalProperties: true,
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
  },
} as const;

export const consumeTextureResponseSchema = {
  200: {
    type: "object",
    properties: {
      allowed: { type: "boolean" },
      duplicate: { type: "boolean" },
      plan: { type: "string" },
      textureDownloadsUsed: { type: ["number", "null"] },
      textureDownloadsRemaining: { type: ["number", "null"] },
    },
  },
  403: {
    type: "object",
    properties: {
      error: { type: "string" },
      message: { type: "string" },
      textureDownloadsRemaining: { type: "number" },
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
