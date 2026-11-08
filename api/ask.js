// POST /api/ask  { question, history?, ts? }  ->  { answer (markdown), retrieved, place, grade, maxKm, provider, logId }
// The AI keys never leave the server, and retrieval runs here, so the browser cannot send its own prompt.
// Order: guards -> rule answers (no AI) -> cache -> daily caps -> AI with fallbacks -> search table if all are busy.
import { SCHOOLS } from "./_schools.js";
import { parseNeeds, retrieve, recordText, radiusNote, otherEmirate, needsClarifying, searchOnlyAnswer } from "./_retrieval.js";
import { RULES } from "./_prompt.js";
import { complete } from "./_llm.js";
import { clientIp, originAllowed, turnstileOk, tooFast, caps } from "./_guard.js";
import { countAiCall, logAsk } from "./_store.js";

const clip = (s, n) => String(s ?? "").slice(0, n);
// Same first question within 30 minutes (e.g. the "Try asking" buttons): reuse the answer, no AI call
const cache = new Map(), CACHE_MS = 30 * 60_000;
const cacheKey = q => q.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export default async function handler(req, res) {
  const started = Date.now();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  if (!originAllowed(req)) return res.status(403).json({ error: "This service only answers questions from dubaischoolfees.com." });
  const ip = clientIp(req);
  if (tooFast(ip)) return res.status(429).json({ error: "Too many questions in a minute. Wait a moment, then ask again." });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  // Bot check: a failed check never blocks a person; it only means no AI answer (the search table instead)
  const verified = await turnstileOk(body?.ts, ip);
  const question = clip(body?.question, 500).trim();
  if (!question) return res.status(400).json({ error: "Type a question first." });

  // Earlier turns: keep the last 4, plain text only.
  const history = (Array.isArray(body?.history) ? body.history : [])
    .filter(t => t && (t.role === "user" || t.role === "assistant") && typeof t.content === "string")
    .slice(-4).map(t => ({ role: t.role, content: clip(t.content, 2500) }));
  while (history.length && history[0].role !== "user") history.shift();

  const { hits, needs } = retrieve(SCHOOLS, question, history.filter(t => t.role === "user").map(t => t.content));
  const meta = { retrieved: hits.map(h => h.s.id), place: needs.place?.label || null, grade: needs.grade ?? null, maxKm: needs.place ? needs.maxKm ?? null : null };
  const finish = async (answer, provider, m = meta) => {
    const tag = process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production" ? `[${process.env.VERCEL_ENV}] ` : "";
    const logId = await logAsk({ question: tag + question, answer, provider, ...m, ms: Date.now() - started, turn: history.filter(t => t.role === "user").length + 1 });
    res.status(200).json({ answer, ...m, provider, logId });
  };
  const none = { retrieved: [], place: null, grade: null, maxKm: null };

  // 1. Answers that need no AI
  const other = otherEmirate(question, parseNeeds(question, SCHOOLS));
  if (other) return finish(other, "rules", none);
  const clarify = needsClarifying(needs, SCHOOLS);
  if (clarify) return finish(clarify, "rules", none);
  const key = !history.length && !req.headers["x-test-ai-order"] && cacheKey(question), hit = key && cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return finish(hit.answer, "cache");

  if (!verified) return finish(searchOnlyAnswer(hits, needs, "check"), "search:unverified");

  // 2. Daily caps (per visitor and site-wide): over a cap, the search table instead of the AI
  const used = await countAiCall(ip), cap = caps();
  if (used && (used.visitor > cap.visitor || used.all > cap.all)) return finish(searchOnlyAnswer(hits, needs), used.all > cap.all ? "search:site-cap" : "search:visitor-cap");

  // 3. The AI, with fallbacks; 4. if every model is busy, the search engine's own table
  const records = hits.map(h => recordText(h.s, h.km, needs.place?.label || "", needs.grade ?? null)).join("\n\n");
  const turns = [...history, { role: "user", content: `QUESTION: ${question}\n\n${radiusNote(needs)}RETRIEVED SCHOOL RECORDS (${hits.length} of ${SCHOOLS.length}):\n${records}` }];
  try {
    // Preview deployments only (behind Vercel login): a tester can pick the AI order for one request
    const testOrder = process.env.VERCEL_ENV === "preview" ? clip(req.headers["x-test-ai-order"], 200) || undefined : undefined;
    const { text, model } = await complete(RULES, turns, testOrder);
    if (key) { cache.set(key, { answer: text, at: Date.now() }); if (cache.size > 300) cache.delete(cache.keys().next().value); }
    return finish(text, model);
  } catch (e) {
    console.error("ask failed:", e.message, e.cause?.message || "");
    if (hits.length) return finish(searchOnlyAnswer(hits, needs), "search:busy");
    res.status(503).json({ error: "Something went wrong. Try again in a moment.", ...meta });
  }
}
