export const consumeUpscaleBodySchema = {
  type: "object",
  required: ["installationId", "resolution"],
  additionalProperties: false,
  properties: {
    installationId: {
      type: "string",
      minLength: 1,
      maxLength: 128,
    },
    resolution: {
      type: "string",
      enum: ["4k", "8k", "4K", "8K"],
    },
    requestId: {
      type: "string",
      nullable: true,
      maxLength: 255,
    },
    idempotencyKey: {
      type: "string",
      nullable: true,
      maxLength: 255,
    },
    taskId: {
      type: "string",
      nullable: true,
      maxLength: 128,
    },
    modelKey: {
      type: "string",
      nullable: true,
      maxLength: 128,
    },
    status: {
      type: "string",
      nullable: true,
      maxLength: 32,
    },
    success: {
      type: "boolean",
      nullable: true,
    },
  },
} as const;

export const consumeConversionBodySchema = {
  type: "object",
  required: ["installationId", "inputFormat", "outputFormat"],
  additionalProperties: false,
  properties: {
    installationId: {
      type: "string",
      minLength: 1,
      maxLength: 128,
    },
    inputFormat: {
      type: "string",
      minLength: 1,
      maxLength: 32,
    },
    outputFormat: {
      type: "string",
      minLength: 1,
      maxLength: 32,
    },
    requestId: {
      type: "string",
      nullable: true,
      maxLength: 255,
    },
    idempotencyKey: {
      type: "string",
      nullable: true,
      maxLength: 255,
    },
    taskId: {
      type: "string",
      nullable: true,
      maxLength: 128,
    },
    modelKey: {
      type: "string",
      nullable: true,
      maxLength: 128,
    },
    status: {
      type: "string",
      nullable: true,
      maxLength: 32,
    },
    success: {
      type: "boolean",
      nullable: true,
    },
  },
} as const;

export const featureConsumeResponseSchema = {
  200: {
    type: "object",
    properties: {
      allowed: { type: "boolean" },
      duplicate: { type: "boolean" },
      plan: { type: "string" },
      feature: { type: "string" },
      operationId: { type: "string" },
      resolution: { type: ["string", "null"] },
      inputFormat: { type: ["string", "null"] },
      outputFormat: { type: ["string", "null"] },
      used: { type: "number" },
      limit: { type: ["number", "null"] },
      remaining: { type: ["number", "null"] },
      unlimited: { type: "boolean" },
      period: { type: ["string", "null"] },
      periodStart: { type: ["string", "null"] },
      periodEnd: { type: ["string", "null"] },
    },
    required: ["allowed", "plan", "feature", "used", "unlimited"],
  },
  400: {
    type: "object",
    properties: {
      error: { type: "string" },
      message: { type: "string" },
    },
    required: ["error", "message"],
  },
  403: {
    type: "object",
    properties: {
      error: { type: "string" },
      message: { type: "string" },
      plan: { type: ["string", "null"] },
      used: { type: ["number", "null"] },
      limit: { type: ["number", "null"] },
      remaining: { type: ["number", "null"] },
    },
    required: ["error", "message"],
  },
  404: {
    type: "object",
    properties: {
      error: { type: "string" },
      message: { type: "string" },
    },
    required: ["error", "message"],
  },
} as const;
