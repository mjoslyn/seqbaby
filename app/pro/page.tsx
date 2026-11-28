import Link from "next/link";
import { currentUser } from "@/lib/auth/session";
import { cfEnv } from "@/lib/cf";
import { PLANS, PLAN_WINDOW_MS, effectivePlan, isAdminEmail } from "@/lib/plans.js";
import { planRow } from "@/lib/data/admin.js";
import { myProRequest } from "@/lib/data/proRequests.js";
import { loginHref } from "@/lib/safeNext.js";
import ProForm from "./ProForm";
import styles from "@/app/ui.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "pro · seqbaby" };

// /pro: what each plan gets, and the form to ask for pro. There is no
// payment: an admin answers the request on /admin.
export default async function ProPage() {
  const user = await currentUser();
  const env = await cfEnv();
  const free = PLANS.find((p) => p.id === "free")!;
  let plan = null as ReturnType<typeof effectivePlan> | null;
  let until: string | null = null;
  let left: number | null = null;
  let request: { status: string; created_at: string } | null = null;
  const admin = !!user && isAdminEmail(user.email, env.ADMIN_EMAILS);
  if (user) {
    const row = await planRow(env, user.id);
    plan = effectivePlan(row);
    until = plan.id !== "free" ? row?.plan_until ?? null : null;
    request = await myProRequest(env, user.id).catch(() => null);
    if (plan.turns && !admin) {
      try {
        const limits = env.COMPOSE_LIMITS.get(env.COMPOSE_LIMITS.idFromName(`users/${user.id}`));
        left = await limits.freeLeft(plan.turns, PLAN_WINDOW_MS);
      } catch {
        left = null;
      }
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageInner}>
        <nav className={styles.pageNav}>
          <Link href="/studio">← studio</Link>
          {user && <Link href="/settings">settings</Link>}
        </nav>
        <h1 className={styles.pageTitle}>pro</h1>
        <p className={styles.pageSub}>Compose writes and edits songs from what you ask for. How much you get depends on your plan.</p>

        <ul className={styles.pageSub}>
          <li><b>no account</b>: 10 compose turns a month, on Haiku.</li>
          <li><b>free account</b>: {free.turns} turns a month, on Haiku.</li>
          <li><b>pro</b>: no monthly cap, and a choice of Sonnet or Opus.</li>
        </ul>

        {!user ? (
          <p className={styles.pageSub}>
            <Link href={loginHref("/pro")}>Sign in</Link> to request pro.
          </p>
        ) : admin ? (
          <p className={styles.pageSub}>You&apos;re an admin: every model, no cap.</p>
        ) : plan && plan.id !== "free" ? (
          <p className={styles.pageSub}>
            You&apos;re on pro{until ? ` until ${until.slice(0, 10)}` : ""}.
          </p>
        ) : request?.status === "pending" ? (
          <p className={styles.pageSub}>
            Your request from {request.created_at.slice(0, 10)} is waiting. You&apos;ll get an email when it&apos;s answered.
          </p>
        ) : (
          <>
            <p className={styles.pageSub}>
              You&apos;re on the free plan{left !== null ? `: ${left} of ${free.turns} turns left this month` : ""}.
              {request?.status === "declined" ? " Your last request wasn't approved; you can ask again." : ""}
            </p>
            <ProForm />
          </>
        )}
      </div>
    </div>
  );
}
