// Cloudflare D1 (free SQLite database) over its REST API: the question log, feedback and daily usage counters.
// Needs CLOUDFLARE_API_TOKEN (with "D1 Edit") and CLOUDFLARE_ACCOUNT_ID. Without them every function is a no-op,
// so the site works the same, just without logging and shared daily caps.
import { createHash, randomUUID } from "node:crypto";

const env = process.env;
const DB_NAME = env.D1_DATABASE_NAME || "uaeschoolfees-logs";
const API = () => `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/d1/database`;
export const storeEnabled = () => !!(env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ACCOUNT_ID);

async function cf(url, init = {}, ms = 2500) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal, headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, "content-type": "application/json" } });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.success === false) throw new Error(`D1 ${r.status}: ${data.errors?.[0]?.message || "error"}`);
    return data;
  } finally { clearTimeout(t); }
}

// Find the database by name, create it the first time, and create the tables. Cached per server instance.
let ready = null;
function db() {
  ready ||= (async () => {
    let id = env.D1_DATABASE_ID;
    if (!id) {
      const found = await cf(`${API()}?name=${encodeURIComponent(DB_NAME)}`);
      id = found.result?.find(d => d.name === DB_NAME)?.uuid;
      if (!id) id = (await cf(API(), { method: "POST", body: JSON.stringify({ name: DB_NAME }) }, 8000)).result.uuid;
    }
    const q = (sql, params = []) => cf(`${API()}/${id}/query`, { method: "POST", body: JSON.stringify({ sql, params }) }).then(d => d.result?.[0]?.results || []);
    await q(`CREATE TABLE IF NOT EXISTS asks (id TEXT PRIMARY KEY, at TEXT NOT NULL, question TEXT, answer TEXT, provider TEXT,
      retrieved TEXT, place TEXT, grade INTEGER, max_km REAL, ms INTEGER, turn INTEGER, vote INTEGER)`);
    await q(`CREATE INDEX IF NOT EXISTS asks_at ON asks(at)`);
    await q(`CREATE TABLE IF NOT EXISTS counters (day TEXT NOT NULL, k TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, k))`);
    return q;
  })().catch(e => { ready = null; throw e; });
  return ready;
}

export async function query(sql, params = []) { return (await db())(sql, params); }

const today = () => new Date().toISOString().slice(0, 10);
// One-way code for a visitor that changes every day: enough to apply a daily limit, useless for identifying anyone.
export const visitorCode = ip => createHash("sha256").update(`${ip}|${today()}|${env.LOG_SALT || env.CLOUDFLARE_ACCOUNT_ID || "salt"}`).digest("hex").slice(0, 24);

// Adds one to today's counters and returns { all, visitor }. Returns null when the store is off or slow.
export async function countAiCall(ip) {
  if (!storeEnabled() || (env.VERCEL_ENV && env.VERCEL_ENV !== "production")) return null;   // tests don't use up the site's daily cap
  try {
    const inc = k => query(`INSERT INTO counters (day, k, n) VALUES (?, ?, 1) ON CONFLICT(day, k) DO UPDATE SET n = n + 1 RETURNING n`, [today(), k]).then(r => r[0]?.n ?? 0);
    const [all, visitor] = await Promise.all([inc("all"), inc("v:" + visitorCode(ip))]);
    if (Math.random() < 0.02) query(`DELETE FROM counters WHERE day < date('now', '-2 day')`).catch(() => {});
    return { all, visitor };
  } catch (e) { console.warn("counter skipped:", e.message); return null; }
}

export async function logAsk(row) {
  if (!storeEnabled()) return null;
  const id = randomUUID();
  try {
    await query(`INSERT INTO asks (id, at, question, answer, provider, retrieved, place, grade, max_km, ms, turn) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, new Date().toISOString(), row.question, row.answer, row.provider, (row.retrieved || []).join(","), row.place, row.grade, row.maxKm, row.ms, row.turn]);
    if (Math.random() < 0.01) query(`DELETE FROM asks WHERE at < datetime('now', '-365 day')`).catch(() => {});
    return id;
  } catch (e) { console.warn("log skipped:", e.message); return null; }
}

export async function setVote(id, vote) {
  if (!storeEnabled()) return false;
  await query(`UPDATE asks SET vote = ? WHERE id = ?`, [vote, id]);
  return true;
}
