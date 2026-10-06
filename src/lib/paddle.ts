import { Environment, Paddle } from "@paddle/paddle-node-sdk";
import { env } from "../config/env.js";

const paddleEnvironment = env.PADDLE_CLIENT_TOKEN.startsWith("live_")
  ? Environment.production
  : Environment.sandbox;

export const paddle = new Paddle(env.PADDLE_API_KEY, {
  environment: paddleEnvironment,
});
