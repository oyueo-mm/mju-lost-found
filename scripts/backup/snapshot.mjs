// Keep the exporter alive while asynchronous pg_dump processes import it.
// Never block Node's event loop with execFileSync while a pg client is open.
export async function withBackupSnapshot(db, work) {
  const controller = new AbortController();
  const disconnected = () => controller.abort();
  db.on("error", disconnected);
  db.on("end", disconnected);
  try {
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await db.query("SET LOCAL idle_in_transaction_session_timeout = '5min'");
    const snapshot = (await db.query("SELECT pg_export_snapshot() AS snapshot")).rows[0].snapshot;
    if (!/^[0-9A-Fa-f-]+$/.test(snapshot)) throw new Error("Invalid exported snapshot");
    const result = await work(snapshot, controller.signal);
    if (controller.signal.aborted) throw new Error("Snapshot exporter disconnected");
    await db.query("COMMIT");
    return result;
  } catch (error) {
    controller.abort();
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { db.removeListener("error", disconnected); db.removeListener("end", disconnected); }
}
