// One-time bootstrap: makes the operator's own account the FIRST admin after
// the Production data reset, when no admin exists to approve a grant through
// the normal in-app flow (AdminActionProposal GRANT_ADMIN). Deliberately narrow:
//   - refuses if any admin already exists -- every later admin goes through the
//     proposal/approval flow, so this is never a standing bypass;
//   - the account must already exist (the operator signs in with Google once
//     first), match the exact email, and not be withdrawn or suspended;
//   - dry run by default; --apply writes; against Production it also needs
//     --confirm-production.
//
//   npx tsx --env-file=.env scripts/grantFirstAdmin.ts --email you@example.com
//   npx tsx --env-file=.env scripts/grantFirstAdmin.ts --email you@example.com --apply --confirm-production
import { prisma } from "@/lib/db/prisma";

const PRODUCTION_REF = "tmifqtyxojtuoejxjrng";
const PREVIEW_REF = "swqvlihgupranzfzjevb";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const db = process.env.DATABASE_URL ?? "";
  const environment = db.includes(PRODUCTION_REF) ? "Production" : db.includes(PREVIEW_REF) ? "Preview" : "unknown";
  if (environment === "unknown") throw new Error("DATABASE_URL is neither the Production nor the Preview project.");
  const email = arg("--email")?.trim().toLowerCase();
  if (!email) throw new Error("--email <address> is required.");
  const apply = process.argv.includes("--apply");
  if (apply && environment === "Production" && !process.argv.includes("--confirm-production")) {
    throw new Error("Writing to Production needs --confirm-production as well.");
  }

  const admins = await prisma.user.count({ where: { isAdmin: true } });
  if (admins > 0) throw new Error(`${admins} admin(s) already exist -- use the in-app admin grant flow instead.`);

  const users = await prisma.user.findMany({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, publicId: true, nickname: true, deletedAt: true, isSuspended: true, isAdmin: true },
  });
  if (users.length !== 1) throw new Error(`Expected exactly one account for that email, found ${users.length}. Sign in with Google first.`);
  const [user] = users;
  if (user.deletedAt) throw new Error("That account is withdrawn.");
  if (user.isSuspended) throw new Error("That account is suspended.");

  console.log(JSON.stringify({ environment, userId: user.id, publicId: user.publicId, nickname: user.nickname, apply }));
  if (!apply) {
    console.log("dry run -- nothing written (add --apply)");
    return;
  }
  // Re-check inside the write so two concurrent runs can't both pass the "no admin yet" check.
  const updated = await prisma.$transaction(async (tx) => {
    if ((await tx.user.count({ where: { isAdmin: true } })) > 0) throw new Error("An admin appeared meanwhile -- aborting.");
    return tx.user.update({ where: { id: user.id }, data: { isAdmin: true }, select: { id: true, isAdmin: true } });
  });
  console.log(JSON.stringify({ granted: updated.isAdmin, userId: updated.id }));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
