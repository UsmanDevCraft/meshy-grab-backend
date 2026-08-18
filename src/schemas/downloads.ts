export const consumeDownloadBodySchema = {
  type: "object",

  required: ["installationId", "taskId"],

  additionalProperties: false,

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

    previewUrl: {
      type: ["string", "null"],
      maxLength: 2048,
    },

    modelUrl: {
      type: ["string", "null"],
      maxLength: 2048,
    },
  },
} as const;
