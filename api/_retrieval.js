// Retrieval step of the RAG pipeline: read the parent's needs, score every record, keep the best k.
// Shared by the server (api/ask.js) and the Claude artifact build. Files starting with "_" are not routes on Vercel.

export const RANK = { "Outstanding": 5, "Very Good": 4, "Good": 3, "Acceptable": 2, "Weak": 1, "Very Weak": 0 };

const CUR_WORDS = {
  british: "British", uk: "British", english: "British", igcse: "British", gcse: "British",
  cbse: "Indian", icse: "Indian", indian: "Indian", india: "Indian",
  ib: "IB", baccalaureate: "IB",
  american: "American", us: "American", usa: "American",
  french: "French", german: "German", japanese: "Japanese", pakistani: "Pakistani",
  filipino: "Philippine", philippine: "Philippine", chinese: "Chinese", australian: "Australian",
  sabis: "SABIS", moe: "Ministry of Education", ministry: "Ministry of Education",
};

const STOP = new Set(["school", "schools", "dubai", "rated", "rating", "year", "with", "near", "nearby", "under", "budget",
  "good", "very", "outstanding", "better", "international", "private", "high", "about", "around", "that", "this",
  "need", "want", "fee", "fees", "aed", "city", "show", "looking", "child", "daughter", "son", "kids", "best", "cheap",
  "affordable", "from", "what", "which", "please", "standard", "grade", "close", "closest", "nearest", "area", "list",
  "first", "second", "third", "south", "north", "road"]);

// Spellings parents use -> the KHDA area spelling (base name, without First/Second/...)
const PLACE_ALIASES = {
  "sports city": "dubai sports city", "dsc": "dubai sports city", "motor city": "motor city",
  "jvc": "jumeirah village circle", "jumeirah village": "jumeirah village circle",
  "al quoz": "al qouz", "quoz": "al qouz", "jumeirah": "jumeira", "barsha": "al barsha",
  "qusais": "al qusais", "warqa": "al warqa", "nad al sheba": "nadd al shiba", "nad al shiba": "nadd al shiba",
  "garhoud": "al garhoud", "mizhar": "al mizhar", "nahda": "al nahda", "karama": "al karama",
  "dip": "dubai investment park", "investment park": "dubai investment park", "silicon oasis": "dubai silicon oasis",
  "dso": "dubai silicon oasis", "dubailand": "dubai land", "jebel ali": "jabal ali", "festival city": "dubai festival city",
  "healthcare city": "dubai healthcare city", "knowledge park": "dubai knowledge park", "sufouh": "al safouh",
  "al sufouh": "al safouh", "muhaisnah": "muhaisnah", "mirdif": "mirdif", "rashidiya": "al rashidiya",
  "twar": "al twar", "satwa": "al satwa", "khawaneej": "al khwaneej", "khwaneej": "al khwaneej",
  "dubai south": "dubai south hq", "town square": "dubai land", "arabian ranches": "arabian ranches",
};

const baseArea = a => String(a || "").toLowerCase().replace(/\s*\(.*\)$/, "").replace(/\s+(first|second|third|fourth|fifth|\d+)$/, "").trim();

let PLACES = null; // base area -> {lat, lng, label}
function places(schools) {
  if (PLACES) return PLACES;
  const acc = {};
  for (const s of schools) {
    if (typeof s.lat !== "number" || typeof s.lng !== "number") continue;
    const b = baseArea(s.area); if (!b) continue;
    (acc[b] ||= { lat: 0, lng: 0, n: 0, label: s.area.replace(/\s+(First|Second|Third|Fourth|Fifth|\d+)$/, "") });
    acc[b].lat += s.lat; acc[b].lng += s.lng; acc[b].n++;
  }
  PLACES = Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, { lat: v.lat / v.n, lng: v.lng / v.n, label: v.label }]));
  return PLACES;
}

