import { ALLOWED_DOWNLOAD_TYPES } from "../config/constants.js";

export const consumeDownloadBodySchema = {
  type: "object",

  required: ["installationId"],

  additionalProperties: false,

  properties: {
    installationId: {
      type: "string",
      minLength: 1,
      maxLength: 128,
    },

    taskId: {
      type: "string",
      nullable: true,
      minLength: 1,
      maxLength: 128,
    },

    previewUrl: {
      type: "string",
      nullable: true,
      maxLength: 2048,
    },

    modelUrl: {
      type: "string",
      nullable: true,
      maxLength: 2048,
    },

    downloadType: {
      type: "string",
      nullable: true,
      maxLength: 128,
    },

    source: {
      type: "string",
      nullable: true,
      maxLength: 32,
      enum: ["workspace", "community"],
    },

    modelKey: {
      type: "string",
      nullable: true,
      minLength: 1,
      maxLength: 128,
    },
  },
} as const;

export const consumeDownloadResponseSchema = {
  200: {
    type: "object",
    properties: {
      allowed: { type: "boolean" },
      duplicate: { type: "boolean" },
      plan: { type: "string" },
      source: { type: ["string", "null"] },
      freeDownloadsUsed: { type: ["number", "null"] },
      freeDownloadsRemaining: { type: ["number", "null"] },
      communityModelsUsed: { type: ["number", "null"] },
      communityModelsRemaining: { type: ["number", "null"] },
      communityModelsLimit: { type: ["number", "null"] },
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
      freeDownloadsRemaining: { type: ["number", "null"] },
      communityModelsUsed: { type: ["number", "null"] },
      communityModelsRemaining: { type: ["number", "null"] },
      communityModelsLimit: { type: ["number", "null"] },
    },
  },
  404: {
    type: "object",
    properties: {
      error: { type: "string" },
      message: { type: "string" },
    },
  },
} as const;
