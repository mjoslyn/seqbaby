import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // Run on everything EXCEPT Next internals and the static engine assets
  // (js/css/svg/png/wasm/... served from public/), so the engine loads untouched.
  // `webmanifest` is in there for the same reason: the homescreen manifest is a
  // static file and has no session to refresh.
  // `api/og` too: the link-preview images are fetched by crawlers with no
  // session, and reading one must not wait on a Supabase round trip.
  matcher: [
    "/((?!_next/static|_next/image|api/og|favicon\\.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|mjs|wasm|map|woff2?|mp3|wav|json|webmanifest)$).*)",
  ],
};
