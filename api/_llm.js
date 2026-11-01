// One function, three providers. Pick with AI_PROVIDER, or the first API key that is set.
//   gemini    -> Google Gemini API (free tier available)        GEMINI_API_KEY,    GEMINI_MODEL
//   groq      -> Groq, OpenAI-compatible (free tier available)  GROQ_API_KEY,      GROQ_MODEL
//   anthropic -> Claude API (paid)                              ANTHROPIC_API_KEY, ANTHROPIC_MODEL
//   mock      -> no network; returns a canned answer for local testing

const env = process.env;

export function providerName() {
  if (env.AI_PROVIDER) return env.AI_PROVIDER.toLowerCase();
  if (env.GEMINI_API_KEY) return "gemini";
  if (env.GROQ_API_KEY) return "groq";
  if (env.ANTHROPIC_API_KEY) return "anthropic";
  return "none";
}

// system: string; turns: [{role:"user"|"assistant", content}] ending on a user turn
export async function complete(system, turns) {
  const p = providerName();
  if (p === "gemini") return gemini(system, turns);
  if (p === "groq") return groq(system, turns);
  if (p === "anthropic") return anthropic(system, turns);
  if (p === "mock") return mock(turns);
  throw new ProviderError("No AI provider is configured. Set GEMINI_API_KEY (free), GROQ_API_KEY or ANTHROPIC_API_KEY.", 500);
}

export class ProviderError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

const BUSY = "The AI service is busy right now (free-tier demand). Wait a minute and ask again; Explore and Compare still work.";

async function post(url, headers, body) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (r.status === 429 || r.status === 503 || r.status === 500) {
    const e = new ProviderError(BUSY, 503); e.retryable = true; throw e;
  }
  if (!r.ok) throw new ProviderError(`AI provider error ${r.status}: ${data?.error?.message || "unknown"}`, 502);
  return data;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Free-tier models are sometimes overloaded: try the main model twice, then a lighter fallback model once.
async function gemini(system, turns) {
  const main = env.GEMINI_MODEL || "gemini-2.5-flash";
  const fallback = env.GEMINI_FALLBACK_MODEL || "gemini-2.5-flash-lite";
  const attempts = [main, main, ...(fallback && fallback !== main ? [fallback] : [])];
  let last;
  for (const [i, model] of attempts.entries()) {
    try { return await geminiOnce(model, system, turns); }
    catch (e) { last = e; if (!e.retryable) throw e; if (i < attempts.length - 1) await sleep(i === 0 ? 1200 : 400); }
  }
  throw last;
}

async function geminiOnce(model, system, turns) {
  const data = await post(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    { "x-goog-api-key": env.GEMINI_API_KEY },
    {
      systemInstruction: { parts: [{ text: system }] },
      contents: turns.map(t => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: t.content }] })),
      generationConfig: {
        temperature: 0.2, maxOutputTokens: 4096,
        // Flash models think before answering by default; a shortlist doesn't need it, and it would use the output budget.
        ...(/flash/.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      },
    });
  const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("").trim();
  if (!text) throw new ProviderError("The AI returned an empty answer. Try rephrasing.", 502);
  return text;
}

async function groq(system, turns) {
  const model = env.GROQ_MODEL || "openai/gpt-oss-120b";
  const data = await post("https://api.groq.com/openai/v1/chat/completions",
    { authorization: `Bearer ${env.GROQ_API_KEY}` },
    { model, temperature: 0.2, max_tokens: 2048, messages: [{ role: "system", content: system }, ...turns] });
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new ProviderError("The AI returned an empty answer. Try rephrasing.", 502);
  return text;
}

async function anthropic(system, turns) {
  const model = env.ANTHROPIC_MODEL || "claude-haiku-5-5";
  const data = await post("https://api.anthropic.com/v1/messages",
    { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    { model, max_tokens: 2048, temperature: 0.2, system, messages: turns });
  const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
  if (!text) throw new ProviderError("The AI returned an empty answer. Try rephrasing.", 502);
  return text;
}

function mock(turns) {
  const ids = [...turns.at(-1).content.matchAll(/\[(SCH\d{3})\]/g)].map(m => m[1]).slice(0, 3);
  return `**Shortlist**\n\n| School | Rating | Annual fee (AED) | Area | Why it fits |\n|---|---|---|---|---|\n${ids.map(id => `| [${id}] | test | test | test | mock answer |`).join("\n")}\n\n**Next step** This is a mock answer for local testing.`;
}
