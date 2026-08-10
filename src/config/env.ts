import "dotenv/config";

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export const env = {
  DATABASE_URL: requireEnv("DATABASE_URL"),

  PORT: Number(process.env.PORT ?? 3000),

  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY ?? "",

  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET ?? "",

  FRONTEND_URL: process.env.FRONTEND_URL ?? "https://meshy.ai",

  FREE_DOWNLOAD_LIMIT: Number(process.env.FREE_DOWNLOAD_LIMIT ?? 2),
};
