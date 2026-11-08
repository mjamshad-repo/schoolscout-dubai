// End-to-end checks of /api/ask with a fake AI: rules answers, cache, fallbacks, and the busy-table fallback.
process.env.GEMINI_API_KEY = "test"; delete process.env.AI_PROVIDER;
const calls = [];
let behaviour = () => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: "AI ANSWER" }] } }] } });
globalThis.fetch = async (url, opts) => {
  const model = (url.match(/models\/([^:]+):/) || [])[1]; calls.push(model);
  const { status, body } = behaviour(model, JSON.parse(opts.body));
  return { ok: status < 300, status, json: async () => body };
};
const { default: handler } = await import("../api/ask.js");
const ask = (question, history = [], ip = String(Math.random())) => new Promise(done => {
  const res = { code: 0, status(c) { this.code = c; return this; }, json(b) { done({ code: this.code, ...b }); } };
  handler({ method: "POST", headers: { "x-forwarded-for": ip }, body: { question, history } }, res);
});
let fail = 0; const check = (name, ok, extra = "") => { if (!ok) fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name} ${extra}`); };

let r = await ask("CBSE school in Sharjah under 15000");
check("other emirate -> rules, no AI call", r.provider === "rules" && calls.length === 0 && /Dubai/.test(r.answer));
r = await ask("I live in Sharjah, CBSE school near Al Qusais for KG1");
check("Sharjah + Dubai place -> AI", r.provider === "gemini:gemini-3.5-flash-lite", r.provider);
calls.length = 0;
r = await ask("I need a school for my daughter");
check("vague -> clarifying question, no AI call", r.provider === "rules" && calls.length === 0);
r = await ask("Tell me about Delhi Private School fees");
check("school name -> AI", r.provider.startsWith("gemini"), r.provider);
calls.length = 0;
r = await ask("Tell me about Delhi Private School fees");
check("repeat question -> cache, no AI call", r.provider === "cache" && calls.length === 0);

calls.length = 0;
behaviour = m => m === "gemini-3.5-flash-lite" ? { status: 429, body: { error: { message: "Quota exceeded for requests per day" } } } : { status: 200, body: { candidates: [{ content: { parts: [{ text: "OK" }] } }] } };
r = await ask("British school near Al Barsha for Year 3");
check("first model out of quota -> second model", r.provider === "gemini:gemini-3.1-flash-lite", `${r.provider} after ${calls.join(" > ")}`);
calls.length = 0;
r = await ask("IB school near Emirates Hills");
check("quota model skipped while cooling", calls[0] === "gemini-3.1-flash-lite", calls.join(" > "));

behaviour = m => m === "gemma-4-31b-it" ? { status: 200, body: { candidates: [{ content: { parts: [{ text: "GEMMA" }] } }] } } : { status: 503, body: { error: { message: "overloaded" } } };
let gemmaBody; const prev = globalThis.fetch;
globalThis.fetch = async (url, opts) => { if (url.includes("gemma")) gemmaBody = JSON.parse(opts.body); return prev(url, opts); };
r = await ask("American school in Al Qusais for Grade 3");
check("Lite models busy -> Gemma, rules inside first turn", r.provider === "gemini:gemma-4-31b-it" && !gemmaBody.systemInstruction && /RETRIEVED|QUESTION/.test(gemmaBody.contents[0].parts[0].text) && /assistant/.test(gemmaBody.contents[0].parts[0].text), r.provider);
globalThis.fetch = prev;

behaviour = () => ({ status: 503, body: { error: { message: "overloaded" } } });
r = await ask("French school near Oud Metha under 60000");
check("everything busy -> search table, still 200", r.code === 200 && r.provider === "search" && /\| School \|/.test(r.answer) && /SCH\d{3}/.test(r.answer));
console.log(fail ? `\n${fail} failing` : "\nall ask checks pass"); process.exit(fail ? 1 : 0);
