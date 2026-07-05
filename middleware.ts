import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // Run on everything EXCEPT Next internals and the static engine assets
  // (js/css/svg/png/wasm/... served from public/), so the engine loads untouched.
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|mjs|wasm|map|woff2?|mp3|wav|json)$).*)",
  ],
};
