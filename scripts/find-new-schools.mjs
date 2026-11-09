// Looks for KHDA schools that are newer than our register: probes the KHDA open data fees API for education
// centre IDs above the highest one we know. A school that answers with fees is new to us.
// Polite: one request at a time with a pause. Writes new-schools.md (empty when nothing is found).
//   node scripts/find-new-schools.mjs [howManyIdsToCheck=1500]
import { readFileSync, writeFileSync } from "node:fs";

const API = "https://webapi.khda.gov.ae/opendata/api/SchoolFeesByGrade";
const PAUSE_MS = 350, SPAN = Number(process.argv[2] || 1500);
const schools = JSON.parse(readFileSync(new URL("../schools.json", import.meta.url)));
const known = new Set(schools.map(s => s.khda_id));
const top = Math.max(...known);

const found = [];
let errors = 0;
for (let id = top + 1; id <= top + SPAN; id++) {
  try {
    const r = await fetch(`${API}?EducationCenterId=${id}&feetypeid=1`);
    if (!r.ok) { errors++; continue; }
    const fees = (await r.json()).fees || [];
    if (fees.length) {
      const years = [...new Set(fees.map(f => f.academicYearId))].sort();
      const curricula = [...new Set(fees.map(f => f.curriculum).filter(Boolean))];
      found.push({ id, rows: fees.length, years, curricula, max: Math.max(...fees.map(f => f.fees || 0)) });
      console.log(`new: ${id} (${curricula.join(", ")})`);
    }
  } catch { errors++; }
  if (errors > 50) throw new Error("KHDA API keeps failing; stopping early.");
  await new Promise(res => setTimeout(res, PAUSE_MS));
}
console.log(`checked IDs ${top + 1}-${top + SPAN}: ${found.length} new school(s) with fees, ${errors} errors`);
const md = found.length ? [
  `KHDA has published fees for **${found.length} school(s) that are not on the site yet** (checked IDs ${top + 1} to ${top + SPAN}).`, "",
  "| KHDA ID | Curriculum | Academic years | Highest fee (AED) | KHDA page |", "|---|---|---|---|---|",
  ...found.map(f => `| ${f.id} | ${f.curricula.join(", ") || "?"} | ${f.years.map(y => `${2000 + y}-${(y + 1) % 100}`).join(", ")} | ${Math.round(f.max).toLocaleString("en-US")} | https://web.khda.gov.ae/en/Education-Directory/Schools/School-Details?CenterID=${f.id} |`),
  "", "**To add them:** export a fresh school register from the KHDA directory into `data/` (or tell Claude in your Dubai School Fees chat), then run the *Refresh KHDA fees* workflow.",
].join("\n") : "";
writeFileSync(new URL("../new-schools.md", import.meta.url), md);
