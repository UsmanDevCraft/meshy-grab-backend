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

export const entitlementResponseSchema = {
  200: {
    type: "object",
    properties: {
      exists: { type: "boolean" },
      userId: { type: ["string", "null"] },
      email: { type: ["string", "null"] },
      isPaid: { type: "boolean" },
      plan: { type: "string" },
      freeDownloadsUsed: { type: "number" },
      freeDownloadsRemaining: { type: ["number", "null"] },
      textureDownloadsUsed: { type: "number" },
      textureDownloadsRemaining: { type: ["number", "null"] },
      communityModelsUsed: { type: ["number", "null"] },
      communityModelsRemaining: { type: ["number", "null"] },
      communityModelsLimit: { type: ["number", "null"] },
      subscriptionStatus: { type: "string" },
      paddleCustomerId: { type: ["string", "null"] },
      paddleSubscriptionId: { type: ["string", "null"] },
      paidAt: { type: ["string", "null"] },
      accountType: { type: "string" },
      ownerUserId: { type: ["string", "null"] },
      accountSlots: { type: "number" },
      linkedAccountsCount: { type: "number" },
      linkedAccountsRemaining: { type: "number" },
    },
  },
  400: {
    type: "object",
    properties: {
      error: { type: "string" },
    },
  },
} as const;
