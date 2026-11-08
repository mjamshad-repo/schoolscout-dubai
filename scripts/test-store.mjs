// Logging, daily caps, feedback and admin with a fake Cloudflare D1 (an in-memory table).
process.env.GEMINI_API_KEY = "g"; process.env.CLOUDFLARE_API_TOKEN = "t"; process.env.CLOUDFLARE_ACCOUNT_ID = "acc";
process.env.ADMIN_PASSWORD = "correct-horse-battery"; process.env.VISITOR_DAILY_AI = "2"; delete process.env.AI_PROVIDER;
const rows = [], counters = new Map(); let created = 0;
globalThis.fetch = async (url, opts = {}) => {
  const ok = body => ({ ok: true, status: 200, json: async () => body });
  if (url.includes("generativelanguage")) return ok({ candidates: [{ content: { parts: [{ text: "AI ANSWER" }] } }] });
  if (url.includes("/d1/database?name=")) return ok({ success: true, result: [] });
  if (url.endsWith("/d1/database") && opts.method === "POST") { created++; return ok({ success: true, result: { uuid: "db1" } }); }
  if (url.includes("/d1/database/db1/query")) {
    const { sql, params } = JSON.parse(opts.body); let results = [];
    if (sql.startsWith("INSERT INTO counters")) { const k = params.join("|"); counters.set(k, (counters.get(k) || 0) + 1); results = [{ n: counters.get(k) }]; }
    else if (sql.startsWith("INSERT INTO asks")) rows.push({ id: params[0], question: params[2], provider: params[4], vote: null });
    else if (sql.startsWith("UPDATE asks SET vote")) { const r = rows.find(x => x.id === params[1]); if (r) r.vote = params[0]; }
    else if (sql.startsWith("SELECT COUNT(*) n")) results = [{ n: rows.length, up: rows.filter(r => r.vote === 1).length, down: 0, avg_ms: 1 }];
    else if (sql.startsWith("SELECT id")) results = rows;
    return ok({ success: true, result: [{ results }] });
  }
  throw new Error("unexpected fetch " + url);
};
const call = (mod, req) => new Promise(async done => { const { default: h } = await import(mod);
  const res = { code: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { done({ code: this.code, ...b }); }, send(b) { done({ code: this.code, body: b }); } };
  h({ headers: { origin: "https://www.uaeschoolfees.com", "x-forwarded-for": "1.2.3.4", ...req.headers }, method: req.method || "POST", body: req.body, query: req.query || {} }, res); });
let fail = 0; const check = (n, ok, x = "") => { if (!ok) fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${n} ${x}`); };

let r = await call("../api/ask.js", { body: { question: "British school near Al Barsha for Year 3" } });
check("answer logged with an id", r.logId && rows.length === 1 && rows[0].provider.startsWith("gemini") && created === 1);
r = await call("../api/ask.js", { body: { question: "IB school near Emirates Hills" } });
r = await call("../api/ask.js", { body: { question: "French school near Oud Metha" } });
check("visitor over daily AI cap -> search table", r.provider === "search:visitor-cap" && /\| School \|/.test(r.answer), r.provider);
r = await call("../api/ask.js", { body: { question: "CBSE school in Sharjah" } });
check("rule answers are logged too, and don't count against the cap", rows.at(-1).provider === "rules");
const fb = await call("../api/feedback.js", { body: { id: rows[0].id, vote: 1 } });
check("thumbs up saved", fb.ok && rows[0].vote === 1);
r = await call("../api/admin.js", { method: "GET", headers: { "x-admin-key": "wrong" }, query: { view: "summary" } });
check("admin: wrong password refused", r.code === 401);
r = await call("../api/admin.js", { method: "GET", headers: { "x-admin-key": "correct-horse-battery" }, query: { view: "summary" } });
check("admin: summary with right password", r.code === 200 && r.totals.n === rows.length && r.totals.up === 1, JSON.stringify(r.totals));
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
console.log(fail ? `\n${fail} failing` : "\nall store checks pass"); process.exit(fail ? 1 : 0);
