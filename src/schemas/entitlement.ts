export const entitlementQuerySchema = {
  type: "object",
  required: ["installationId"],
  additionalProperties: false,

  properties: {
    installationId: {
      type: "string",
      minLength: 1,
      maxLength: 128,
    },
  },
} as const;
