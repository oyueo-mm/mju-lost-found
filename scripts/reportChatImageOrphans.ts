// Read-only report on the private chat-images bucket: which objects no
// Message references (orphans), and which Message rows point at an object
// that doesn't exist. It never deletes or changes anything.
//
// Where orphans come from: a user uploads an image (POST
// /api/chat/[id]/upload) and then never sends the message (closes the
// page, send fails), or a Storage delete after a message delete failed
// (logged as "Failed to delete chat image"). An object younger than
// --min-age-hours (default 24) is reported separately as "recent": it may
// be an upload whose message is about to be sent.
//
// If orphans need removing, do it deliberately by path after checking this
// report (Supabase Dashboard or a one-off script) -- see docs/operations.md.
//
//   npx tsx --env-file=.env.preview.local scripts/reportChatImageOrphans.ts
//   npx tsx --env-file=.env scripts/reportChatImageOrphans.ts --min-age-hours 24
import { createClient } from "@supabase/supabase-js";

import { prisma } from "@/lib/db/prisma";
import { CHAT_IMAGES_BUCKET } from "@/lib/images/config";

type StoredObject = { path: string; createdAt: Date | null; size: number | null };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (pass --env-file).");
  const minAgeHours = Number(arg("--min-age-hours") ?? 24);
  const bucket = createClient(url, key, { auth: { persistSession: false } }).storage.from(CHAT_IMAGES_BUCKET);

  const objects: StoredObject[] = [];
  async function walk(prefix: string) {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await bucket.list(prefix, { limit: 1000, offset });
      if (error) throw new Error(`list ${prefix || "/"} failed: ${error.message}`);
      for (const entry of data ?? []) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.id) {
          objects.push({ path, createdAt: entry.created_at ? new Date(entry.created_at) : null, size: entry.metadata?.size ?? null });
        } else {
          await walk(path);
        }
      }
      if ((data ?? []).length < 1000) break;
    }
  }
  await walk("");

  const referenced = new Set(
    (await prisma.message.findMany({ where: { imagePath: { not: null } }, select: { imagePath: true } })).map((m) => m.imagePath as string),
  );
  const stored = new Set(objects.map((o) => o.path));
  const cutoff = Date.now() - minAgeHours * 3600 * 1000;

  const unreferenced = objects.filter((o) => !referenced.has(o.path));
  const orphans = unreferenced.filter((o) => o.createdAt !== null && o.createdAt.getTime() < cutoff);
  const recent = unreferenced.filter((o) => !orphans.includes(o));
  const missing = [...referenced].filter((p) => !stored.has(p));

  console.log(
    JSON.stringify(
      {
        bucket: CHAT_IMAGES_BUCKET,
        objects: objects.length,
        referencedByMessages: referenced.size,
        orphansOlderThanHours: { hours: minAgeHours, count: orphans.length, bytes: orphans.reduce((n, o) => n + (o.size ?? 0), 0), paths: orphans.slice(0, 50).map((o) => o.path) },
        recentUnreferenced: recent.length,
        messagesPointingAtMissingObjects: { count: missing.length, paths: missing.slice(0, 50) },
      },
      null,
      1,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
