// Logging, daily caps, feedback and admin with a fake Cloudflare D1 (an in-memory table).
process.env.GEMINI_API_KEY = "g"; process.env.CLOUDFLARE_API_TOKEN = "t"; process.env.CLOUDFLARE_ACCOUNT_ID = "acc";
process.env.ADMIN_PASSWORD = "correct-horse-battery"; process.env.VISITOR_DAILY_AI = "2"; delete process.env.AI_PROVIDER;
// The fake D1 runs the real SQL on an in-memory SQLite database, so the queries themselves are tested.
import { DatabaseSync } from "node:sqlite";
const sqlite = new DatabaseSync(":memory:"); let created = 0;
const all = sql => sqlite.prepare(sql).all();
const rowsProxy = () => all("SELECT * FROM asks ORDER BY rowid");
globalThis.fetch = async (url, opts = {}) => {
  const ok = body => ({ ok: true, status: 200, headers: new Headers(), json: async () => body });
  if (url.includes("generativelanguage")) return ok({ candidates: [{ content: { parts: [{ text: "AI ANSWER" }] } }], usageMetadata: { promptTokenCount: 2000, candidatesTokenCount: 400 } });
  if (url.includes("/d1/database?name=")) return ok({ success: true, result: [] });
  if (url.endsWith("/d1/database") && opts.method === "POST") { created++; return ok({ success: true, result: { uuid: "db1" } }); }
  if (url.includes("/d1/database/db1/query")) {
    const { sql, params } = JSON.parse(opts.body);
    const st = sqlite.prepare(sql);
    const results = st.columns().length ? st.all(...params) : (st.run(...params), []);
    return ok({ success: true, result: [{ results }] });
  }
  throw new Error("unexpected fetch " + url);
};
const call = (mod, req) => new Promise(async done => { const { default: h } = await import(mod);
  const res = { code: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { done({ code: this.code, ...b }); }, send(b) { done({ code: this.code, body: b }); } };
  h({ headers: { origin: "https://www.uaeschoolfees.com", "x-forwarded-for": "1.2.3.4", ...req.headers }, method: req.method || "POST", body: req.body, query: req.query || {} }, res); });
let fail = 0; const check = (n, ok, x = "") => { if (!ok) fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${n} ${x}`); };

let r = await call("../api/ask.js", { body: { question: "British school near Al Barsha for Year 3" } });
check("answer logged with an id", r.logId && rowsProxy().length === 1 && rowsProxy()[0].provider.startsWith("gemini") && created === 1);
r = await call("../api/ask.js", { body: { question: "IB school near Emirates Hills" } });
r = await call("../api/ask.js", { body: { question: "French school near Oud Metha" } });
check("visitor over daily AI cap -> search table", r.provider === "search:visitor-cap" && /\| School \|/.test(r.answer), r.provider);
r = await call("../api/ask.js", { body: { question: "CBSE school in Sharjah" } });
check("rule answers are logged too, and don't count against the cap", rowsProxy().at(-1).provider === "rules");
const fb = await call("../api/feedback.js", { body: { id: rowsProxy()[0].id, vote: 1 } });
check("thumbs up saved", fb.ok && rowsProxy()[0].vote === 1);
r = await call("../api/admin.js", { method: "GET", headers: { "x-admin-key": "wrong" }, query: { view: "summary" } });
check("admin: wrong password refused", r.code === 401);
r = await call("../api/admin.js", { method: "GET", headers: { "x-admin-key": "correct-horse-battery" }, query: { view: "summary" } });
check("admin: summary with right password", r.code === 200 && r.totals.n === rowsProxy().length && r.totals.up === 1, JSON.stringify(r.totals));
r = await call("../api/admin.js", { method: "GET", headers: { "x-admin-key": "correct-horse-battery" }, query: { view: "csv" } });
check("admin: CSV export", r.code === 200 && r.body.startsWith("at,question"));
for (let i = 0; i < 5; i++) await call("../api/admin.js", { method: "GET", headers: { "x-admin-key": "nope", "x-forwarded-for": "6.6.6.6" }, query: {} });
r = await call("../api/admin.js", { method: "GET", headers: { "x-admin-key": "correct-horse-battery", "x-forwarded-for": "6.6.6.6" }, query: {} });
check("admin: locked for 15 min after 5 wrong passwords", r.code === 429);
process.env.TURNSTILE_SITE_KEY = "site"; process.env.TURNSTILE_SECRET = "sec";
const prevFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => url.includes("siteverify") ? { ok: true, status: 200, json: async () => ({ success: false, "error-codes": ["invalid-input-response"] }) } : prevFetch(url, opts);
r = await call("../api/ask.js", { headers: { "x-forwarded-for": "5.5.5.5" }, body: { question: "American school near Al Barsha for Grade 2", ts: "bad" } });
check("failed bot check -> still 200, search table, no AI", r.code === 200 && r.provider === "search:unverified" && /\| School \|/.test(r.answer), r.provider);
r = await call("../api/ask.js", { headers: { "x-forwarded-for": "5.5.5.6" }, body: { question: "CBSE school in Sharjah" } });
check("failed bot check still gets rule answers", r.provider === "rules");
r = await call("../api/admin.js", { method: "GET", headers: { "x-admin-key": "correct-horse-battery" }, query: { view: "quota" } });
const gm = r.models?.find(m => m.model === "gemini:gemini-3.5-flash-lite");
check("admin quota: model calls counted per minute/day/month", r.code === 200 && gm?.minute.requests >= 2 && gm.day.requests === gm.month.requests && gm.avgTokensPerAnswer === 2400, JSON.stringify(gm));
check("admin quota: Gemini has no limit until set", gm?.day.answersLeft === null && r.totals.modelsWithUnknownLimit.includes("gemini:gemini-3.5-flash-lite"));
r = await call("../api/admin.js", { method: "POST", headers: { "x-admin-key": "correct-horse-battery" }, query: { view: "limits" }, body: { limits: { "gemini:gemini-3.5-flash-lite": { rpm: 15, rpd: 1000 } } } });
check("admin: limits saved", r.ok === true);
r = await call("../api/admin.js", { method: "GET", headers: { "x-admin-key": "correct-horse-battery" }, query: { view: "quota" } });
const gm2 = r.models.find(m => m.model === "gemini:gemini-3.5-flash-lite");
check("admin quota: answers left = limit - used", gm2.day.answersLeft === 1000 - gm2.day.requests && gm2.minute.rpm === 15, JSON.stringify(gm2.day));
r = await call("../api/admin.js", { method: "POST", headers: { "x-admin-key": "correct-horse-battery" }, query: { view: "limits" }, body: { limits: { x: { evil: "1" } } } });
check("admin: bad limits refused", r.code === 400);
console.log(fail ? `\n${fail} failing` : "\nall store checks pass"); process.exit(fail ? 1 : 0);