function findPlace(t, schools) {
  const P = places(schools);
  let best = null;
  const consider = (phrase, key) => {
    if (P[key] && new RegExp("\\b" + phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b").test(t) && (!best || phrase.length > best.len))
      best = { key, phrase, len: phrase.length };
  };
  for (const key of Object.keys(P)) consider(key, key);
  for (const [phrase, key] of Object.entries(PLACE_ALIASES)) consider(phrase, key);
  return best ? { key: best.key, phrase: best.phrase, ...P[best.key] } : null;
}

export function km(a, b) {
  const R = 6371, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function parseNeeds(q, schools = []) {
  const t = String(q).toLowerCase(), n = {};
  const m = t.match(/(?:under|below|less than|up to|upto|max(?:imum)?|within|budget(?: of| is)?|around|about)\s*(?:aed|dh|dhs)?\.?\s*([\d.,]+)\s*(k|,000|000)?/);
  if (m) { let v = parseFloat(m[1].replace(/,/g, "")); if (m[2] === "k" || v < 1000) v *= 1000; n.budget = v; }
  if (n.budget === undefined && /\b(affordable|cheap|cheapest|budget|low[- ]cost|economical)\b/.test(t)) n.budget = 20000;
  for (const [w, c] of Object.entries(CUR_WORDS)) if (new RegExp("\\b" + w + "\\b").test(t)) { n.curriculum = c; break; }
  if (/outstanding/.test(t)) n.minRating = 5; else if (/very good/.test(t)) n.minRating = 4; else if (/\bgood\b/.test(t)) n.minRating = 3;
  const place = findPlace(t, schools); if (place) n.place = place;
  const placeWords = new Set(place ? [...place.key.split(" "), ...(place.phrase || "").split(" ")] : []);
  n.terms = t.split(/[^a-z0-9]+/).filter(w => w.length > 3 && !STOP.has(w) && !CUR_WORDS[w] && !placeWords.has(w));
  return n;
}

function score(s, n) {
  let sc = 0;
  const text = (s.name + " " + s.curriculum).toLowerCase();
  if (n.curriculum) sc += s.curriculum.includes(n.curriculum) ? 5 : -4;
  const rank = RANK[s.khda_rating] ?? 0;
  if (n.minRating) sc += rank >= n.minRating ? 3 : -3;
  if (n.budget) {
    if (s.fee_min_aed == null) sc -= 1;                       // unknown fee: keep, but after known fits
    else if (s.fee_min_aed <= n.budget) sc += 3 + (n.budget - s.fee_min_aed) / n.budget;
    else sc += s.fee_min_aed <= n.budget * 1.2 ? 0.5 : -4;
  }
  if (n.place && typeof s.lat === "number") {
    const d = km(n.place, s);
    sc += d <= 3 ? 5 : d <= 6 ? 3.5 : d <= 10 ? 2 : d <= 15 ? 0.5 : -2;
  }
  for (const w of n.terms) if (text.includes(w)) sc += 2;     // school names
  sc += rank * 0.25 + (s.fee_min_aed != null ? 0.3 : 0);
  return Math.round(sc * 100) / 100;
}

// previous = earlier questions in the same conversation, oldest first; the latest value wins per field
export function retrieve(schools, question, previous = [], k = 10) {
  const n = { terms: [] };
  for (const p of [...previous.slice(-2).map(q => parseNeeds(q, schools)), parseNeeds(question, schools)]) {
    for (const key of ["budget", "curriculum", "minRating", "place"]) if (p[key] !== undefined) n[key] = p[key];
    n.terms.push(...p.terms);
  }
  const hits = schools.map(s => ({ s, score: score(s, n), km: n.place && typeof s.lat === "number" ? Math.round(km(n.place, s) * 10) / 10 : null }))
    .sort((a, b) => b.score - a.score).slice(0, k);
  return { needs: n, hits };
}

const fmtAed = v => "AED " + Number(v).toLocaleString("en-US");

export function recordText(s, distKm = null, placeLabel = "") {
  const fee = s.fee_min_aed != null
    ? `Annual tuition: ${fmtAed(s.fee_min_aed)} (lowest grade) to ${fmtAed(s.fee_max_aed)} (highest grade). Fee source: ${s.fee_source}`
    : "Annual tuition: not on file (check the school or its KHDA fee sheet)";
  return `[${s.id}] ${s.name}
Curriculum: ${s.curriculum} | KHDA rating: ${s.khda_rating}${s.rating_year ? ` (${s.rating_year} inspection)` : ""}
${fee}
Area: ${s.area}${distKm != null ? ` | Straight-line distance from ${placeLabel}: about ${distKm} km` : ""} | Grades: ${s.grades}
Website: ${s.website || "not listed"} | Phone: ${s.phone || "not listed"}${s.notes ? "\nNote: " + s.notes : ""}${s.stale ? "\nCAUTION: fee is from 2022; the current fee is likely higher." : ""}`;
}
