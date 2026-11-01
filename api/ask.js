// POST /api/ask  { question: string, history?: [{role, content}] }
//   -> { answer: markdown, retrieved: ["SCH001", ...], provider }
// The API key never leaves the server. Retrieval runs here, so the browser cannot send its own prompt.
import { SCHOOLS } from "./_schools.js";
import { retrieve, recordText } from "./_retrieval.js";
import { RULES } from "./_prompt.js";
import { complete, providerName, ProviderError } from "./_llm.js";

const LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN || 8);
const seen = new Map(); // ip -> timestamps (best effort: per server instance)

function rateLimited(ip) {
  const now = Date.now(), recent = (seen.get(ip) || []).filter(t => now - t < 60_000);
  recent.push(now); seen.set(ip, recent);
  if (seen.size > 5000) seen.clear();
  return recent.length > LIMIT_PER_MIN;
}

const clip = (s, n) => String(s ?? "").slice(0, n);

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
  const { hits } = retrieve(SCHOOLS, question, previousQuestions);
  const records = hits.map(h => recordText(h.s)).join("\n\n");
  const turns = [...history, { role: "user", content: `QUESTION: ${question}\n\nRETRIEVED SCHOOL RECORDS (${hits.length} of ${SCHOOLS.length}):\n${records}` }];

  try {
    const answer = await complete(RULES, turns);
    res.status(200).json({ answer, retrieved: hits.map(h => h.s.id), provider: providerName() });
  } catch (e) {
    const status = e instanceof ProviderError ? e.status : 500;
    console.error("ask failed:", e.message);
    res.status(status).json({ error: e instanceof ProviderError ? e.message : "Something went wrong. Try again in a moment.", retrieved: hits.map(h => h.s.id) });
  }
}
