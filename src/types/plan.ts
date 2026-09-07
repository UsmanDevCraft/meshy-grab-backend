export type Plan = "pro_monthly" | "pro_annual" | "lifetime" | null;

export const PLANS = {
  PRO_MONTHLY: "pro_monthly",
  PRO_ANNUAL: "pro_annual",
  LIFETIME: "lifetime",
} as const;

export const VALID_PLANS = [
  PLANS.PRO_MONTHLY,
  PLANS.PRO_ANNUAL,
  PLANS.LIFETIME,
] as const;

export type ValidPlan = (typeof VALID_PLANS)[number];

export function isValidPlan(plan: any): plan is ValidPlan {
  return typeof plan === "string" && VALID_PLANS.includes(plan as ValidPlan);
}
