import "server-only";
import { headers } from "next/headers";
import { getAuth } from "./index";

export type SessionUser = { id: string; email: string; emailVerified: boolean };

/**
 * Who is asking, if anyone. Never throws: the routes and pages that call it
 * also serve visitors with no account, and a page prerendered at build time
 * has no request to ask about.
 */
export async function currentUser(): Promise<SessionUser | null> {
  try {
    const auth = await getAuth();
    const s = await auth.api.getSession({ headers: await headers() });
    if (!s?.user) return null;
    return { id: s.user.id, email: s.user.email, emailVerified: !!s.user.emailVerified };
  } catch {
    return null;
  }
}

export async function currentUserId(): Promise<string | null> {
  return (await currentUser())?.id ?? null;
}
