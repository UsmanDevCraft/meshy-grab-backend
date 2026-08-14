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
