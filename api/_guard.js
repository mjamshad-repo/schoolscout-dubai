// Who may call the API, and how often.
//  1. Origin check: only pages on our own domains (and local testing) may call it.
//  2. Cloudflare Turnstile (optional, free): an invisible bot check; on when TURNSTILE_SECRET is set.
//  3. Per-visitor limits: RATE_LIMIT_PER_MIN per minute (memory) and VISITOR_DAILY_AI per day (database).
//  4. A site-wide daily AI cap, AI_DAILY_CAP. Over a cap, visitors get the search table instead of an AI answer.
const env = process.env;

const OWN_HOSTS = ["uaeschoolfees.com", "www.uaeschoolfees.com", "dubaischoolfees.com", "www.dubaischoolfees.com", "schoolscout-dubai.vercel.app"];
const extraHosts = () => (env.ALLOWED_HOSTS || "").split(",").map(s => s.trim()).filter(Boolean);

export function clientIp(req) {
  return String(req.headers["x-real-ip"] || req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "?").split(",")[0].trim();
}

export function originAllowed(req) {
  const src = req.headers.origin || req.headers.referer || "";
  let host; try { host = new URL(src).hostname; } catch { return false; }
  if ([...OWN_HOSTS, ...extraHosts()].includes(host)) return true;
  if (/^schoolscout-dubai-[a-z0-9-]+-mjamshad-s-projects\.vercel\.app$/.test(host)) return true;   // Vercel previews
  return host === "localhost" || host === "127.0.0.1";
}

export const turnstileOn = () => !!(env.TURNSTILE_SECRET && env.TURNSTILE_SITE_KEY);

export async function turnstileOk(token, ip) {
  if (!turnstileOn()) return true;
  if (!token || typeof token !== "string" || token.length > 4096) return false;
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip }),
    });
    return !!(await r.json()).success;
  } catch { return true; }   // if Cloudflare itself is down, don't lock real parents out
}

const perMin = new Map();
export function tooFast(ip, limit = Number(env.RATE_LIMIT_PER_MIN || 8)) {
  const now = Date.now(), recent = (perMin.get(ip) || []).filter(t => now - t < 60_000);
  recent.push(now); perMin.set(ip, recent);
  if (perMin.size > 5000) perMin.clear();
  return recent.length > limit;
}

export const caps = () => ({ visitor: Number(env.VISITOR_DAILY_AI || 40), all: Number(env.AI_DAILY_CAP || 1500) });
