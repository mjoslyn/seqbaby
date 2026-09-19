#!/usr/bin/env node
// Minting invite codes.
//
//   npm run invite                       one code, 20 turns, no expiry
//   npm run invite -- --turns 5 --days 7 --label "for dan"
//   npm run invite -- --count 10 --turns 3 --label "meetup"
//   npm run invite -- list
//   npm run invite -- revoke 4kdm-7tqw-9bnp
//
// WHY A SCRIPT AND NOT A PAGE. A code is permission to spend the deploy's
// Anthropic key, so who may mint one is the whole security question here, and
// the answer this picks is: whoever holds the Supabase SECRET key, which is
// the site's owner and nobody else. There is no admin flag to get wrong, no
// page to leave unguarded, and no account -- not even a signed-in one -- that
// can mint from the browser: `compose_invites` has RLS on and no policies at
// all, so the anon key reaches nothing in it (migration 0012). The secret key
// bypasses RLS, which is exactly why it lives on the owner's machine and not
// on the deploy.
//
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (or
// SUPABASE_SERVICE_ROLE_KEY), read from .env if there is one.

import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { formatInviteCode, makeInviteCode, normalizeInviteCode } from "../lib/composeInvite.js";

// Node's own .env reader (20.12+). Absent file, older Node: the environment
// is expected to carry the two variables instead, which is what CI does.
try {
  process.loadEnvFile?.(".env");
} catch {
  /* no .env here; the environment may still have what we need */
}

const DEFAULT_TURNS = 20;

function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (the sb_secret_… one, from\n" +
        "Supabase → Project Settings → API). Put them in .env or the environment.",
    );
    process.exit(1);
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** `--turns 5 --label "for dan"` and friends. Deliberately tiny: a flag
 *  parser is not what this script is for. */
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) out[a.slice(2)] = argv[i + 1]?.startsWith("--") ? true : argv[++i];
    else out._.push(a);
  }
  return out;
}

const when = (t) => (t ? new Date(t).toISOString().slice(0, 10) : "—");

async function mint(args) {
  const count = Math.max(1, Number(args.count ?? 1) | 0);
  // `--turns none` is the way to say uncapped, spelled out rather than
  // reached by leaving the flag off: an uncapped code is the one kind that
  // can cost real money if it gets out, so minting one should be something
  // you typed.
  const turns = args.turns === "none" ? null : Number(args.turns ?? DEFAULT_TURNS);
  if (turns !== null && (!Number.isFinite(turns) || turns < 1)) {
    console.error("--turns wants a whole number of turns, or `none` for no limit");
    process.exit(1);
  }
  const days = args.days === undefined ? null : Number(args.days);
  if (days !== null && (!Number.isFinite(days) || days < 1)) {
    console.error("--days wants a whole number of days");
    process.exit(1);
  }
  const expires = days === null ? null : new Date(Date.now() + days * 86400e3).toISOString();

  const rows = Array.from({ length: count }, () => ({
    code: makeInviteCode(randomBytes),
    label: typeof args.label === "string" ? args.label : null,
    max_turns: turns,
    expires_at: expires,
  }));

  const { data, error } = await db().from("compose_invites").insert(rows).select("code, max_turns, expires_at");
  if (error) {
    console.error(`couldn't mint: ${error.message}`);
    process.exit(1);
  }
  for (const r of data) {
    console.log(
      `${formatInviteCode(r.code)}   ${r.max_turns === null ? "unlimited" : `${r.max_turns} turns`}` +
        `${r.expires_at ? `, until ${when(r.expires_at)}` : ""}`,
    );
  }
  console.log(`\nHand that to whoever it is for. They paste it into the compose panel's\n"invite code" box — no account needed.`);
}

async function list() {
  const { data, error } = await db()
    .from("compose_invites")
    .select("code, label, max_turns, turns_used, expires_at, revoked_at, last_used_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    console.error(`couldn't list: ${error.message}`);
    process.exit(1);
  }
  if (!data.length) return console.log("no invite codes yet — `npm run invite` makes one");
  for (const r of data) {
    const spent = r.max_turns === null ? `${r.turns_used} used` : `${r.turns_used}/${r.max_turns}`;
    const state = r.revoked_at
      ? "revoked"
      : r.expires_at && new Date(r.expires_at) <= new Date()
        ? "expired"
        : r.max_turns !== null && r.turns_used >= r.max_turns
          ? "used up"
          : "live";
    console.log(
      `${formatInviteCode(r.code)}  ${state.padEnd(8)} ${spent.padEnd(9)} last ${when(r.last_used_at).padEnd(10)} ${r.label ?? ""}`,
    );
  }
}

async function revoke(raw) {
  const code = normalizeInviteCode(raw ?? "");
  if (!code) {
    console.error("revoke which code?");
    process.exit(1);
  }
  const { data, error } = await db()
    .from("compose_invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("code", code)
    .select("code");
  if (error) {
    console.error(`couldn't revoke: ${error.message}`);
    process.exit(1);
  }
  // Revoked rather than deleted, so the row goes on saying what the code was
  // worth and how much of it was spent before somebody pulled it.
  console.log(data.length ? `${formatInviteCode(code)} is off` : `no such code: ${formatInviteCode(code)}`);
}

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0] ?? "new";
if (cmd === "list") await list();
else if (cmd === "revoke") await revoke(args._[1]);
else if (cmd === "new") await mint(args);
else {
  console.error(`unknown command: ${cmd}  (new | list | revoke <code>)`);
  process.exit(1);
}
