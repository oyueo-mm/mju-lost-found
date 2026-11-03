"use server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { saveInstitution, setAdminPermissions } from "@/lib/institution/service";

// 권한 관리 is for full administrators only; requirePermission re-reads the
// account from the DB, and the service checks it again inside its transaction.
export async function savePermissionsAction(input: unknown) {
  const admin = await requirePermission("permissions.manage");
  const result = await setAdminPermissions(admin.id, input);
  revalidatePath("/admin/users"); revalidatePath("/admin/users/[id]", "page"); revalidatePath("/admin");
  return result;
}

// 기관 관리: registering an agency that can hold found items.
export async function saveInstitutionAction(input: unknown) {
  const admin = await requirePermission("institutions.manage");
  const result = await saveInstitution(admin.id, input);
  revalidatePath("/admin/organizations");
  return result;
}
