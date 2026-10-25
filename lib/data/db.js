// The few helpers every query here goes through. D1 is SQLite, so:
//
//   - booleans come back as 0 / 1, and `bool` turns them into true / false;
//   - JSON columns come back as text, and `json` parses them;
//   - a list is passed as ONE parameter, a JSON array, and unpacked in SQL
//     with json_each (`in (select value from json_each(?))`): D1 allows at most
//     100 bound parameters a query, and an `in (?, ?, ...)` built per id would
//     hit that on the explorer's few hundred owners.
//
// Plain JS taking the binding as an argument, so node --test runs the whole
// data layer over node:sqlite (test/helpers/cf.js).

/** @typedef {{ prepare(sql: string): any, batch(stmts: any[]): Promise<any[]> }} D1 */

/** @returns {Promise<any[]>} */
export async function all(db, sql, ...params) {
  const { results } = await db.prepare(sql).bind(...params).all();
  return results ?? [];
}

/** @returns {Promise<any | null>} */
export async function first(db, sql, ...params) {
  return (await db.prepare(sql).bind(...params).first()) ?? null;
}

/** Run a write; returns how many rows it changed. */
export async function run(db, sql, ...params) {
  const res = await db.prepare(sql).bind(...params).run();
  return Number(res?.meta?.changes ?? 0);
}

export const bool = (v) => v === 1 || v === true || v === "1";

/** @param {any} text @param {any} [fallback] @returns {any} */
export function json(text, fallback = null) {
  if (text == null || text === "") return fallback;
  if (typeof text !== "string") return text;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export const nowIso = () => new Date().toISOString();
export const uuid = () => crypto.randomUUID();

/** A unique-constraint failure, as D1 (and SQLite) words it. */
export const isUnique = (e) => /unique constraint|UNIQUE/i.test(String(e?.message ?? e));

/** Ids as the one JSON parameter json_each unpacks. */
export const idList = (ids) => JSON.stringify([...new Set(ids.filter((x) => typeof x === "string" && x))]);
