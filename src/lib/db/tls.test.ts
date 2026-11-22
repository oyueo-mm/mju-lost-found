import { describe, expect, it } from "vitest";
import { X509Certificate, createHash } from "node:crypto";

import { SUPABASE_ROOT_CA_2021, pgPoolSettings } from "./tls";

describe("pgPoolSettings (DB connection TLS)", () => {
  it("forces verified TLS for the Supabase pooler and drops ssl URL parameters", () => {
    const s = pgPoolSettings("postgresql://u:p@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&sslmode=disable&sslrootcert=/x");
    expect(s.ssl).toEqual({ ca: SUPABASE_ROOT_CA_2021, rejectUnauthorized: true });
    const url = new URL(s.connectionString);
    expect([...url.searchParams.keys()]).toEqual(["pgbouncer"]);
    expect(url.username).toBe("u");
    expect(url.password).toBe("p");
  });

  it("forces verified TLS for direct db.<ref>.supabase.co hosts too", () => {
    expect(pgPoolSettings("postgresql://u:p@db.abcdefghijklmnopqrst.supabase.co:5432/postgres").ssl).toMatchObject({ rejectUnauthorized: true });
  });

  it("leaves local databases without TLS and unknown hosts unchanged", () => {
    expect(pgPoolSettings("postgresql://postgres@127.0.0.1:55432/verify")).toEqual({ connectionString: "postgresql://postgres@127.0.0.1:55432/verify", ssl: false });
    expect(pgPoolSettings("postgresql://u@db.example.com/x")).toEqual({ connectionString: "postgresql://u@db.example.com/x" });
    expect(pgPoolSettings("not a url")).toEqual({ connectionString: "not a url" });
  });

  it("embeds the pinned Supabase Root 2021 CA", () => {
    const cert = new X509Certificate(SUPABASE_ROOT_CA_2021);
    expect(cert.subject).toContain("CN=Supabase Root 2021 CA");
    expect(cert.ca).toBe(true);
    expect(createHash("sha256").update(cert.raw).digest("hex")).toBe("807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa");
    expect(new Date(cert.validTo).getUTCFullYear()).toBe(2031);
  });
});
