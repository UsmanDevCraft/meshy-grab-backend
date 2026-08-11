export const consumeDownloadBodySchema = {
  type: "object",
  required: ["installationId", "downloadId"],

  additionalProperties: false,

  properties: {
    installationId: {
      type: "string",
      minLength: 1,
      maxLength: 128,
    },

    downloadId: {
      type: "string",
      minLength: 1,
      maxLength: 128,
    },
  },
} as const;
