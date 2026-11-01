// Retrieval checks. Run: npm test
import { SCHOOLS } from "../api/_schools.js";
import { retrieve } from "../api/_retrieval.js";

const cases = [
  { q: "CBSE school rated Very Good or better, under AED 20,000 a year", expectTop: ["Delhi Private School", "GEMS Our Own Indian School", "GEMS Our Own English High School", "The Indian High School"] },
  { q: "Outstanding British primary school near Dubai Sports City, budget up to AED 55,000", expectTop: ["Victory Heights Primary School"] },
  { q: "Affordable British school in Jebel Ali", expectTop: ["The Winchester School"] },
  { q: "1. show me low to high 2. 1st standard", prev: ["I am looking for a cbse school near sports city"], expectCurriculum: "CBSE" },
  { q: "IB school in Emirates Hills", expectTop: ["Dubai International Academy, Emirates Hills"] },
];

let fail = 0;
for (const c of cases) {
  const { needs, hits } = retrieve(SCHOOLS, c.q, c.prev || []);
  const names = hits.map(h => h.s.name);
  let ok = true;
  if (c.expectTop) ok = c.expectTop.every(n => names.slice(0, Math.max(c.expectTop.length, 3)).includes(n) || names.includes(n));
  if (c.expectCurriculum) ok = needs.curriculum === c.expectCurriculum && hits.every(h => h.s.curriculum.includes("CBSE"));
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.q}\n      -> ${hits.map(h => `${h.s.name} (${h.score})`).join(" | ")}`);
}
console.log(fail ? `\n${fail} failing` : "\nall retrieval checks pass");
process.exit(fail ? 1 : 0);
