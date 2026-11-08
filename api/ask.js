// POST /api/ask  { question: string, history?: [{role, content}] }
//   -> { answer: markdown, retrieved: ["SCH001", ...], provider }
// The API key never leaves the server. Retrieval runs here, so the browser cannot send its own prompt.
import { SCHOOLS } from "./_schools.js";
import { parseNeeds as parseNeedsOnly, retrieve, recordText, radiusNote, otherEmirate, needsClarifying, searchOnlyAnswer } from "./_retrieval.js";
import { RULES } from "./_prompt.js";
import { complete, ProviderError } from "./_llm.js";

const LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN || 8);
const seen = new Map(); // ip -> timestamps (best effort: per server instance)

function rateLimited(ip) {
  const now = Date.now(), recent = (seen.get(ip) || []).filter(t => now - t < 60_000);
  recent.push(now); seen.set(ip, recent);
  if (seen.size > 5000) seen.clear();
  return recent.length > LIMIT_PER_MIN;
}

const clip = (s, n) => String(s ?? "").slice(0, n);

// Same first question within 30 minutes (e.g. the "Try asking" buttons): reuse the answer, no AI call
const cache = new Map(), CACHE_MS = 30 * 60_000;
const cacheKey = q => q.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "?").split(",")[0].trim();
  if (rateLimited(ip)) return res.status(429).json({ error: "Too many questions in a minute. Wait a moment, then ask again." });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const question = clip(body?.question, 500).trim();
  if (!question) return res.status(400).json({ error: "Type a question first." });

  // Earlier turns: keep the last 4, plain text only, user questions without their records.
  const history = (Array.isArray(body?.history) ? body.history : [])
    .filter(t => t && (t.role === "user" || t.role === "assistant") && typeof t.content === "string")
    .slice(-4).map(t => ({ role: t.role, content: clip(t.content, 2500) }));
  while (history.length && history[0].role !== "user") history.shift();

  const previousQuestions = history.filter(t => t.role === "user").map(t => t.content);
  const { hits, needs } = retrieve(SCHOOLS, question, previousQuestions);
  const placeLabel = needs.place?.label || "";
  const records = hits.map(h => recordText(h.s, h.km, placeLabel, needs.grade ?? null)).join("\n\n");
  const turns = [...history, { role: "user", content: `QUESTION: ${question}\n\n${radiusNote(needs)}RETRIEVED SCHOOL RECORDS (${hits.length} of ${SCHOOLS.length}):\n${records}` }];

  const meta = { retrieved: hits.map(h => h.s.id), place: needs.place?.label || null, grade: needs.grade ?? null, maxKm: needs.place ? needs.maxKm ?? null : null };
  const send = (answer, provider) => res.status(200).json({ answer, ...meta, provider });

  // 1. Answers that need no AI
  const other = otherEmirate(question, parseNeedsOnly(question, SCHOOLS));
  if (other) return res.status(200).json({ answer: other, retrieved: [], place: null, grade: null, maxKm: null, provider: "rules" });
  const clarify = needsClarifying(needs, SCHOOLS);
  if (clarify) return res.status(200).json({ answer: clarify, retrieved: [], place: null, grade: null, maxKm: null, provider: "rules" });
  const key = !history.length && cacheKey(question), hit = key && cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return send(hit.answer, "cache");

  // 2. The AI, with fallbacks; 3. if every model is busy, the search engine's own table
  try {
    const { text, model } = await complete(RULES, turns);
    if (key) { cache.set(key, { answer: text, at: Date.now() }); if (cache.size > 300) cache.delete(cache.keys().next().value); }
    send(text, model);
  } catch (e) {
    console.error("ask failed:", e.message, e.cause?.message || "");
    if (hits.length) return send(searchOnlyAnswer(hits, needs), "search");
    res.status(e instanceof ProviderError ? e.status : 500).json({ error: "Something went wrong. Try again in a moment.", ...meta });
  }
}
