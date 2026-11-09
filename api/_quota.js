// Free-quota view for the admin page: how much each AI model has used and has left, per minute, hour, day and month.
// Limits are the providers' published free-tier figures where they publish them (checked Nov 2026); the owner can
// change any of them on the admin page (saved in the database, no redeploy). Gemini publishes no fixed numbers:
// each account sees its own at https://aistudio.google.com/rate-limit, so those start empty until the owner fills them in.
import { query, getSetting } from "./_store.js";
import { chain } from "./_llm.js";
import { caps } from "./_guard.js";

export const DEFAULT_LIMITS = {
  "cloudflare": { neurons_day: 10000, neurons_in_per_m: 26668, neurons_out_per_m: 204805, reset: "utc",
    source: "developers.cloudflare.com/workers-ai/platform/pricing (10,000 neurons a day; Llama 3.3 70B fast rates)" },
  "groq": { rpm: 30, rpd: 1000, tpm: 8000, tpd: 200000, reset: "rolling", source: "console.groq.com/docs/rate-limits (gpt-oss-120b)" },
  "gemini": { rpm: null, rpd: null, tpm: null, reset: "pacific", source: "aistudio.google.com/rate-limit (your own account's numbers)" },
  "anthropic": { reset: "none", source: "paid, no free quota" },
};

// Limits for one model: provider defaults, then the owner's saved overrides for the provider, then for the exact model.
const limitsFor = (model, saved) => ({ ...DEFAULT_LIMITS[model.split(":")[0]], ...saved[model.split(":")[0]], ...saved[model] });

function pacificMidnight(now = new Date()) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(now).reduce((o, x) => (o[x.type] = x.value, o), {});
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  const offset = asUtc - Math.floor(now.getTime() / 60000) * 60000;      // Pacific local minus UTC
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day) - offset);
}

