// AI router: tries a chain of models and moves to the next one when a model is busy, out of free quota or missing.
// Providers join the chain only when their key is set:
//   cloudflare -> Cloudflare Workers AI (free daily allowance, no training)  CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_MODEL
//   groq       -> Groq, OpenAI-compatible (free tier, no retention)         GROQ_API_KEY, GROQ_MODEL
//   gemini     -> Google Gemini API; several models, each with its own free quota   GEMINI_API_KEY, GEMINI_MODELS
//   anthropic  -> Claude API (paid)                                         ANTHROPIC_API_KEY, ANTHROPIC_MODEL
//   mock       -> no network; canned answer for local testing (AI_PROVIDER=mock)
// Default order: cloudflare, groq (private) -> Gemini Flash Lite models -> Gemma -> Gemini Flash -> anthropic.
// Override with AI_ORDER, e.g. "gemini:gemini-3.5-flash-lite,groq,gemini:gemma-4-31b-it".

const env = process.env;
const DEFAULT_GEMINI = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemma-4-31b-it", "gemini-2.5-flash"];
const PER_CALL_MS = 10000;   // a model slower than this is skipped; the next one answers instead

export class ProviderError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

export function chain(order = env.AI_ORDER) {
  if ((env.AI_PROVIDER || "").toLowerCase() === "mock") return [{ id: "mock", run: mock }];
  const steps = {
    cloudflare: env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ACCOUNT_ID ? [{ id: `cloudflare:${env.CLOUDFLARE_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast"}`, run: cloudflare }] : [],
    groq: env.GROQ_API_KEY ? [{ id: `groq:${env.GROQ_MODEL || "openai/gpt-oss-120b"}`, run: groq }] : [],
    anthropic: env.ANTHROPIC_API_KEY ? [{ id: `anthropic:${env.ANTHROPIC_MODEL || "claude-haiku-5-5"}`, run: anthropic }] : [],
  };
  const geminiModels = env.GEMINI_API_KEY ? (env.GEMINI_MODELS ? env.GEMINI_MODELS.split(",").map(s => s.trim()).filter(Boolean) : DEFAULT_GEMINI) : [];
  const g = m => ({ id: `gemini:${m}`, run: (s, t, meter) => gemini(m, s, t, meter) });
  if (order) {
    return order.split(",").map(s => s.trim()).flatMap(s => s.startsWith("gemini:") ? (env.GEMINI_API_KEY ? [g(s.slice(7))] : []) : (steps[s] || []));
  }
  const lite = geminiModels.filter(m => /lite/.test(m)), rest = geminiModels.filter(m => !/lite/.test(m));
  return [...steps.cloudflare, ...steps.groq, ...lite.map(g), ...rest.map(g), ...steps.anthropic];
}

export const providerName = () => chain().map(c => c.id.split(":")[0])[0] || "none";

// Models that just said "out of quota" are skipped for a while (per server instance), so later visitors don't wait on them.
const cooling = new Map();
const COOL_MS = { quota: 15 * 60_000, busy: 60_000, slow: 5 * 60_000, missing: 6 * 3600_000 };

// system: string; turns: [{role, content}] ending on a user turn. Returns { text, model }.
export async function complete(system, turns, order) {
  const steps = chain(order);
  if (!steps.length) throw new ProviderError("No AI provider is configured. Set GEMINI_API_KEY (free), GROQ_API_KEY or CLOUDFLARE_API_TOKEN.", 500);
  const started = Date.now(); let last; const attempts = [];   // every model tried, for the admin's capacity view
  for (const step of steps) {
    if ((cooling.get(step.id) || 0) > Date.now()) continue;
    if (Date.now() - started > 22000) break;                       // keep inside the function's time limit
    const meter = {};
    try { const text = await step.run(system, turns, meter); attempts.push({ model: step.id, ok: 1, ...meter }); return { text, model: step.id, attempts }; }
    catch (e) {
      last = e; attempts.push({ model: step.id, ok: 0, kind: e.kind || "error", ...meter });
      if (e.kind) cooling.set(step.id, Date.now() + COOL_MS[e.kind]);
      console.warn(`AI step ${step.id} failed (${e.kind || "error"}): ${e.message.slice(0, 160)}`);
    }
  }
  const e = new ProviderError("Every AI model is busy or out of free quota right now.", 503); e.allBusy = true; e.cause = last; e.attempts = attempts; throw e;
}

