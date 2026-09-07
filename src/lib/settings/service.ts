import { prisma } from "@/lib/db/prisma";

// Phase H-3: singleton row (id=1) -- see schema.prisma's own comment on
// AppSettings for why this stays a single-row table rather than a
// generic key/value store. A missing row (never created yet, or the very
// first read after migration) is treated identically to
// googleTestModeEnabled=false -- upserted into existence on first read so
// every caller always gets a real row back, never has to null-check.
const SETTINGS_ID = 1;

export type AppSettingsDTO = {
  googleTestModeEnabled: boolean;
  updatedAt: Date;
  updatedByNickname: string | null;
};

// Read-only, no auth of its own -- called from both the NextAuth signIn
// callback (which runs for *any* Google sign-in attempt, before there is
// even a User row to check permissions against) and the admin settings
// UI. Never exposes anything beyond the one boolean + audit fields.
export async function getAppSettings(): Promise<AppSettingsDTO> {
  const row = await prisma.appSettings.upsert({
    where: { id: SETTINGS_ID },
    update: {},
    create: { id: SETTINGS_ID },
    include: { updatedBy: { select: { nickname: true } } },
  });
  return {
    googleTestModeEnabled: row.googleTestModeEnabled,
    updatedAt: row.updatedAt,
    updatedByNickname: row.updatedBy?.nickname ?? null,
  };
}

// Convenience used only by the signIn callback -- avoids that call site
// needing to import AppSettingsDTO just to read one field, and keeps a
// DB error there failing closed (see auth.ts's own try/catch around this
// call) rather than accidentally opening the gate.
export async function isGoogleTestModeEnabled(): Promise<boolean> {
  const settings = await getAppSettings();
  return settings.googleTestModeEnabled;
}

export type SettingsMutationResult<T> = { kind: "ok"; data: T } | { kind: "forbidden" };

// admin is passed in (not re-fetched) the same way every other admin
// mutation in this app takes an already-authenticated `User` -- the
// caller (the API route) is responsible for having obtained it via
// requireAdminForApi() moments earlier, never from client-supplied state.
// isAdmin() is re-checked here anyway, same belt-and-suspenders
// convention every admin-only service function in this project follows.
export async function setGoogleTestMode(
  admin: { id: number; isAdmin: boolean },
  enabled: boolean,
): Promise<SettingsMutationResult<AppSettingsDTO>> {
  // Same one-line DB-sourced check as moderation/service.ts::isAdmin(),
  // duplicated rather than imported so this settings module (imported by
  // the NextAuth signIn callback, see auth.ts) doesn't pull in that
  // module's own heavier transitive imports (report/service.ts, report
  // targets, etc.) into the auth bundle for a single boolean field read.
  if (!admin.isAdmin) return { kind: "forbidden" };

  const row = await prisma.appSettings.upsert({
    where: { id: SETTINGS_ID },
    update: { googleTestModeEnabled: enabled, updatedByUserId: admin.id },
    create: { id: SETTINGS_ID, googleTestModeEnabled: enabled, updatedByUserId: admin.id },
    include: { updatedBy: { select: { nickname: true } } },
  });
  return {
    kind: "ok",
    data: {
      googleTestModeEnabled: row.googleTestModeEnabled,
      updatedAt: row.updatedAt,
      updatedByNickname: row.updatedBy?.nickname ?? null,
    },
  };
}
