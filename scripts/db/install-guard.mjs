// Import before any pg connection; also preloaded by the approved-operation launcher.
import pg from "pg";
import { assertDatabaseAccess } from "../../src/lib/db/accessPolicy.mjs";

const installed = Symbol.for("mju.db-connection-guard");
if (!pg.Client.prototype[installed]) {
  const original = pg.Client.prototype.connect;
  pg.Client.prototype.connect = function (...args) {
    const { host, port, user, database } = this.connectionParameters;
    const hostname = host.includes(":") ? `[${host}]` : host;
    const url = `postgresql://${encodeURIComponent(user)}@${hostname}:${port}/${encodeURIComponent(database)}`;
    try { assertDatabaseAccess(url, process.env, { usage: "operation" }); }
    catch (error) {
      const callback = args.find((arg) => typeof arg === "function");
      if (callback) { queueMicrotask(() => callback(error)); return; }
      return Promise.reject(error);
    }
    return original.apply(this, args);
  };
  Object.defineProperty(pg.Client.prototype, installed, { value: true });
}
