export const installBodySchema = {
  type: "object",

  required: ["installationId", "email"],

  additionalProperties: false,

  properties: {
    installationId: {
      type: "string",
      minLength: 1,
      maxLength: 128,
    },

    email: {
      type: "string",
      minLength: 1,
      maxLength: 255,
    },
  },
} as const;

export const installResponseSchema = {
  200: {
    type: "object",
    properties: {
      created: { type: "boolean" },
      userId: { type: "string" },
      installationId: { type: "string" },
    },
  },
  201: {
    type: "object",
    properties: {
      created: { type: "boolean" },
      userId: { type: "string" },
      installationId: { type: "string" },
    },
  },
  400: {
    type: "object",
    properties: {
      error: { type: "string" },
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
