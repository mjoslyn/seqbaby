// Auth email: sign-up confirmation, magic link, password reset, email change.
// Sent through Cloudflare Email Service (the EMAIL binding in wrangler.jsonc).
// Without the binding (`next dev`, a deploy whose domain is not onboarded yet)
// the message is logged instead, link included, so a local sign-up can still
// be finished by copying the link out of the terminal.

type Mail = { to: string; subject: string; text: string; html: string };

export async function sendMail(env: CloudflareEnv, mail: Mail): Promise<void> {
  const from = env.EMAIL_FROM || "seqbaby <no-reply@playseqbaby.com>";
  if (!env.EMAIL) {
    console.log(`[mail] (no EMAIL binding; not sent)\nto: ${mail.to}\nsubject: ${mail.subject}\n\n${mail.text}`);
    return;
  }
  await env.EMAIL.send({ from, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** One short message with one link in it, as text and as HTML. */
export function linkMail(to: string, subject: string, lead: string, label: string, url: string): Mail {
  return {
    to,
    subject,
    text: `${lead}\n\n${url}\n\nIf you didn't ask for this, ignore this email.\n\nseqbaby`,
    html: `<div style="font-family:ui-monospace,Menlo,monospace;font-size:14px;line-height:1.5;color:#222">
<p>${esc(lead)}</p>
<p><a href="${esc(url)}" style="display:inline-block;padding:8px 14px;background:#222;color:#fff;text-decoration:none;border-radius:4px">${esc(label)}</a></p>
<p style="color:#777;font-size:12px">If you didn't ask for this, ignore this email.</p>
<p style="color:#777;font-size:12px">seqbaby</p>
</div>`,
  };
}
