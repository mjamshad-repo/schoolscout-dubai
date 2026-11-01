// Retrieval step of the RAG pipeline: read the parent's needs, score every record, keep the best k.
// Files starting with "_" are helpers, not routes, on Vercel.

export const RANK = { "Outstanding": 5, "Very Good": 4, "Good": 3, "Acceptable": 2, "Weak": 1, "Very Weak": 0 };

const CUR_WORDS = {
  british: "British", uk: "British", english: "British", igcse: "British",
  cbse: "CBSE", indian: "CBSE", india: "CBSE",
  ib: "IB", baccalaureate: "IB",
  american: "American", us: "American", usa: "American",
  french: "French",
};

const STOP = new Set(["school", "schools", "dubai", "rated", "rating", "year", "with", "near", "under", "budget",
  "good", "very", "outstanding", "better", "international", "private", "high", "about",
  "around", "that", "this", "need", "want", "fee", "fees", "aed", "city", "show", "looking", "child", "daughter",
  "son", "kids", "best", "cheap", "affordable", "from", "what", "which", "please", "standard", "grade"]);

export function parseNeeds(q) {
  const t = String(q).toLowerCase(), n = {};
  const m = t.match(/(?:under|below|less than|up to|upto|max(?:imum)?|within|budget(?: of| is)?|around|about)\s*(?:aed|dh|dhs)?\.?\s*([\d.,]+)\s*(k|,000|000)?/);
  if (m) { let v = parseFloat(m[1].replace(/,/g, "")); if (m[2] === "k" || v < 1000) v *= 1000; n.budget = v; }
  if (n.budget === undefined && /\b(affordable|cheap|cheapest|budget|low[- ]cost|economical)\b/.test(t)) n.budget = 20000;
  for (const [w, c] of Object.entries(CUR_WORDS)) if (new RegExp("\\b" + w + "\\b").test(t)) { n.curriculum = c; break; }
  if (/outstanding/.test(t)) n.minRating = 5; else if (/very good/.test(t)) n.minRating = 4; else if (/\bgood\b/.test(t)) n.minRating = 3;
  n.terms = t.split(/[^a-z0-9]+/).filter(w => w.length > 3 && !STOP.has(w) && !CUR_WORDS[w]);
  return n;
}

function score(s, n) {
  let sc = 0;
  const text = (s.name + " " + s.area + " " + s.curriculum + " " + s.grades).toLowerCase();
  if (n.curriculum) sc += s.curriculum.includes(n.curriculum) ? 4 : -3;
  if (n.minRating) sc += (RANK[s.khda_rating] ?? 0) >= n.minRating ? 3 : -2;
  if (n.budget) {
    sc += s.fee_min_aed <= n.budget ? 3 : (s.fee_min_aed <= n.budget * 1.2 ? 1 : -3);
    if (s.fee_min_aed <= n.budget) sc += (n.budget - s.fee_min_aed) / n.budget;   // tie-breaker: more headroom ranks higher
  }
  for (const w of n.terms) if (text.includes(w)) sc += 2;
  sc += (RANK[s.khda_rating] ?? 0) * 0.2;
  return Math.round(sc * 10) / 10;
}

// previous = earlier questions in the same conversation, oldest first; the latest value wins per field
export function retrieve(schools, question, previous = [], k = 8) {
  const n = { terms: [] };
  for (const p of [...previous.slice(-2).map(parseNeeds), parseNeeds(question)]) {
    for (const key of ["budget", "curriculum", "minRating"]) if (p[key] !== undefined) n[key] = p[key];
    n.terms.push(...p.terms);
  }
  const hits = schools.map(s => ({ s, score: score(s, n) })).sort((a, b) => b.score - a.score).slice(0, k);
  return { needs: n, hits };
}

const aed = v => "AED " + Number(v).toLocaleString("en-US");

export function recordText(s) {
  return `[${s.id}] ${s.name}
Curriculum: ${s.curriculum} | KHDA rating: ${s.khda_rating}
Annual tuition: ${aed(s.fee_min_aed)} (lowest grade) to ${aed(s.fee_max_aed)} (highest grade)
Area: ${s.area} | Grades: ${s.grades}
Fee source: ${s.fee_source}
Rating source: ${s.rating_source}${s.notes ? "\nNote: " + s.notes : ""}${s.stale ? "\nCAUTION: fee and rating data from 2022; current fee likely higher." : ""}`;
}
