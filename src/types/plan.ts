export type Plan =
  | "pro_monthly"
  | "pro_annual"
  | "pro_max_monthly"
  | "lifetime"
  | null;

export const PLANS = {
  PRO_MONTHLY: "pro_monthly",
  PRO_ANNUAL: "pro_annual",
  PRO_MAX_MONTHLY: "pro_max_monthly",
  LIFETIME: "lifetime",
} as const;

export const VALID_PLANS = [
  PLANS.PRO_MONTHLY,
  PLANS.PRO_ANNUAL,
  PLANS.PRO_MAX_MONTHLY,
  PLANS.LIFETIME,
] as const;

export type ValidPlan = (typeof VALID_PLANS)[number];

export function isValidPlan(plan: any): plan is ValidPlan {
  return typeof plan === "string" && VALID_PLANS.includes(plan as ValidPlan);
}