export async function quotaReport() {
  const now = new Date(), iso = d => d.toISOString();
  const t = {
    min: iso(new Date(now - 60_000)), hour: iso(new Date(now - 3600_000)), day24: iso(new Date(now - 86400_000)),
    utc: iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))),
    pacific: iso(pacificMidnight(now)),
    month: iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))),
  };
  const from = [t.day24, t.month, t.pacific].sort()[0];
  const tok = "COALESCE(tin,0)+COALESCE(tout,0)";
  const [rows, headers, fails, savedRaw, site, month] = await Promise.all([
    query(`SELECT model,
        SUM(at >= ?1) min_req, SUM(CASE WHEN at >= ?1 THEN ${tok} ELSE 0 END) min_tok,
        SUM(at >= ?2) hour_req,
        SUM(at >= ?3) d24_req, SUM(CASE WHEN at >= ?3 THEN ${tok} ELSE 0 END) d24_tok,
        SUM(at >= ?4) utc_req, SUM(CASE WHEN at >= ?4 THEN COALESCE(tin,0) ELSE 0 END) utc_tin, SUM(CASE WHEN at >= ?4 THEN COALESCE(tout,0) ELSE 0 END) utc_tout,
        SUM(at >= ?5) pac_req, SUM(CASE WHEN at >= ?5 THEN ${tok} ELSE 0 END) pac_tok,
        SUM(at >= ?6) month_req, SUM(CASE WHEN at >= ?6 AND ok = 1 THEN 1 ELSE 0 END) month_ok,
        SUM(CASE WHEN ok = 1 THEN ${tok} ELSE 0 END) * 1.0 / MAX(1, SUM(ok = 1 AND tin IS NOT NULL)) avg_tok,
        SUM(CASE WHEN ok = 1 THEN COALESCE(tin,0) ELSE 0 END) * 1.0 / MAX(1, SUM(ok = 1 AND tin IS NOT NULL)) avg_tin,
        SUM(CASE WHEN ok = 1 THEN COALESCE(tout,0) ELSE 0 END) * 1.0 / MAX(1, SUM(ok = 1 AND tin IS NOT NULL)) avg_tout
      FROM model_calls WHERE at >= ?7 GROUP BY model`, [t.min, t.hour, t.day24, t.utc, t.pacific, t.month, from]),
    query(`SELECT model, left_day, limit_day, left_tokens_min, at FROM model_calls WHERE left_day IS NOT NULL AND at >= ? ORDER BY at DESC LIMIT 20`, [t.day24]),
    query(`SELECT model, kind, COUNT(*) n, MAX(at) last FROM model_calls WHERE ok = 0 AND at >= ? GROUP BY model, kind`, [t.day24]),
    getSetting("limits").catch(() => null),
    query(`SELECT k, n FROM counters WHERE day = date('now') AND k = 'all'`),
    query(`SELECT COUNT(*) n, SUM(provider NOT LIKE 'search%' AND provider NOT IN ('rules', 'cache')) ai FROM asks WHERE at >= ?`, [t.month]),
  ]);
  let saved = {}; try { saved = JSON.parse(savedRaw || "{}") || {}; } catch {}

  const byModel = new Map(rows.map(r => [r.model, r]));
  const models = [...new Set([...chain().map(c => c.id), ...rows.map(r => r.model)])].filter(m => m !== "mock");
  const out = models.map(model => {
    const r = byModel.get(model) || {}, L = limitsFor(model, saved), provider = model.split(":")[0];
    const n = k => Number(r[k] || 0), left = (lim, used) => lim == null ? null : Math.max(0, lim - used);
    const avgTok = n("avg_tok") || 2800;                                   // ~2,800 tokens per answer until there is real data
    const row = { model, provider, inChain: chain().some(c => c.id === model), source: L.source,
      minute: { requests: n("min_req"), tokens: n("min_tok"), rpm: L.rpm ?? null, tpm: L.tpm ?? null },
      hour: { requests: n("hour_req") },
      month: { requests: n("month_req"), answered: n("month_ok") },
      failures24h: fails.filter(f => f.model === model).map(f => ({ kind: f.kind, n: f.n, last: f.last })),
      avgTokensPerAnswer: Math.round(avgTok) };
    if (provider === "cloudflare") {
      const used = (n("utc_tin") * L.neurons_in_per_m + n("utc_tout") * L.neurons_out_per_m) / 1e6;
      const per = ((n("avg_tin") || 2300) * L.neurons_in_per_m + (n("avg_tout") || 500) * L.neurons_out_per_m) / 1e6;
      row.day = { resets: "00:00 UTC (04:00 Dubai)", requests: n("utc_req"), unit: "neurons", used: Math.round(used), limit: L.neurons_day,
        left: left(L.neurons_day, Math.round(used)), answersLeft: Math.floor(Math.max(0, L.neurons_day - used) / per), perAnswer: Math.round(per) };
    } else if (provider === "groq") {
      const h = headers.find(x => x.model === model);
      const reqLeft = h ? h.left_day : left(L.rpd, n("d24_req")), tokLeft = left(L.tpd, n("d24_tok"));
      row.day = { resets: "rolling 24 hours", requests: n("d24_req"), limit: h?.limit_day || L.rpd, left: reqLeft, tokens: n("d24_tok"), tpd: L.tpd, tokensLeft: tokLeft,
        fromProvider: h ? { at: h.at, requestsLeft: h.left_day, tokensLeftThisMinute: h.left_tokens_min } : null,
        answersLeft: Math.min(reqLeft ?? Infinity, tokLeft == null ? Infinity : Math.floor(tokLeft / avgTok)) };
    } else if (provider === "gemini") {
      row.day = { resets: "midnight Pacific (11:00 Dubai)", requests: n("pac_req"), limit: L.rpd ?? null, left: left(L.rpd, n("pac_req")), tokens: n("pac_tok"),
        answersLeft: L.rpd == null ? null : left(L.rpd, n("pac_req")) };
    } else row.day = { resets: "-", requests: n("utc_req"), limit: null, left: null, answersLeft: null };
    if (row.day.answersLeft === Infinity) row.day.answersLeft = null;
    return row;
  });
  const known = out.filter(m => m.inChain && m.day.answersLeft != null);
  const cap = caps(), usedToday = site[0]?.n || 0;
  return {
    at: now.toISOString(), models: out,
    totals: { answersLeftToday: known.reduce((a, m) => a + m.day.answersLeft, 0), modelsWithUnknownLimit: out.filter(m => m.inChain && m.day.answersLeft == null).map(m => m.model) },
    site: { aiCallsToday: usedToday, dailyCap: cap.all, capLeft: Math.max(0, cap.all - usedToday), perVisitorCap: cap.visitor,
      monthQuestions: month[0]?.n || 0, monthAiAnswers: month[0]?.ai || 0 },
    limits: { defaults: DEFAULT_LIMITS, saved },
  };
}
