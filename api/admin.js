// GET /api/admin?view=summary|recent|bad|csv&days=7   header x-admin-key: <ADMIN_PASSWORD>
// Private stats for the site owner. Off unless ADMIN_PASSWORD (12+ characters) is set.
import { timingSafeEqual, createHash } from "node:crypto";
import { query, storeEnabled } from "./_store.js";
import { clientIp } from "./_guard.js";

const fails = new Map();
const same = (a, b) => { const h = s => createHash("sha256").update(String(s)).digest(); return timingSafeEqual(h(a), h(b)); };

export default async function handler(req, res) {
  res.setHeader("cache-control", "no-store");
  const pw = process.env.ADMIN_PASSWORD || "";
  if (pw.length < 12) return res.status(404).json({ error: "Not found." });
  const ip = clientIp(req), f = fails.get(ip) || { n: 0, until: 0 };
  if (f.until > Date.now()) return res.status(429).json({ error: "Too many wrong passwords. Try again in 15 minutes." });
  if (!same(req.headers["x-admin-key"] || "", pw)) {
    f.n++; if (f.n >= 5) { f.until = Date.now() + 15 * 60_000; f.n = 0; } fails.set(ip, f);
    return res.status(401).json({ error: "Wrong password." });
  }
  fails.delete(ip);
  if (!storeEnabled()) return res.status(200).json({ error: "Logging is off: add CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in Vercel." });

  const days = Math.min(365, Math.max(1, Number(req.query?.days || 7)));
  const since = `datetime('now', '-${days} day')`;
  const view = String(req.query?.view || "summary");
  try {
    if (view === "summary") {
      const [totals, byProvider, byDay, places, today] = await Promise.all([
        query(`SELECT COUNT(*) n, SUM(vote = 1) up, SUM(vote = -1) down, ROUND(AVG(ms)) avg_ms FROM asks WHERE at >= ${since}`),
        query(`SELECT provider, COUNT(*) n FROM asks WHERE at >= ${since} GROUP BY provider ORDER BY n DESC`),
        query(`SELECT substr(at, 1, 10) day, COUNT(*) n FROM asks WHERE at >= ${since} GROUP BY day ORDER BY day`),
        query(`SELECT place, COUNT(*) n FROM asks WHERE at >= ${since} AND place IS NOT NULL GROUP BY place ORDER BY n DESC LIMIT 15`),
        query(`SELECT n FROM counters WHERE day = date('now') AND k = 'all'`),
      ]);
      return res.status(200).json({ days, totals: totals[0], byProvider, byDay, places, aiCallsToday: today[0]?.n || 0 });
    }
    const where = view === "bad" ? `AND (vote = -1 OR provider LIKE 'search%')` : "";
    const rows = await query(`SELECT id, at, question, answer, provider, retrieved, place, grade, max_km, ms, turn, vote FROM asks WHERE at >= ${since} ${where} ORDER BY at DESC LIMIT ${view === "csv" ? 5000 : 100}`);
    if (view === "csv") {
      const cols = ["at", "question", "answer", "provider", "retrieved", "place", "grade", "max_km", "ms", "turn", "vote"];
      const cell = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
      res.setHeader("content-type", "text/csv; charset=utf-8");
      res.setHeader("content-disposition", `attachment; filename="questions-last-${days}-days.csv"`);
      return res.status(200).send([cols.join(","), ...rows.map(r => cols.map(c => cell(r[c])).join(","))].join("\n"));
    }
    return res.status(200).json({ rows });
  } catch (e) { res.status(502).json({ error: "Database error: " + e.message }); }
}
