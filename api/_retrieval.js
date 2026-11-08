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
  "al sufouh": "al safouh", "muhaisnah": "muhaisnah", "muhaisinah": "muhaisnah", "muhaisanah": "muhaisnah", "muhaisina": "muhaisnah", "muhaisna": "muhaisnah", "muhaysnah": "muhaisnah", "mirdif": "mirdif", "rashidiya": "al rashidiya",
  "twar": "al twar", "satwa": "al satwa", "khawaneej": "al khwaneej", "khwaneej": "al khwaneej",
  "dubai south": "dubai south hq", "town square": "dubai land", "arabian ranches": "arabian ranches",
};

// KHDA spells some areas two ways (Muhaisnah / Muhaisanah): treat them as one place
const SAME_AREA = { "muhaisanah": "muhaisnah" };
const baseArea = a => { const b = String(a || "").toLowerCase().replace(/\s*\(.*\)$/, "").replace(/\s+(first|second|third|fourth|fifth|\d+)$/, "").trim(); return SAME_AREA[b] || b; };

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

export const STEPS = ["ECC", "Pre-KG / FS1", "KG1 / FS2", "KG2 / Year 1", ...Array.from({ length: 12 }, (_, i) => `Grade ${i + 1} / Year ${i + 2}`)];

// "KG1", "FS2", "grade 3", "year 4", "1st standard", "class 5" -> index into STEPS
export function parseGrade(t) {
  let m;
  if (/\b(ecc|toddler|nursery)\b/.test(t)) return 0;
  if (/\b(pre[- ]?kg|fs ?1|foundation stage 1)\b/.test(t)) return 1;
  if (/\b(kg ?1|fs ?2|lkg)\b/.test(t)) return 2;
  if (/\b(kg ?2|ukg)\b/.test(t)) return 3;
  if ((m = t.match(/\byear ?(\d{1,2})\b/)) && +m[1] >= 1 && +m[1] <= 13) return +m[1] + 2;
  if ((m = t.match(/\b(?:grade|class|std|standard) ?(\d{1,2})\b/) || t.match(/\b(\d{1,2})(?:st|nd|rd|th)? ?(?:grade|standard|std|class)\b/))
      && +m[1] >= 1 && +m[1] <= 12) return +m[1] + 3;
  return undefined;
}

export const gradeFee = (s, g) => (g == null || !s.fees_by_grade) ? null : s.fees_by_grade[g];

export function parseNeeds(q, schools = []) {
  let t = String(q).toLowerCase(); const n = {};
  // Radius first ("within 10 km", "5km", "less than 3 kilometres"), then remove it so it is never read as a budget
  const r = t.match(/(?:(?:within|under|below|less than|up to|upto|max(?:imum)?|inside|around|about|in)\s+(?:a\s+)?)?(\d+(?:\.\d+)?)\s*(?:km|kms|kilomet(?:er|re)s?)\b/);
  if (r) { const v = parseFloat(r[1]); if (v > 0 && v <= 60) n.maxKm = v; t = t.replace(r[0], " "); }
  const g = parseGrade(t); if (g !== undefined) n.grade = g;
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
  const text = (s.name + " " + s.curriculum + " " + s.area).toLowerCase();
  if (n.curriculum) sc += s.curriculum.includes(n.curriculum) ? 5 : -4;
  const rank = RANK[s.khda_rating] ?? 0;
  if (n.minRating) sc += rank >= n.minRating ? 3 : -3;
  const gf = gradeFee(s, n.grade);
  if (n.grade != null && s.fees_by_grade && gf == null) sc -= 8;   // school does not offer that grade
  const fee = n.grade != null && s.fees_by_grade ? gf : s.fee_min_aed;
  if (n.budget) {
    if (fee == null) sc -= 1;                                  // unknown fee: keep, but after known fits
    else if (fee <= n.budget) sc += 3 + (n.budget - fee) / n.budget;
    else sc += fee <= n.budget * 1.2 ? 0.5 : -4;
  }
  if (n.place && typeof s.lat === "number") {
    const d = km(n.place, s);
    sc += d <= 3 ? 5 : d <= 6 ? 3.5 : d <= 10 ? 2 : d <= 15 ? 0.5 : -2;
  }
  const named = n.terms.filter(w => text.includes(w)).length;  // school names, e.g. "GEMS Warqa"
  sc += named * 2 + (named >= 2 ? 6 : 0);
  sc += rank * 0.25 + (s.fee_min_aed != null ? 0.3 : 0);
  return Math.round(sc * 100) / 100;
}

// previous = earlier questions in the same conversation, oldest first; the latest value wins per field
export function retrieve(schools, question, previous = [], k = 10) {
  const n = { terms: [] };
  for (const p of [...previous.slice(-2).map(q => parseNeeds(q, schools)), parseNeeds(question, schools)]) {
    for (const key of ["budget", "curriculum", "minRating", "place", "grade", "maxKm"]) if (p[key] !== undefined) n[key] = p[key];
    n.terms.push(...p.terms);
  }
  let pool = schools.map(s => ({ s, score: score(s, n), km: n.place && typeof s.lat === "number" ? Math.round(km(n.place, s) * 10) / 10 : null }));
  // A radius only applies once we know the place; schools without a map point cannot be shown as inside it
  if (n.maxKm && n.place) pool = pool.filter(h => h.km != null && h.km <= n.maxKm);
  const hits = pool.sort((a, b) => b.score - a.score).slice(0, k);
  n.inRadius = n.maxKm && n.place ? pool.length : undefined;
  return { needs: n, hits };
}

