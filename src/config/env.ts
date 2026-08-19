function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} environment variable is required`);
  }

  return value;
}

export const env = {
  DATABASE_URL: requireEnv("DATABASE_URL"),

  CREEM_API_KEY: requireEnv("CREEM_API_KEY"),
  CREEM_PRODUCT_ID: requireEnv("CREEM_PRODUCT_ID"),
  CREEM_WEBHOOK_SECRET: requireEnv("CREEM_WEBHOOK_SECRET"),

  FRONTEND_SUCCESS_URL: requireEnv("FRONTEND_SUCCESS_URL"),

  NODE_ENV: process.env.NODE_ENV ?? "development",

  PORT: Number(process.env.PORT ?? 3000),
};
