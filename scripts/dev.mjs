// Local server that mimics Vercel: serves the static files and runs api/*.js handlers.
//   node scripts/dev.mjs            (reads keys from .env if present)
//   AI_PROVIDER=mock node scripts/dev.mjs   (no API key needed)
import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
if (existsSync(path.join(ROOT, ".env"))) {
  for (const line of readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const TYPES = { ".html": "text/html; charset=utf-8", ".json": "application/json", ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml" };
const PORT = Number(process.env.PORT || 3000);

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    const name = url.pathname.slice(5).replace(/[^a-z0-9-]/gi, "");
    const file = path.join(ROOT, "api", name + ".js");
    if (!name || !existsSync(file)) { res.writeHead(404); return res.end("Not found"); }
    let raw = ""; for await (const c of req) raw += c;
    try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = raw; }
    res.status = code => { res.statusCode = code; return res; };
    res.json = obj => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(obj)); };
    const { default: handler } = await import(pathToFileURL(file).href);
    return handler(req, res);
  }
  const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const file = path.join(ROOT, path.normalize(rel));
  if (!file.startsWith(ROOT) || rel.startsWith("api/") || rel.startsWith(".")) { res.writeHead(404); return res.end("Not found"); }
  try {
    const data = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch { res.writeHead(404); res.end("Not found"); }
}).listen(PORT, () => console.log(`SchoolScout on http://localhost:${PORT}`));
