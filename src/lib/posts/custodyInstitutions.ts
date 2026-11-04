import { prisma } from "@/lib/db/prisma";
import type { CustodyInstitution } from "./custodySchema";

// 보관 상태 > 기관에 맡김 suggestions: the service's registered 관리 기관
// (active organizations with a management campus), read-only. A failure only
// leaves the suggestions out; free text always works.
export async function listCustodyInstitutions(): Promise<CustodyInstitution[]> {
  try {
    const rows = await prisma.organization.findMany({
      where: { managementCampus: { not: null }, status: "ACTIVE" },
      select: { name: true, managementCampus: true },
      orderBy: { name: "asc" },
    });
    return rows.map((r) => ({ name: r.name, campus: r.managementCampus! }));
  } catch (error) {
    console.error("Failed to load custody institutions", error);
    return [];
  }
}
