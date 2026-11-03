import { cookies } from "next/headers";

import { prisma } from "@/lib/db/prisma";

// Signing out forgets this device's chat-push subscription (the one saved
// from this browser, remembered in an httpOnly cookie), so a shared phone or
// PC stops receiving the previous account's chat notifications. Other
// devices of the account are untouched. Never fails a sign-out.
export async function forgetThisDevicePush(userId: number | null | undefined): Promise<void> {
  try {
    const jar = await cookies();
    const id = Number(jar.get("mju-push-device")?.value);
    if (userId && Number.isInteger(id) && id > 0) await prisma.pushSubscription.deleteMany({ where: { id, userId } });
    jar.delete("mju-push-device");
  } catch (error) {
    console.error("Failed to forget this device's push subscription", (error as Error)?.message);
  }
}
