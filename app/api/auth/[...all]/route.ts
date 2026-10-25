import { getAuth } from "@/lib/auth";

// Better Auth's own endpoints: the links in its emails land here
// (/api/auth/verify-email, /api/auth/magic-link/verify,
// /api/auth/reset-password/<token>), as does the sign-out the client asks for.
// The forms themselves are server actions (app/auth/actions.ts).
export const dynamic = "force-dynamic";

async function handle(req: Request) {
  return (await getAuth()).handler(req);
}

export { handle as GET, handle as POST };
