// Is the generated Prisma client safe to deploy? (stale-client incident,
// 2026-11-22: a client generated on another branch selected a column the
// Production database did not have yet, and logged-in requests failed.)
//
//   1. clientMatchesSchema: the generated client (src/generated/prisma) was
//      generated from THIS checkout's prisma/schema.prisma. The client embeds
//      the schema in Prisma's formatted form, so the checkout's schema is
//      formatted the same way (`prisma format` on a temporary copy) and the
//      two must be identical.
//   2. databaseCompatibility: every table, column and enum value the client
//      reads or writes exists in the target database (metadata only).
// Pure functions here; scripts/deployments/prisma-client-check.mjs runs them.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const STRING = String.raw`"(?:[^"\\]|\\.)*"`;

/** inlineSchema + runtimeDataModel embedded in the generated client. */
export function readGeneratedClient(root) {
  const src = readFileSync(join(root, "src/generated/prisma/internal/class.ts"), "utf8");
  const inline = new RegExp(String.raw`"inlineSchema":\s*(${STRING})`).exec(src);
  const model = new RegExp(String.raw`runtimeDataModel = JSON\.parse\((${STRING})\)`).exec(src);
  if (!inline || !model) throw new Error("generated Prisma client not recognised (src/generated/prisma/internal/class.ts)");
  return { inlineSchema: JSON.parse(inline[1]), dataModel: JSON.parse(JSON.parse(model[1])) };
}

const lf = (text) => text.replace(/\r\n/g, "\n");

/** @returns {{ ok: boolean, firstDifferentLine?: number }} */
export function compareSchemas(inlineSchema, formattedCheckoutSchema) {
  const a = lf(inlineSchema).split("\n"), b = lf(formattedCheckoutSchema).split("\n");
  if (a.length === b.length && a.every((line, i) => line === b[i])) return { ok: true };
  const i = a.findIndex((line, k) => line !== b[k]);
  return { ok: false, firstDifferentLine: (i < 0 ? Math.min(a.length, b.length) : i) + 1 };
}

/** enum name -> { dbName, values: db labels } from a (formatted) Prisma schema. */
export function parseEnums(schema) {
  const enums = {};
  for (const m of lf(schema).matchAll(/^enum\s+(\w+)\s*\{([^}]*)\}/gm)) {
    const [, name, body] = m;
    let dbName = name;
    const values = [];
    for (const raw of body.split("\n")) {
      const line = raw.replace(/\/\/.*$/, "").trim();
      if (!line) continue;
      const map = /^@@map\("([^"]+)"\)/.exec(line);
      if (map) { dbName = map[1]; continue; }
      const v = /^(\w+)(?:\s+@map\("([^"]+)"\))?/.exec(line);
      if (v) values.push(v[2] ?? v[1]);
    }
    enums[name] = { dbName, values };
  }
  return enums;
}

/** table -> { columns: Set, enumColumns } the client uses. */
export function clientTables(dataModel) {
  const tables = {};
  for (const [name, model] of Object.entries(dataModel.models)) {
    const table = model.dbName ?? name;
    tables[table] = { model: name, columns: new Set() };
    for (const f of model.fields) if (f.kind === "scalar" || f.kind === "enum") tables[table].columns.add(f.dbName ?? f.name);
  }
  return tables;
}

/**
 * @param {{ dataModel: any, enums: Record<string, {dbName: string, values: string[]}> }} client
 * @param {{ columns: {table: string, column: string, nullable: boolean, hasDefault: boolean}[], enums: {type: string, label: string}[] }} db
 */
export function databaseCompatibility(client, db) {
  const dbTables = new Map();
  for (const c of db.columns) {
    if (!dbTables.has(c.table)) dbTables.set(c.table, new Map());
    dbTables.get(c.table).set(c.column, c);
  }
  const dbEnums = new Map();
  for (const e of db.enums) {
    if (!dbEnums.has(e.type)) dbEnums.set(e.type, new Set());
    dbEnums.get(e.type).add(e.label);
  }
  const missingTables = [], missingColumns = [], missingEnumValues = [], requiredColumnsUnknownToClient = [], enumValuesUnknownToClient = [];
  for (const [table, { columns }] of Object.entries(clientTables(client.dataModel))) {
    const have = dbTables.get(table);
    if (!have) { missingTables.push(table); continue; }
    for (const col of columns) if (!have.has(col)) missingColumns.push(`${table}.${col}`);
    // Inserts through the client would fail on these (DB ahead of the client).
    for (const [col, c] of have) if (!columns.has(col) && !c.nullable && !c.hasDefault) requiredColumnsUnknownToClient.push(`${table}.${col}`);
  }
  for (const [name, { dbName, values }] of Object.entries(client.enums)) {
    const have = dbEnums.get(dbName);
    if (!have) { missingEnumValues.push(`${dbName} (type missing)`); continue; }
    for (const v of values) if (!have.has(v)) missingEnumValues.push(`${dbName}.${v}`);
    for (const v of have) if (!values.includes(v)) enumValuesUnknownToClient.push(`${dbName}.${v} (${name})`);
  }
  const errors = { missingTables, missingColumns, missingEnumValues };
  return {
    ok: Object.values(errors).every((list) => list.length === 0),
    checked: { tables: Object.keys(clientTables(client.dataModel)).length, columns: Object.values(clientTables(client.dataModel)).reduce((n, t) => n + t.columns.size, 0), enums: Object.keys(client.enums).length },
    ...errors,
    // Warnings: not a reason the NEW client fails to read, but worth a look.
    warnings: { requiredColumnsUnknownToClient, enumValuesUnknownToClient },
  };
}
