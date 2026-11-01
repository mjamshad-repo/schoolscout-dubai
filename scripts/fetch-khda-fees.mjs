// Refreshes data/khda_fees_by_grade.txt from KHDA's open data API (SchoolFeesByGrade).
// One request per school, sequential, with a pause between requests. Run where webapi.khda.gov.ae is reachable:
//   node scripts/fetch-khda-fees.mjs        then: npm run data && npm run web
import { readFileSync, writeFileSync } from "node:fs";

const API = "https://webapi.khda.gov.ae/opendata/api/SchoolFeesByGrade";
const PAUSE_MS = 400;
const YEAR = 26;                    // academicYearId 26 = 2026-27; falls back to the latest year a school has
const schools = JSON.parse(readFileSync(new URL("../schools.json", import.meta.url)));

const STEP = g => g.startsWith("ECC") ? 0 : g === "Pre KG - FS1" ? 1 : g === "KG1 - FS2" ? 2 : g === "KG2 - Year1" ? 3
  : (m => m && +m[1] <= 12 ? 3 + +m[1] : -1)(g.match(/^Grade(\d+) -/));

const lines = [];
for (const [i, s] of schools.entries()) {
  const r = await fetch(`${API}?EducationCenterId=${s.khda_id}&feetypeid=1`);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${s.name}`);
  const rows = (await r.json()).fees || [];
  const years = [...new Set(rows.map(f => f.academicYearId))];
  const yr = years.includes(YEAR) ? YEAR : Math.max(...years, YEAR);
  const use = rows.filter(f => f.academicYearId === yr && f.fees >= 1000);
  const step = Array(16).fill(null);
  for (const f of use) { const k = STEP(f.mbrGrade); if (k >= 0) step[k] = step[k] == null ? f.fees : Math.min(step[k], f.fees); }
  const mx = use.length ? Math.max(...use.map(f => f.fees)) : "";
  lines.push(`${s.khda_id}|${yr}|${new Set(use.map(f => f.curriculum)).size}|${mx}|${step.map(v => v == null ? "" : Math.round(v)).join(",")}`);
  process.stdout.write(`\r${i + 1}/${schools.length}`);
  await new Promise(res => setTimeout(res, PAUSE_MS));
}
const header = `# KHDA open data API: SchoolFeesByGrade (feetypeid=1, tuition), fetched ${new Date().toISOString().slice(0, 10)}
# format: educationCenterId|academicYearId|curricula count|max fee|fee per step (lowest across curricula/sections), AED
# steps: ECC, PreKG/FS1, KG1/FS2, KG2/Y1, G1/Y2 ... G12/Y13
`;
writeFileSync(new URL("../data/khda_fees_by_grade.txt", import.meta.url), header + lines.join("\n") + "\n");
console.log(`\nwrote ${lines.length} schools`);
