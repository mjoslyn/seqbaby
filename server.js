import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { putShare, getShare } from "./lib/api.js";

const PORT = Number(process.env.PORT ?? 5173);
const PUBLIC_DIR = resolve("public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".mjs":  "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg":  "image/svg+xml",
};

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname === "/" ? "/index.html" : url.pathname;
  const full = join(PUBLIC_DIR, path);
  if (!full.startsWith(PUBLIC_DIR)) { res.writeHead(403).end("forbidden"); return; }
  try {
    const s = await stat(full);
    if (!s.isFile()) throw new Error("not file");
    const body = await readFile(full);
    res.writeHead(200, { "content-type": MIME[extname(full)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/api/share") {
      const body = await readJson(req);
      const out = await putShare(body);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(out));
      return;
    }
    if (req.method === "GET" && req.url.startsWith("/api/share")) {
      const u = new URL(req.url, `http://${req.headers.host}`);
      const out = await getShare({ id: u.searchParams.get("id") });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(out));
      return;
    }
    await serveStatic(req, res);
  } catch (err) {
    console.error(err);
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: String(err?.message ?? err) }));
  }
});

server.listen(PORT, () => {
  console.log(`seqbaby → http://localhost:${PORT}`);
});
