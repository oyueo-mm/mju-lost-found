import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { withBackupSnapshot } from "./snapshot.mjs";
function client() { const db = new EventEmitter() as EventEmitter & { query: ReturnType<typeof vi.fn> }; db.query = vi.fn(async (sql: string) => ({ rows: sql.startsWith("SELECT") ? [{ snapshot: "00000003-0000001B-1" }] : [] })); return db; }
describe("backup snapshot exporter lifecycle", () => {
  it("keeps the read-only transaction open until all dump work resolves", async () => {
    const db = client();
    await withBackupSnapshot(db, async (id: string, signal: AbortSignal) => { expect(id).toBe("00000003-0000001B-1"); expect(signal.aborted).toBe(false); expect(db.query).not.toHaveBeenCalledWith("COMMIT"); });
    expect(db.query).toHaveBeenLastCalledWith("COMMIT"); expect(db.listenerCount("error")).toBe(0);
  });
  it("rolls back and aborts children on dump failure", async () => {
    const db = client(); let signal: AbortSignal;
    await expect(withBackupSnapshot(db, async (_: string, s: AbortSignal) => { signal=s; throw new Error("dump failed"); })).rejects.toThrow("dump failed");
    expect(signal!.aborted).toBe(true); expect(db.query).toHaveBeenLastCalledWith("ROLLBACK");
  });
  it.each(["error", "end"])("aborts on exporter %s, never commits", async event => {
    const db = client();
    await expect(withBackupSnapshot(db, async (_: string, signal: AbortSignal) => { db.emit(event, new Error("lost")); expect(signal.aborted).toBe(true); })).rejects.toThrow("disconnected");
    expect(db.query).not.toHaveBeenCalledWith("COMMIT");
  });
});
