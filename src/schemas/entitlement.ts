export const entitlementQuerySchema = {
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
