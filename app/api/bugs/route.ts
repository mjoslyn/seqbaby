import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/bugs  { title, what, steps?, where?, contact?, website? }
//   -> { url } the issue it opened
//
// The superbugs page's form. It opens an issue on the repo with a server-side
// token (GITHUB_ISSUES_TOKEN, a fine-grained token with Issues: write on this
// one repo), so nobody needs a GitHub account to report one. Without the
// token it answers 503 and the page falls back to a prefilled github.com
// new-issue link. `website` is a honeypot: a person never fills it.
//
// `turnstile` is a Cloudflare Turnstile token. With TURNSTILE_SECRET_KEY set it
// is required and checked against siteverify before anything reaches GitHub;
// unset (local dev), the check is skipped. The page renders the widget when
// NEXT_PUBLIC_TURNSTILE_SITE_KEY is set at build time.
const REPO = process.env.GITHUB_ISSUES_REPO || "mjoslyn/seqbaby";

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// A crude per-instance limit. Serverless instances do not share it, so it is a
// speed bump for a script hammering one, not a guarantee.
const hits = new Map<string, number[]>();
function limited(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 10 * 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 5;
}

async function humanEnough(token: string, ip: string) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true;
  if (!token) return false;
  const form = new URLSearchParams({ secret, response: token });
  if (ip !== "unknown") form.set("remoteip", ip);
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
    });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  if (clip(body.website, 200)) return NextResponse.json({ url: "https://github.com" }); // honeypot: pretend
  const title = clip(body.title, 120);
  const what = clip(body.what, 4000);
  if (!title || !what) {
    return NextResponse.json({ error: "a title and what happened, please" }, { status: 400 });
  }
  const token = process.env.GITHUB_ISSUES_TOKEN;
  if (!token) return NextResponse.json({ error: "reporting is not set up here" }, { status: 503 });

  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  if (limited(ip)) return NextResponse.json({ error: "slow down, that is a lot of bugs" }, { status: 429 });
  if (!(await humanEnough(clip(body.turnstile, 2048), ip))) {
    return NextResponse.json({ error: "the robot check did not pass, try it again" }, { status: 403 });
  }

  const steps = clip(body.steps, 4000);
  const where = clip(body.where, 300);
  const contact = clip(body.contact, 200);
  const ua = clip(req.headers.get("user-agent"), 300);
  const text = [
    "### What happened",
    what,
    steps && `### How to make it happen\n${steps}`,
    where && `### Where\n${where}`,
    contact && `### Contact\n${contact}`,
    `<sub>Reported from the superbugs page. ${ua}</sub>`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const res = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ title: `[superbug] ${title}`, body: text }),
  });
  if (!res.ok) return NextResponse.json({ error: "GitHub said no" }, { status: 502 });
  const issue = (await res.json()) as { html_url?: string };
  return NextResponse.json({ url: issue.html_url ?? `https://github.com/${REPO}/issues` });
}
