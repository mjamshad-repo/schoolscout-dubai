// Retrieval checks against the KHDA register data. Run: npm test
import { SCHOOLS } from "../api/_schools.js";
import { retrieve } from "../api/_retrieval.js";

const name = id => SCHOOLS.find(s => s.id === id)?.name;
const cases = [
  { q: "CBSE school rated Very Good or better, under AED 20,000 a year",
    check: h => ["GEMS Our Own Indian School", "GEMS Our Own English High School", "The Indian High School", "Delhi Private School"].every(n => h.slice(0, 6).some(x => x.s.name === n)) },
  { q: "Outstanding British primary school near Dubai Sports City, budget up to AED 55,000",
    check: h => h[0].s.name === "Victory Heights Primary School" },
  { q: "I am looking for a cbse school near by sports city fees under 20000aed for kg1",
    check: (h, n) => n.place?.key === "dubai sports city" && h.slice(0, 5).every(x => x.s.curriculum.includes("Indian")) },
  { q: "1. show me low to high 2. 1st standard", prev: ["I am looking for a cbse school near sports city"],
    check: (h, n) => n.curriculum === "Indian" && n.place && h.slice(0, 6).every(x => x.s.curriculum.includes("Indian")) },
  { q: "Affordable British school in Jebel Ali", check: (h, n) => n.place?.key === "jabal ali" && h[0].s.area.startsWith("Jabal Ali") },
  { q: "IB school in Emirates Hills", check: h => h[0].s.name.startsWith("Dubai International Academy") },
  { q: "American school in Al Qusais", check: (h, n) => n.place?.key === "al qusais" && h[0].s.curriculum.includes("American") },
  { q: "French school near Oud Metha", check: h => h[0].s.curriculum.includes("French") && h[0].km < 3 },
  { q: "British secondary school for Year 10 near Al Barsha under 60000", check: (h, n) => n.grade === 12 && h.slice(0, 5).every(x => x.s.fees_by_grade?.[12] != null) },
  { q: "CBSE school near Sports City for KG1 under 20000", check: (h, n) => n.grade === 2 && h.slice(0, 3).every(x => x.s.fees_by_grade?.[2] != null && x.s.fees_by_grade[2] <= 20000) },
  { q: "CBSE school within 10 km of Sports City", check: (h, n) => n.maxKm === 10 && n.budget === undefined && h.length > 0 && h.every(x => x.km != null && x.km <= 10) },
  { q: "British school 5km from Al Barsha under 50000", check: (h, n) => n.maxKm === 5 && n.budget === 50000 && h.every(x => x.km <= 5) },
  { q: "schools within 3 km", check: (h, n) => n.maxKm === 3 && !n.place },
  { q: "british school in sports city", check: h => h.slice(0, 5).some(x => x.s.id === "SCH180") },   // new school, KHDA map point off by 10 km
  { q: "Queen Elizabeths School fees", check: h => h[0].s.id === "SCH180" },
];

let fail = 0;
for (const c of cases) {
  const { needs, hits } = retrieve(SCHOOLS, c.q, c.prev || []);
  const ok = !!c.check(hits, needs);
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.q}${needs.place ? `   [place: ${needs.place.label}]` : ""}\n      -> ${hits.slice(0, 6).map(h => `${h.s.name} (${h.score}${h.km != null ? `, ${h.km}km` : ""}${needs.grade != null && h.s.fees_by_grade ? `, grade fee ${h.s.fees_by_grade[needs.grade] ?? "n/a"}` : h.s.fee_min_aed != null ? `, AED ${h.s.fee_min_aed}` : ", no fee"})`).join(" | ")}`);
}
console.log(fail ? `\n${fail} failing` : "\nall retrieval checks pass");
process.exit(fail ? 1 : 0);
