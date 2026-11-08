// POST /api/feedback { id, vote: 1 | -1 }  -> thumbs up / down on a logged answer
import { originAllowed, clientIp, tooFast } from "./_guard.js";
import { setVote, storeEnabled } from "./_store.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  if (!originAllowed(req)) return res.status(403).json({ error: "Not allowed." });
  if (tooFast("fb:" + clientIp(req), 20)) return res.status(429).json({ error: "Too many." });
  let b = req.body; if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }
  const id = String(b?.id || ""), vote = Number(b?.vote);
  if (!/^[0-9a-f-]{36}$/.test(id) || ![1, -1].includes(vote)) return res.status(400).json({ error: "Bad request." });
  if (!storeEnabled()) return res.status(200).json({ ok: false });
  try { await setVote(id, vote); res.status(200).json({ ok: true }); }
  catch { res.status(200).json({ ok: false }); }
}
