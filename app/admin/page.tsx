import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { cfEnv } from "@/lib/cf";
import { PLANS, isAdminEmail } from "@/lib/plans.js";
import { adminLog, adminStats, listUsers } from "@/lib/data/admin.js";
import AdminUsers from "./AdminUsers";
import ProRequests from "./ProRequests";
import { listProRequests } from "@/lib/data/proRequests.js";
import styles from "@/app/ui.module.css";
import a from "./admin.module.css";

export const dynamic = "force-dynamic";

// /admin: every account, its plan, and the levers (suspend, sign out, delete).
// Only for emails on the deploy's ADMIN_EMAILS secret; anyone else gets a 404,
// so the page does not say it exists.
export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; plan?: string; suspended?: string; offset?: string; sort?: string }>;
}) {
  const user = await currentUser();
  const env = await cfEnv();
  if (!user || !isAdminEmail(user.email, env.ADMIN_EMAILS)) notFound();

  const sp = await searchParams;
  const q = sp.q ?? "";
  const plan = sp.plan ?? "";
  const suspended = sp.suspended === "1";
  const sort = sp.sort === "cost" ? "cost" : "";
  const offset = Math.max(0, Number(sp.offset) || 0);
  const [list, stats, log, requests] = await Promise.all([
    listUsers(env, { q, plan, suspended, offset, sort }),
    adminStats(env),
    adminLog(env, 30),
    listProRequests(env, { status: "pending" }),
  ]);
  const page = (o: number) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (plan) p.set("plan", plan);
    if (suspended) p.set("suspended", "1");
    if (sort) p.set("sort", sort);
    if (o) p.set("offset", String(o));
    const s = p.toString();
    return `/admin${s ? `?${s}` : ""}`;
  };

  return (
    <div className={styles.page}>
      <div className={`${styles.pageInner} ${a.wide}`}>
        <nav className={styles.pageNav}>
          <Link href="/studio">← studio</Link>
          <Link href="/settings">settings</Link>
        </nav>
        <h1 className={styles.pageTitle}>admin</h1>
        <p className={styles.pageSub}>accounts, plans and suspensions. Every change is logged below.</p>

        <div className={a.stats}>
          <Stat n={stats.users} label="accounts" />
          <Stat n={stats.new_7d} label="new this week" />
          <Stat n={stats.paid} label="on a paid plan" />
          <Stat n={stats.suspended} label="suspended" />
          <Stat n={stats.turns_7d} label="compose turns this week" />
          <Stat n={stats.cost_30d} money label="compose cost, 30 days" />
          <Stat n={stats.cost_30d_anon} money label="of it, signed out" />
        </div>

        <h2 className={a.h2}>pro requests{requests.length ? ` (${requests.length})` : ""}</h2>
        <ProRequests requests={requests} />

        <h2 className={a.h2}>accounts</h2>
        <form className={a.filters} action="/admin">
          <input className={styles.input} name="q" defaultValue={q} placeholder="search email or name" aria-label="search" />
          <select className={styles.input} name="plan" defaultValue={plan} aria-label="plan">
            <option value="">any plan</option>
            {PLANS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          <select className={styles.input} name="sort" defaultValue={sort} aria-label="sort">
            <option value="">newest first</option>
            <option value="cost">top cost, 30 days</option>
          </select>
          <label className={a.check}>
            <input type="checkbox" name="suspended" value="1" defaultChecked={suspended} /> suspended only
          </label>
          <button className={styles.smallBtn} type="submit">filter</button>
        </form>

        <AdminUsers users={list.users} plans={PLANS.map((p) => ({ id: p.id, label: p.label }))} me={user.id} />

        <div className={a.pager}>
          {offset > 0 ? <Link href={page(Math.max(0, offset - list.pageSize))}>← newer</Link> : <span />}
          <span className={a.dim}>
            {list.users.length ? `${offset + 1}–${offset + list.users.length}` : "no accounts match"}
          </span>
          {list.more ? <Link href={page(offset + list.pageSize)}>older →</Link> : <span />}
        </div>

        <h2 className={a.h2}>log</h2>
        {log.length === 0 ? (
          <p className={a.dim}>nothing yet.</p>
        ) : (
          <ul className={a.log}>
            {log.map((l) => (
              <li key={l.id}>
                <span className={a.dim}>{String(l.at).slice(0, 16).replace("T", " ")}</span>{" "}
                {l.admin ?? "?"} · <b>{l.action}</b>
                {l.detail ? ` ${l.detail}` : ""} · {l.target ?? l.target_id}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Stat({ n, label, money = false }: { n: number; label: string; money?: boolean }) {
  return (
    <div className={a.stat}>
      <div className={a.statN}>{money ? usd(n) : n.toLocaleString()}</div>
      <div className={a.dim}>{label}</div>
    </div>
  );
}

const usd = (n: number) => `$${n < 100 ? n.toFixed(2) : Math.round(n).toLocaleString()}`;
