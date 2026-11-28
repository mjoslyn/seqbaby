"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Avatar from "@/app/Avatar";
import { adminDecidePro } from "./actions";
import styles from "@/app/ui.module.css";
import a from "./admin.module.css";

type Req = {
  id: string;
  email: string;
  username: string | null;
  avatar_grid: string | null;
  message: string | null;
  created_at: string;
  songs: number;
};

// Pending pro requests on /admin. Approve puts the account on pro (until a
// date, or for good); decline leaves it on free. Both email the account.
export default function ProRequests({ requests }: { requests: Req[] }) {
  if (!requests.length) return <p className={a.dim}>no pro requests waiting.</p>;
  return (
    <ul className={a.reqs}>
      {requests.map((r) => (
        <Row key={r.id} r={r} />
      ))}
    </ul>
  );
}

function Row({ r }: { r: Req }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [until, setUntil] = useState("");
  const [msg, setMsg] = useState("");
  const act = (approve: boolean) =>
    start(async () => {
      const res = await adminDecidePro(r.id, approve, approve ? until || null : null);
      setMsg(res.error ?? (approve ? "approved" : "declined"));
      if (!res.error) router.refresh();
    });
  return (
    <li className={a.req}>
      <div className={a.who}>
        {r.username && <Avatar grid={r.avatar_grid} name={r.username} size={22} />}
        <div>
          <div>
            {r.username ? <a href={`/u/${r.username}`}>{r.username}</a> : <span className={a.dim}>no profile</span>}
            <span className={a.dim}> · {r.email} · {r.songs} songs · asked {String(r.created_at).slice(0, 10)}</span>
          </div>
          {r.message && <div className={a.reqMsg}>{r.message}</div>}
        </div>
      </div>
      <div className={a.actions}>
        <input
          className={styles.input}
          type="date"
          value={until}
          onChange={(e) => setUntil(e.target.value)}
          disabled={busy}
          title="pro until (empty: no end)"
          aria-label="pro until"
        />
        <button className={`${styles.smallBtn} ${styles.smallBtnPrimary}`} disabled={busy} onClick={() => act(true)}>
          approve
        </button>
        <button className={styles.smallBtn} disabled={busy} onClick={() => act(false)}>
          decline
        </button>
        {msg && <span className={a.dim}>{msg}</span>}
      </div>
    </li>
  );
}