const fmtAed = v => "AED " + Number(v).toLocaleString("en-US");

export function recordText(s, distKm = null, placeLabel = "", grade = null) {
  const gf = gradeFee(s, grade);
  let fee;
  if (s.fee_min_aed == null) fee = "Annual tuition: not on file";
  else {
    fee = `Annual tuition: ${fmtAed(s.fee_min_aed)} (lowest grade) to ${fmtAed(s.fee_max_aed)} (highest grade)`;
    if (grade != null && s.fees_by_grade) fee += gf != null ? `. For ${STEPS[grade]}: ${fmtAed(gf)} a year` : `. Does NOT offer ${STEPS[grade]}`;
    fee += `. Source: ${s.fee_source}`;
  }
  return `[${s.id}] ${s.name}
Curriculum: ${s.curriculum} | KHDA rating: ${s.khda_rating}${s.rating_year ? ` (${s.rating_year} inspection)` : ""}
${fee}
Area: ${s.area}${distKm != null ? ` | Straight-line distance from ${placeLabel}: about ${distKm} km` : ""} | Grades offered: ${s.grades}
Website: ${s.website || "not listed"} | Phone: ${s.phone || "not listed"}${s.notes ? "\nNote: " + s.notes : ""}`;
}

// Tells the AI about a requested radius, so it neither invents schools nor ignores the limit
export function radiusNote(n) {
  if (!n.maxKm) return "";
  if (!n.place) return `SEARCH NOTE: The parent asked for schools within ${n.maxKm} km but did not say from where. Ask which area or landmark to measure from.\n\n`;
  return `SEARCH NOTE: Only schools within ${n.maxKm} km (straight line) of ${n.place.label} were retrieved: ${n.inRadius} school(s) in that radius in total.` +
    (n.inRadius === 0 ? " None are inside it; say so and suggest a larger radius." : "") + "\n\n";
}

// ---------- answers that need no AI ----------
const OTHER_EMIRATES = [["abu dhabi", "Abu Dhabi"], ["al ain", "Al Ain"], ["sharjah", "Sharjah"], ["ajman", "Ajman"],
  ["ras al khaimah", "Ras Al Khaimah"], ["rak", "Ras Al Khaimah"], ["fujairah", "Fujairah"], ["umm al quwain", "Umm Al Quwain"], ["uaq", "Umm Al Quwain"]];

// An emirate other than Dubai is named and no Dubai place is: we can't help with AI, so answer directly.
export function otherEmirate(question, needs) {
  const t = " " + String(question).toLowerCase().replace(/[^a-z ]+/g, " ") + " ";
  const hit = OTHER_EMIRATES.find(([w]) => t.includes(` ${w} `));
  if (!hit || needs.place) return null;
  const nearBorder = ["Sharjah", "Ajman", "Umm Al Quwain"].includes(hit[1]);
  return `We only cover **Dubai's private schools** for now, so we can't show schools in ${hit[1]} yet. Other emirates are planned once official data is available.\n\n` +
    (nearBorder
      ? `If you live in ${hit[1]} and can travel into Dubai, try a Dubai area close to the border, for example: *"CBSE school near Al Qusais for KG1 under 20,000"*, or Al Nahda, Muhaisnah or Mirdif.`
      : `If you're open to a school in Dubai, tell me the Dubai area, curriculum, your child's grade and your budget.`);
}

// Nothing to rank on yet (no budget, curriculum, grade, rating, place, distance, or school name): ask instead of calling the AI.
export function needsClarifying(needs, schools) {
  if (["budget", "curriculum", "minRating", "place", "grade", "maxKm"].some(k => needs[k] !== undefined)) return null;
  const names = schools.map(s => s.name.toLowerCase());
  if (needs.terms.some(w => names.some(n => n.includes(w)))) return null;
  return `Happy to help. To find the right schools, tell me:\n\n1. **Your child's grade** next year (e.g. KG1, Grade 3, Year 7)\n2. **Curriculum** (British, CBSE, IB, American, French…)\n3. **Budget** per year in AED\n4. **Where you live** in Dubai (or a distance, e.g. "within 5 km of Mirdif")\n\nFor example: *"CBSE school near Al Qusais for KG1 under AED 20,000"*.`;
}

// Used when every AI model is busy: the search engine's own ranked table, with real fees and distances.
export function searchOnlyAnswer(hits, needs) {
  const rows = hits.slice(0, 6).map(({ s, km: d }) => {
    const gf = gradeFee(s, needs.grade);
    const fee = s.fee_min_aed == null ? "not on file" : needs.grade != null && s.fees_by_grade
      ? (gf != null ? `${fmtAed(gf)} (${STEPS[needs.grade]})` : "grade not offered") : `${fmtAed(s.fee_min_aed)} – ${fmtAed(s.fee_max_aed)}`;
    const yr = s.rating_year ? ` (${String(s.rating_year).slice(0, 4)})` : "";
    return `| ${s.name} [${s.id}] | ${s.khda_rating}${yr} | ${fee} | ${s.area}${d != null ? ` · ${d} km` : ""} | ${s.curriculum} |`;
  });
  return `Our AI assistant is very busy right now, so here are the **best matches from our search**, ranked by fit:\n\n` +
    `| School | KHDA rating | Annual fee | Area / distance | Curriculum |\n|---|---|---|---|---|\n${rows.join("\n")}\n\n` +
    `Tap a record ID to open the school's card, or try again in a few minutes for a written comparison.`;
}
