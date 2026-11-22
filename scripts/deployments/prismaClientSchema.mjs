// Does the generated client's embedded schema equal THIS checkout's schema?
// The client stores the schema as `prisma format` prints it (fields before
// block attributes, aligned columns), so a temporary copy of
// prisma/schema.prisma is formatted with the same Prisma CLI and compared
// line by line. No database, nothing in the repository is modified.
import { join } from "node:path";
import { compareSchemas } from "./prismaClientCheck.mjs";

/** fs/os/child_process functions are injected so the logic stays testable. */
export function clientMatchesSchemaFile(root, inlineSchema, io, schemaPath = join(root, "prisma/schema.prisma")) {
  const dir = io.mkdtempSync(join(io.tmpdir(), "mjufind-schema-"));
  try {
    const copy = join(dir, "schema.prisma");
    io.copyFileSync(schemaPath, copy);
    const r = io.spawnSync(`npx --no-install prisma format --schema "${copy}"`, { cwd: root, shell: true, encoding: "utf8", windowsHide: true });
    if (r.status !== 0) return { ok: false, error: "prisma format failed" };
    return compareSchemas(inlineSchema, io.readFileSync(copy, "utf8"));
  } finally {
    io.rmSync(dir, { recursive: true, force: true });
  }
}
