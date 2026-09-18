import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { downloads } from "../db/schema.js";

export function normalizeSource(
  source?: string | null,
): "workspace" | "community" {
  if (!source || !source.trim()) {
    return "workspace";
  }
  const normalized = source.trim().toLowerCase();
  if (normalized === "community") {
    return "community";
  }
  return "workspace";
}

export async function getCommunityModelsUsed(
  userId: string,
  tx?: any,
): Promise<number> {
  const runner = tx ?? db;
  const [result] = await runner
    .select({
      count: sql<number>`count(distinct ${downloads.modelId})::int`,
    })
    .from(downloads)
    .where(
      and(eq(downloads.userId, userId), eq(downloads.source, "community")),
    );

  return result?.count ?? 0;
}
