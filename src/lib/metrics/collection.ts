import { prisma } from "@/lib/db/prisma";

export async function audienceCollectionDay(): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ day: Date | string }[]>`SELECT day FROM "OperationalMetricDaily" WHERE metric = 'meta.since.audience_snapshot' ORDER BY day LIMIT 1`;
  const day = rows[0]?.day;
  return day instanceof Date ? day.toISOString().slice(0, 10) : typeof day === "string" ? day.slice(0, 10) : null;
}