async function post(url, headers, body, meter = {}) {
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), PER_CALL_MS);
  let r;
  try { r = await fetch(url, { method: "POST", signal: ctl.signal, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }); }
  catch (err) { const e = new ProviderError(err.name === "AbortError" ? "timed out" : err.message, 503); e.kind = err.name === "AbortError" ? "slow" : "busy"; throw e; }
  finally { clearTimeout(timer); }
  const data = await r.json().catch(() => ({}));
  // What the provider says is left (Groq sends these headers; others don't)
  const h = n => r.headers?.get?.(n);
  if (h("x-ratelimit-remaining-requests")) Object.assign(meter, { left_day: Number(h("x-ratelimit-remaining-requests")), limit_day: Number(h("x-ratelimit-limit-requests")) || null,
    left_tokens_min: Number(h("x-ratelimit-remaining-tokens")) || null });
  const u = data.usage || data.usageMetadata;
  if (u) Object.assign(meter, { tin: u.prompt_tokens ?? u.input_tokens ?? u.promptTokenCount ?? 0, tout: u.completion_tokens ?? u.output_tokens ?? u.candidatesTokenCount ?? 0 });
  if (r.ok) return data;
  const msg = data?.error?.message || data?.errors?.[0]?.message || `HTTP ${r.status}`;
  const e = new ProviderError(`AI provider error ${r.status}: ${msg}`, 502);
  e.httpStatus = r.status;
  if (r.status === 429) e.kind = /quota|per day|daily|exhausted|limit: 0/i.test(msg) ? "quota" : "busy";
  else if (r.status >= 500) e.kind = "busy";
  else if (r.status === 404) e.kind = "missing";
  throw e;
}

const THINKING_OK = new Map();
const empty = () => new ProviderError("The AI returned an empty answer.", 502);

async function gemini(model, system, turns, meter) {
  const gemma = /^gemma/.test(model);
  const contents = turns.map(t => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: t.content }] }));
  // Gemma on the Gemini API takes no system instruction: put the rules in the first user turn instead.
  if (gemma) contents[0] = { role: "user", parts: [{ text: `${system}\n\n---\n\n${contents[0].parts[0].text}` }] };
  const body = thinkingConfig => ({
    ...(gemma ? {} : { systemInstruction: { parts: [{ text: system }] } }),
    contents,
    generationConfig: { temperature: 0.2, maxOutputTokens: 4096, ...(thinkingConfig ? { thinkingConfig } : {}) },
  });
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const headers = { "x-goog-api-key": env.GEMINI_API_KEY };
  // A shortlist needs little "thinking". Gemini 2.x takes a token budget, Gemini 3+ a level; if a model rejects
  // a setting (HTTP 400), try the next one, ending with no setting at all. The first setting that works is remembered.
  const options = gemma ? [null] : /^gemini-[3-9]/.test(model) ? [{ thinkingLevel: "minimal" }, { thinkingLevel: "low" }, null]
    : /flash/.test(model) ? [{ thinkingBudget: 0 }, null] : [null];
  let data, i = THINKING_OK.get(model) ?? 0;
  for (; i < options.length; i++) {
    try { data = await post(url, headers, body(options[i]), meter); THINKING_OK.set(model, i); break; }
    catch (e) { if (e.httpStatus !== 400 || i === options.length - 1) throw e; }
  }
  const parts = data.candidates?.[0]?.content?.parts || [];
  const text = parts.filter(p => !p.thought).map(p => p.text || "").join("").trim();
  if (!text) throw empty();
  return text;
}

async function openaiStyle(url, key, model, system, turns, meter) {
  const data = await post(url, { authorization: `Bearer ${key}` },
    { model, temperature: 0.2, max_tokens: 2048, messages: [{ role: "system", content: system }, ...turns] }, meter);
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw empty();
  return text;
}
const groq = (s, t, m) => openaiStyle("https://api.groq.com/openai/v1/chat/completions", env.GROQ_API_KEY, env.GROQ_MODEL || "openai/gpt-oss-120b", s, t, m);
const cloudflare = (s, t, m) => openaiStyle(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/v1/chat/completions`,
  env.CLOUDFLARE_API_TOKEN, env.CLOUDFLARE_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast", s, t, m);

async function anthropic(system, turns, meter) {
  const data = await post("https://api.anthropic.com/v1/messages",
    { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    { model: env.ANTHROPIC_MODEL || "claude-haiku-5-5", max_tokens: 2048, temperature: 0.2, system, messages: turns }, meter);
  const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
  if (!text) throw empty();
  return text;
}

function mock(system, turns) {
  const ids = [...turns.at(-1).content.matchAll(/\[(SCH\d{3})\]/g)].map(m => m[1]).slice(0, 3);
  return `**Shortlist**\n\n| School | Rating | Annual fee (AED) | Area | Why it fits |\n|---|---|---|---|---|\n${ids.map(id => `| [${id}] | test | test | test | mock answer |`).join("\n")}\n\n**Next step** This is a mock answer for local testing.`;
}
