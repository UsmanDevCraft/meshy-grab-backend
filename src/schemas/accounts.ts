export const linkAccountBodySchema = {
  type: "object",
  required: ["meshyEmail"],
  properties: {
    meshyEmail: {
      type: "string",
      minLength: 3,
      maxLength: 255,
    },
    installationId: {
      type: "string",
      minLength: 1,
      maxLength: 128,
    },
    userId: {
      type: "string",
      minLength: 1,
      maxLength: 128,
    },
  },
  additionalProperties: true,
} as const;

export const accountsQuerySchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    installationId: {
      type: "string",
      minLength: 1,
      maxLength: 128,
    },
    userId: {
      type: "string",
      minLength: 1,
      maxLength: 128,
    },
  },
} as const;

export const linkAccountResponseSchema = {
  201: {
    type: "object",
    properties: {
      accountType: { type: "string" },
      ownerUserId: { type: "string" },
      accountSlots: { type: "number" },
      linkedAccountsCount: { type: "number" },
      linkedAccountsRemaining: { type: "number" },
      accounts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            meshyEmail: { type: "string" },
            createdAt: { type: "string" },
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
    },
  },
  409: {
    type: "object",
    properties: {
      error: { type: "string" },
      message: { type: "string" },
    },
  },
} as const;
