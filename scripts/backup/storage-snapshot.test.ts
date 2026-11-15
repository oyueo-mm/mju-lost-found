import { describe, expect, it } from "vitest";
import { assertSnapshotObjects, assertSnapshotBytes } from "./storage-snapshot.mjs";
const object = { id: "one", version: "v1", bucket_id: "post-images", name: "posts/lost/1/a.jpg", updated_at: "2026-11-16" };
describe("Storage snapshot consistency", () => {
  it("does not include newly uploaded objects in the older snapshot", () => expect(() => assertSnapshotObjects([object], [object, { ...object, id: "new" }])).not.toThrow());
  it("refuses deletion during backup", () => expect(() => assertSnapshotObjects([object], [])).toThrow("changed"));
  it.each(["version", "updated_at", "name", "bucket_id"])("refuses changed %s", field => expect(() => assertSnapshotObjects([object], [{ ...object, [field]: "changed" }])).toThrow("changed"));
  it("refuses changed size and same-size replacement bytes", () => {
    expect(() => assertSnapshotBytes({ size: 4 }, Buffer.from("bad"))).toThrow("size");
    expect(() => assertSnapshotBytes({ size: 3, etag: "900150983cd24fb0d6963f7d28e17f72" }, Buffer.from("bad"))).toThrow("checksum");
    expect(() => assertSnapshotBytes({ size: 3, etag: '"900150983cd24fb0d6963f7d28e17f72"' }, Buffer.from("abc"))).not.toThrow();
  });
});
