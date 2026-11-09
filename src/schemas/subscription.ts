export const cancelSubscriptionQuerySchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    installationId: {
      type: "string",
      minLength: 1,
      maxLength: 128,
    },
    email: {
      type: "string",
      minLength: 3,
      maxLength: 255,
      format: "email",
    },
    userId: {
      type: "string",
      minLength: 1,
      maxLength: 128,
    },
    paddleCustomerId: {
      type: "string",
    },
    paddleSubscriptionId: {
      type: "string",
    },
  },
} as const;

export const cancelSubscriptionBodySchema = {
  type: "object",
  required: ["installationId", "email"],
  additionalProperties: true,
  properties: {
    installationId: {
      type: "string",
      minLength: 1,
      maxLength: 128,
    },
    email: {
      type: "string",
      minLength: 3,
      maxLength: 255,
      format: "email",
    },
    userId: {
      type: "string",
      minLength: 1,
      maxLength: 128,
    },
    paddleCustomerId: {
      type: "string",
    },
    paddleSubscriptionId: {
      type: "string",
    },
  },
} as const;

export const cancelSubscriptionResponseSchema = {
  200: {
    type: "object",
    properties: {
      url: { type: "string" },
      cancelSubscriptionUrl: { type: "string" },
    },
    required: ["url"],
  },
  400: {
    type: "object",
    properties: {
      error: { type: "string" },
      message: { type: "string" },
    },
    required: ["error"],
  },
  403: {
    type: "object",
    properties: {
      error: { type: "string" },
      message: { type: "string" },
    },
    required: ["error"],
  },
  404: {
    type: "object",
    properties: {
      error: { type: "string" },
      message: { type: "string" },
    },
    required: ["error"],
  },
  502: {
    type: "object",
    properties: {
      error: { type: "string" },
      message: { type: "string" },
    },
    required: ["error"],
  },
} as const;
