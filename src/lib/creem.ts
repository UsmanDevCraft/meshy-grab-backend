import { Creem } from "creem";
import { env } from "../config/env.js";

const apiKey = env.CREEM_API_KEY;
const isTestMode =
  apiKey.startsWith("creem_test_") || apiKey.startsWith("ck_test_");

export const creem = new Creem({
  apiKey,
  server: isTestMode ? "test" : "prod",
});
