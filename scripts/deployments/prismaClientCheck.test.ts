import { describe, expect, it } from "vitest";
import { clientTables, compareSchemas, databaseCompatibility, parseEnums } from "./prismaClientCheck.mjs";
import { checkRollbackTarget, FORBIDDEN_ROLLBACK_TARGETS } from "./rollbackPolicy.mjs";

const dataModel = {
  models: {
    User: { dbName: null, fields: [
      { name: "id", kind: "scalar", type: "Int", dbName: null },
      { name: "sessionsValidAfter", kind: "scalar", type: "DateTime", dbName: "sessions_valid_after" },
      { name: "role", kind: "enum", type: "Role", dbName: null },
      { name: "posts", kind: "object", type: "Post" },
    ] },
    Post: { dbName: "post", fields: [{ name: "id", kind: "scalar", type: "Int", dbName: null }] },
  },
};
const enums = { Role: { dbName: "role", values: ["user", "admin"] } };
const col = (table: string, column: string, nullable = true, hasDefault = false) => ({ table, column, nullable, hasDefault });
const fullDb = {
  columns: [col("User", "id", false, true), col("User", "sessions_valid_after"), col("User", "role", false, true), col("post", "id", false, true)],
  enums: [{ type: "role", label: "user" }, { type: "role", label: "admin" }],
};

describe("generated client vs checkout schema", () => {
  it("accepts identical formatted schemas (line endings aside) and reports the first different line", () => {
    expect(compareSchemas("a\nb\n", "a\r\nb\r\n")).toEqual({ ok: true });
    expect(compareSchemas("a\nb\nc", "a\nB\nc")).toEqual({ ok: false, firstDifferentLine: 2 });
    expect(compareSchemas("a\nb", "a\nb\nc")).toEqual({ ok: false, firstDifferentLine: 3 });
  });

  it("parses enum database names and mapped values", () => {
    expect(parseEnums('enum ReportTargetType {\n  POST    @map("post") // c\n  USER\n\n  @@map("report_target_type")\n}\n')).toEqual({ ReportTargetType: { dbName: "report_target_type", values: ["post", "USER"] } });
  });

  it("maps models and scalar/enum fields to tables and columns, skipping relations", () => {
    const t = clientTables(dataModel);
    expect(Object.keys(t)).toEqual(["User", "post"]);
    expect([...t.User.columns]).toEqual(["id", "sessions_valid_after", "role"]);
  });
});

describe("database compatibility", () => {
  it("passes when every table, column and enum value exists", () => {
    const r = databaseCompatibility({ dataModel, enums }, fullDb);
    expect(r.ok).toBe(true);
    expect(r.checked).toEqual({ tables: 2, columns: 4, enums: 1 });
  });

  it("reproduces the 2026-11-22 incident: a client column the database lacks fails", () => {
    const db = { ...fullDb, columns: fullDb.columns.filter((c) => c.column !== "sessions_valid_after") };
    const r = databaseCompatibility({ dataModel, enums }, db);
    expect(r.ok).toBe(false);
    expect(r.missingColumns).toEqual(["User.sessions_valid_after"]);
  });

  it("fails on a missing table or enum value; warns when the database is ahead", () => {
    const r = databaseCompatibility({ dataModel, enums }, {
      columns: [...fullDb.columns.filter((c) => c.table !== "post"), col("User", "added_later", false, false)],
      enums: [{ type: "role", label: "user" }, { type: "role", label: "owner" }],
    });
    expect(r.missingTables).toEqual(["post"]);
    expect(r.missingEnumValues).toEqual(["role.admin"]);
    expect(r.warnings).toEqual({ requiredColumnsUnknownToClient: ["User.added_later"], enumValuesUnknownToClient: ["role.owner (Role)"] });
    expect(r.ok).toBe(false);
  });
});

describe("rollback policy", () => {
  const good = { id: "dpl_FvfFRQppnqXaT7sdybBHknhjN9f9", target: "production", state: "READY", hasTlsCode: false };
  it("keeps the stale-client deployment forbidden", () => {
    expect(Object.keys(FORBIDDEN_ROLLBACK_TARGETS)).toContain("dpl_HbJbyTZFYnLLmBzLt7Bb1QCboNue");
    expect(checkRollbackTarget({ ...good, id: "dpl_HbJbyTZFYnLLmBzLt7Bb1QCboNue", hasTlsCode: true }).ok).toBe(false);
  });
  it("allows a ready production deployment; refuses previews and failed builds", () => {
    expect(checkRollbackTarget(good)).toEqual({ ok: true });
    expect(checkRollbackTarget({ ...good, target: "preview" }).ok).toBe(false);
    expect(checkRollbackTarget({ ...good, state: "ERROR" }).ok).toBe(false);
  });
  it("once SSL is enforced, refuses deployments without (or not confirmed to have) the TLS code", () => {
    expect(checkRollbackTarget(good, { sslEnforced: true }).ok).toBe(false);
    expect(checkRollbackTarget({ ...good, hasTlsCode: null }, { sslEnforced: true }).ok).toBe(false);
    expect(checkRollbackTarget({ ...good, hasTlsCode: true }, { sslEnforced: true })).toEqual({ ok: true });
  });
});
