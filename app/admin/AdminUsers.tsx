"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Avatar from "@/app/Avatar";
import { adminDeleteUser, adminSetPlan, adminSetSuspended, adminSignOut } from "./actions";
import styles from "@/app/ui.module.css";
import a from "./admin.module.css";

type User = {
  id: string;
  email: string;
  username: string | null;
  avatar_grid: string | null;
  verified: boolean;
  created_at: string;
  plan: string;
  plan_until: string | null;
  effective_plan: string;
  suspended: boolean;
  songs: number;
  turns_30d: number;
  cost_30d: number;
  last_seen: string | null;
};

const day = (iso: string | null) => (iso ? String(iso).slice(0, 10) : "");

// The account table. Each row's changes go straight to a server action, which
// checks the caller is an admin again; the page is re-read after each one.
export default function AdminUsers({ users, plans, me }: { users: User[]; plans: { id: string; label: string }[]; me: string }) {
  if (!users.length) return null;
  return (
    <div className={a.tableWrap}>
      <table className={a.table}>
        <thead>
          <tr>
            <th>account</th>
            <th>joined</th>
            <th>last seen</th>
            <th>songs</th>
            <th>turns 30d</th>
            <th>cost 30d</th>
            <th>plan</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <Row key={u.id} u={u} plans={plans} self={u.id === me} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({ u, plans, self }: { u: User; plans: { id: string; label: string }[]; self: boolean }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState("");
  const [plan, setPlan] = useState(u.plan);
  const [until, setUntil] = useState(day(u.plan_until));
  const dirty = plan !== u.plan || until !== day(u.plan_until);
  const lapsed = u.plan !== u.effective_plan;

  const act = (f: () => Promise<{ ok?: boolean; error?: string; sessions?: number }>, done = "done") =>
    start(async () => {
      const r = await f();
      setMsg(r.error ?? done);
      if (!r.error) router.refresh();
    });

  return (
    <tr className={u.suspended ? a.suspended : ""}>
      <td>
        <div className={a.who}>
          {u.username && <Avatar grid={u.avatar_grid} name={u.username} size={22} />}
          <div>
            <div>
              {u.username ? <a href={`/u/${u.username}`}>{u.username}</a> : <span className={a.dim}>no profile</span>}
              {self && <span className={a.tag}>you</span>}
              {u.suspended && <span className={`${a.tag} ${a.tagWarn}`}>suspended</span>}
            </div>
            <div className={a.dim}>
              {u.email}
              {!u.verified && " · unconfirmed"}
            </div>
          </div>
        </div>
      </td>
      <td className={a.dim}>{day(u.created_at)}</td>
      <td className={a.dim}>{day(u.last_seen) || "never"}</td>
      <td>{u.songs}</td>
      <td>{u.turns_30d}</td>
      <td className={u.cost_30d ? undefined : a.dim}>${u.cost_30d.toFixed(2)}</td>
      <td>
        <div className={a.planCell}>
          <select className={styles.input} value={plan} onChange={(e) => setPlan(e.target.value)} disabled={busy} aria-label="plan">
            {plans.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          {plan !== "free" && (
            <input
              className={styles.input}
              type="date"
              value={until}
              onChange={(e) => setUntil(e.target.value)}
              disabled={busy}
              title="until (empty: no end)"
              aria-label="plan until"
            />
          )}
          {dirty && (
            <button className={`${styles.smallBtn} ${styles.smallBtnPrimary}`} disabled={busy} onClick={() => act(() => adminSetPlan(u.id, plan, plan === "free" ? null : until || null), "plan saved")}>
              save
            </button>
          )}
        </div>
        {lapsed && <div className={a.dim}>lapsed: {u.plan} ended {day(u.plan_until)}</div>}
      </td>
      <td>
        <div className={a.actions}>
          <button
            className={styles.smallBtn}
            disabled={busy || self}
            onClick={() => act(() => adminSetSuspended(u.id, !u.suspended), u.suspended ? "unsuspended" : "suspended")}
          >
            {u.suspended ? "unsuspend" : "suspend"}
          </button>
          <button className={styles.smallBtn} disabled={busy} onClick={() => act(() => adminSignOut(u.id), "signed out")}>
            sign out
          </button>
          <button
            className={`${styles.smallBtn} ${a.danger}`}
            disabled={busy || self}
            onClick={() => {
              const typed = window.prompt(`Delete ${u.email} and everything in it? This can't be undone. Type the email to confirm.`);
              if (typed) act(() => adminDeleteUser(u.id, typed), "deleted");
            }}
          >
            delete
          </button>
        </div>
        {msg && <div className={a.dim}>{msg}</div>}
      </td>
    </tr>
  );
}
