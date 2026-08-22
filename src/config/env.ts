function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} environment variable is required`);
  }

  return value;
}

export const env = {
  DATABASE_URL: requireEnv("DATABASE_URL"),

  FRONTEND_SUCCESS_URL: requireEnv("FRONTEND_SUCCESS_URL"),

  PADDLE_API_KEY: requireEnv("PADDLE_API_KEY"),
  PADDLE_WEBHOOK_SECRET: requireEnv("PADDLE_WEBHOOK_SECRET"),
  PADDLE_PRICE_ID: requireEnv("PADDLE_PRICE_ID"),
  PADDLE_CLIENT_TOKEN: requireEnv("PADDLE_CLIENT_TOKEN"),

  NODE_ENV: process.env.NODE_ENV ?? "development",

  PORT: Number(process.env.PORT ?? 3000),
};
