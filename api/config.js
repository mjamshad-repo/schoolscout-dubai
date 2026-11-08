// GET /api/config -> public settings the page needs (the Turnstile site key is public by design)
import { turnstileOn } from "./_guard.js";
import { storeEnabled } from "./_store.js";
export default function handler(req, res) {
  res.setHeader("cache-control", "public, max-age=300");
  res.status(200).json({ turnstileSiteKey: turnstileOn() ? process.env.TURNSTILE_SITE_KEY : null, feedback: storeEnabled() });
}
