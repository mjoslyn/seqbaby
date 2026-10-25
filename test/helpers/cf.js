// Stand-ins for the two Cloudflare bindings the data layer uses, good enough
// to run it under `node --test`: D1 over node:sqlite (with the real schema
// from db/migrations), and R2 over a Map.
//
// The D1 shim implements the slice of the API the app calls: prepare / bind /
// first / all / run / raw, batch, exec. Errors are thrown with SQLite's own
// messages, as D1's are ("UNIQUE constraint failed: ..."), so code matching on
// them is exercised for real.

import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

class Stmt {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }
  bind(...params) {
    return new Stmt(this.db, this.sql, params.map((p) => (p === undefined ? null : typeof p === "boolean" ? (p ? 1 : 0) : p)));
  }
  _stmt() {
    // D1 numbers ?1 ?2 ... positionally, as node:sqlite does for bare ?NNN.
    return this.db.prepare(this.sql);
  }
  async first(col) {
    const row = this._stmt().get(...this.params) ?? null;
    if (row && col) return row[col] ?? null;
    return row ? { ...row } : null;
  }
  async all() {
    const s = this._stmt();
    if (s.columns().length === 0) {
      const r = s.run(...this.params);
      return { results: [], success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    }
    const rows = s.all(...this.params).map((r) => ({ ...r }));
    return { results: rows, success: true, meta: { changes: 0 } };
  }
  async run() {
    const s = this._stmt();
    if (s.columns().length) {
      // RETURNING
      const rows = s.all(...this.params).map((r) => ({ ...r }));
      return { results: rows, success: true, meta: { changes: rows.length } };
    }
    const r = s.run(...this.params);
    return { results: [], success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
  async raw() {
    const rows = this._stmt().all(...this.params);
    return rows.map((r) => Object.values(r));
  }
}

export function makeD1() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("pragma foreign_keys = on");
  const dir = join(root, "db", "migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(join(dir, f), "utf8"));
  }
  return {
    sqlite,
    prepare: (sql) => new Stmt(sqlite, sql),
    async batch(stmts) {
      sqlite.exec("begin");
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        sqlite.exec("commit");
        return out;
      } catch (e) {
        sqlite.exec("rollback");
        throw e;
      }
    },
    async exec(sql) {
      sqlite.exec(sql);
      return { count: 1, duration: 0 };
    },
  };
}

export function makeR2() {
  const objects = new Map();
  const obj = (key, body) => ({
    key,
    size: body.length,
    async text() {
      return body;
    },
    async json() {
      return JSON.parse(body);
    },
  });
  return {
    objects,
    async put(key, value) {
      objects.set(key, typeof value === "string" ? value : String(value));
      return { key };
    },
    async get(key) {
      return objects.has(key) ? obj(key, objects.get(key)) : null;
    },
    async head(key) {
      return objects.has(key) ? { key, size: objects.get(key).length } : null;
    },
    async delete(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) objects.delete(k);
    },
    async list({ prefix = "", cursor } = {}) {
      const all = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const page = all.slice(start, start + 1000);
      const truncated = start + 1000 < all.length;
      return { objects: page.map((key) => ({ key })), truncated, cursor: truncated ? String(start + 1000) : undefined };
    },
  };
}

export const makeEnv = () => ({ DB: makeD1(), BLOBS: makeR2() });
