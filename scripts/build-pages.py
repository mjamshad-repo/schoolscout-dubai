"""Builds the static, search-engine-friendly pages from schools.json:
  /schools/<slug>          one page per school: fees by grade, rating, location, contacts, nearby schools
  /schools/                every school A-Z
  /areas/<slug>            schools in an area and within 5 km of it
  /areas/                  all areas
  /curriculum/<slug>       every school teaching a curriculum, best rated first
  /find/<cur>-schools-in-<area>   curriculum + area combinations with 2 or more schools (e.g. CBSE schools in Al Qusais)
  /sitemap.xml, /site.css
Run after build-data.py (npm run web runs it). Pages are plain HTML, readable without JavaScript.
"""
import html, json, math, os, re, datetime
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = "https://www.dubaischoolfees.com"
S = json.load(open(os.path.join(ROOT, "schools.json")))
STEPS = ["ECC", "Pre-KG / FS1", "KG1 / FS2", "KG2 / Year 1"] + [f"Grade {g} / Year {g + 1}" for g in range(1, 13)]
RANK = {"Outstanding": 6, "Very Good": 5, "Good": 4, "Acceptable": 3, "Weak": 2, "Very Weak": 1}
TODAY = datetime.date.today().isoformat()
e = lambda s: html.escape(str(s if s is not None else ""), quote=True)
aed = lambda n: f"AED {n:,.0f}"
def slug(s): return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", s.lower())).strip("-")
def km(a, b):
    R = 6371; p = math.pi / 180
    x = math.sin((b["lat"] - a["lat"]) * p / 2) ** 2 + math.cos(a["lat"] * p) * math.cos(b["lat"] * p) * math.sin((b["lng"] - a["lng"]) * p / 2) ** 2
    return 2 * R * math.asin(math.sqrt(x))
has_pt = lambda s: isinstance(s.get("lat"), (int, float))
year_of = lambda s: (re.search(r"\((\d{4}-\d{2})\)", s.get("fee_source") or "") or [None, ""])[1]

def base_area(a):
    b = re.sub(r"\s*\(.*\)$", "", a or "").strip()
    b = re.sub(r"\s+(First|Second|Third|Fourth|Fifth|\d+)$", "", b).strip()
    return {"Muhaisanah": "Muhaisnah"}.get(b, b) or "Dubai"

CUR_LABEL = {"Indian (CBSE/ICSE)": "Indian (CBSE / ICSE)", "UAE Ministry of Education": "UAE Ministry of Education"}
CUR_SHORT = {"Indian (CBSE/ICSE)": "CBSE / ICSE", "UAE Ministry of Education": "UAE MoE"}
def curricula(s): return [c.strip() for c in s["curriculum"].split(" / ") if c.strip()] or ["Other"]

# ---------- slugs ----------
seen = defaultdict(int)
for s in sorted(S, key=lambda s: s["id"]):
    b = slug(s["name"]); seen[b] += 1
    s["slug"] = b if seen[b] == 1 else f"{b}-{s['id'].lower()}"
for s in S: s["barea"] = base_area(s["area"])
AREAS = defaultdict(list)
for s in S: AREAS[s["barea"]].append(s)
CURS = defaultdict(list)
for s in S:
    for c in curricula(s): CURS[c].append(s)
centroid = {a: {"lat": sum(x["lat"] for x in v if has_pt(x)) / max(1, sum(has_pt(x) for x in v)),
                "lng": sum(x["lng"] for x in v if has_pt(x)) / max(1, sum(has_pt(x) for x in v))}
            for a, v in AREAS.items() if any(has_pt(x) for x in v)}

def best(lst): return sorted(lst, key=lambda s: (-RANK.get(s["khda_rating"], 0), s["fee_min_aed"] if s["fee_min_aed"] is not None else 1e9, s["name"]))

# ---------- page shell ----------
LOGO = ('<svg class="logo" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="15" fill="var(--accent)"/>'
  '<path d="M32 15 7 26.5 32 38l25-11.5z" fill="var(--on-accent)"/><path d="M17 32v9.5c0 3.8 6.7 7.5 15 7.5s15-3.7 15-7.5V32l-15 7z" fill="var(--on-accent)" opacity=".86"/>'
  '<path d="M52.5 28v11" stroke="var(--sun)" stroke-width="3" stroke-linecap="round"/><circle cx="52.5" cy="41" r="3.2" fill="var(--sun)"/>'
  '<path d="M51 6.5l1.8 4.4 4.4 1.8-4.4 1.8L51 18.9l-1.8-4.4-4.4-1.8 4.4-1.8z" fill="var(--sun)"/></svg>')
ICON = open(os.path.join(ROOT, "favicon.svg")).read() if os.path.exists(os.path.join(ROOT, "favicon.svg")) else ""

def page(path, title, desc, body, crumbs, jsonld=None):
    url = SITE + path
    bc = {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": i + 1, "name": n, "item": SITE + h} for i, (n, h) in enumerate(crumbs)]}
    ld = [bc] + ([jsonld] if jsonld else [])
    crumb_html = " › ".join(f'<a href="{e(h)}">{e(n)}</a>' if i < len(crumbs) - 1 else e(n) for i, (n, h) in enumerate(crumbs))
    doc = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{e(title)}</title>
<meta name="description" content="{e(desc)}">
<link rel="canonical" href="{e(url)}">
<meta property="og:title" content="{e(title)}"><meta property="og:description" content="{e(desc)}"><meta property="og:url" content="{e(url)}"><meta property="og:type" content="website"><meta property="og:site_name" content="Dubai School Fees">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><meta name="theme-color" content="#0b6e6e">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=Source+Sans+3:wght@400;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="/site.css">
{"".join(f'<script type="application/ld+json">{json.dumps(x, ensure_ascii=False)}</script>' for x in ld)}
</head>
<body class="seo">
<header><div class="wrap">
  <a class="brand" href="/" aria-label="Dubai School Fees home">{LOGO}<span>Dubai School Fees</span><small>Dubai</small><span class="ai-pill">AI</span></a>
  <nav aria-label="Main"><a href="/#ask">Ask AI</a><a href="/schools">Schools</a><a href="/areas">Areas</a><a href="/curriculum">Curricula</a></nav>
</div></header>
<main class="wrap page">
<p class="crumbs">{crumb_html}</p>
{body}
<section class="cta panel"><div><strong>Not sure which school fits?</strong> Ask our AI in plain words, for example <em>"CBSE school near Al Qusais for KG1 under AED 20,000"</em>, and get a cited shortlist.</div><a class="btn" href="/#ask">Ask the AI</a></section>
</main>
<footer><div class="wrap foot"><span>Dubai School Fees · Information only. Fees are KHDA-approved annual tuition and exclude extras such as registration, transport, uniforms and books; confirm the final fee with the school. Data: KHDA open data. Not affiliated with KHDA or the Government of Dubai.</span>
<nav class="foot-links" aria-label="More"><a href="/schools">All schools</a><a href="/areas">Areas</a><a href="/curriculum">Curricula</a><a href="/terms.html">Terms</a><a href="/privacy.html">Privacy</a><a href="mailto:hello@dubaischoolfees.com">Contact</a></nav></div></footer>
</body>
</html>
'''
    out = os.path.join(ROOT, path.lstrip("/"))
    out = os.path.join(out, "index.html") if path in ("/schools", "/areas", "/curriculum") else out + ".html"
    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out, "w").write(doc)
    URLS.append(path)

URLS = []
def rating_chip(s):
    r = s["khda_rating"] or "Not rated"
    yr = f' <span class="muted">({e(str(s["rating_year"])[:9])})</span>' if s.get("rating_year") else ""
    return f'<span class="rating {e(r.replace(" ", "-").replace("(", "").replace(")", ""))}">{e(r)}</span>{yr}'
def fee_range(s):
    if s["fee_min_aed"] is None: return '<span class="muted">Fee not on file</span>'
    return f'{aed(s["fee_min_aed"])} – {aed(s["fee_max_aed"])}' if s["fee_max_aed"] != s["fee_min_aed"] else aed(s["fee_min_aed"])

def school_table(lst, dist_from=None, show_area=True):
    rows = []
    for s in lst:
        d = f'{km(dist_from, s):.1f} km' if dist_from and has_pt(s) else ""
        rows.append(f'<tr><td><a href="/schools/{s["slug"]}">{e(s["name"])}</a></td><td>{rating_chip(s)}</td><td>{fee_range(s)}</td>'
                    f'<td>{e(s["curriculum"])}</td>' + (f'<td>{e(s["area"])}{(" · " + d) if d else ""}</td>' if show_area else (f"<td>{d}</td>" if dist_from else "")) + "</tr>")
    head = "<tr><th>School</th><th>KHDA rating</th><th>Annual fee</th><th>Curriculum</th>" + ("<th>Area</th>" if show_area else ("<th>Distance</th>" if dist_from else "")) + "</tr>"
    return f'<div class="tablewrap"><table class="list"><thead>{head}</thead><tbody>{"".join(rows)}</tbody></table></div>'

# ---------- school pages ----------
for s in S:
    yr = year_of(s)
    fee_rows = "".join(f"<tr><td>{e(STEPS[i])}</td><td class=\"num\">{aed(v)}</td></tr>" for i, v in enumerate(s["fees_by_grade"] or []) if v)
    fees = (f'<h2>Fees by grade {e(yr)}</h2><p class="muted">KHDA-approved annual tuition{(" for " + e(yr)) if yr else ""}. '
            f'Excludes registration, re-enrolment, transport, uniforms, books and trips.{(" " + e(s["notes"].capitalize()) + ".") if s.get("notes") else ""}</p>'
            f'<div class="tablewrap"><table class="fees"><thead><tr><th>Grade</th><th class="num">Annual fee</th></tr></thead><tbody>{fee_rows}</tbody></table></div>') if fee_rows else \
           '<h2>Fees</h2><p>KHDA has not published grade-by-grade fees for this school. Contact the school for its current fees.</p>'
    near = sorted((x for x in S if x is not s and has_pt(x) and has_pt(s)), key=lambda x: km(s, x))[:6] if has_pt(s) else []
    same_cur = [x for x in best(CURS[curricula(s)[0]]) if x is not s and x["barea"] == s["barea"]][:6]
    links = []
    if s.get("website"): links.append(f'<a href="{e(s["website"])}" rel="nofollow noopener" target="_blank">School website</a>')
    if has_pt(s): links.append(f'<a href="https://www.google.com/maps/search/?api=1&query={s["lat"]},{s["lng"]}" rel="nofollow noopener" target="_blank">Map</a>')
    if s.get("inspection_report"): links.append(f'<a href="{e(s["inspection_report"])}" rel="nofollow noopener" target="_blank">KHDA inspection report</a>')
    if s.get("phone"): links.append(f'<a href="tel:+{e(s["phone"])}">Call +{e(s["phone"])}</a>')
    fee_txt = f'fees from {aed(s["fee_min_aed"])} to {aed(s["fee_max_aed"])} a year{(" for " + yr) if yr else ""}' if s["fee_min_aed"] is not None else "fees not published by KHDA"
    desc = f'{s["name"]}, {s["area"]}, Dubai: {s["curriculum"]} curriculum, KHDA rating {s["khda_rating"]}, {fee_txt}. Fees by grade, location and nearby schools.'
    body = f'''<h1>{e(s["name"])} fees {e(yr)}</h1>
<p class="lead">{e(s["curriculum"])} school in {e(s["area"])}, Dubai. {e(s["grades"]) if s.get("grades") and s["grades"] != "Not in source" else ""}</p>
<div class="facts panel">
  <div><span class="label">KHDA rating</span>{rating_chip(s)}</div>
  <div><span class="label">Annual fee</span>{fee_range(s)}</div>
  <div><span class="label">Curriculum</span>{e(s["curriculum"])}</div>
  <div><span class="label">Area</span><a href="/areas/{slug(s["barea"])}">{e(s["area"])}</a></div>
  {f'<div><span class="label">Founded</span>{e(s["established"])}</div>' if s.get("established") else ""}
</div>
<p class="links">{" · ".join(links)}</p>
{fees}
{f'<h2>Other {e(CUR_SHORT.get(curricula(s)[0], curricula(s)[0]))} schools in {e(s["barea"])}</h2>' + school_table(same_cur) if same_cur else ""}
{f'<h2>Nearest schools to {e(s["name"])}</h2>' + school_table(near, dist_from=s) if near else ""}
<p class="muted small">Source: {e(s.get("rating_source") or "KHDA")}; {e(s.get("fee_source") or "")}. Page updated {TODAY}.</p>'''
    ld = {"@context": "https://schema.org", "@type": "School", "name": s["name"], "url": SITE + f'/schools/{s["slug"]}',
          "address": {"@type": "PostalAddress", "addressLocality": s["area"], "addressRegion": "Dubai", "addressCountry": "AE"}}
    if has_pt(s): ld["geo"] = {"@type": "GeoCoordinates", "latitude": s["lat"], "longitude": s["lng"]}
    if s.get("website"): ld["sameAs"] = s["website"]
    if s.get("phone"): ld["telephone"] = "+" + s["phone"]
    page(f'/schools/{s["slug"]}', f'{s["name"]} fees {yr} · KHDA rating, fees by grade'.replace("  ", " "), desc, body,
         [("Home", "/"), ("Schools", "/schools"), (s["name"], f'/schools/{s["slug"]}')], ld)

# ---------- area pages ----------
for a, lst in sorted(AREAS.items()):
    c = centroid.get(a)
    inside = best(lst)
    nearby = sorted((x for x in S if x["barea"] != a and has_pt(x) and c and km(c, x) <= 5), key=lambda x: km(c, x)) if c else []
    curs = sorted({k for s in lst for k in curricula(s)})
    combos = [k for k in curs if sum(k in curricula(s) for s in lst) >= 2]
    body = f'''<h1>Private schools in {e(a)}, Dubai: fees and KHDA ratings</h1>
<p class="lead">{len(lst)} KHDA-registered private school{"s" if len(lst) != 1 else ""} in {e(a)}{f", and {len(nearby)} more within 5 km" if nearby else ""}. Curricula: {e(", ".join(CUR_LABEL.get(k, k) for k in curs))}.</p>
{('<p class="links">' + " · ".join(f'<a href="/find/{slug(CUR_SHORT.get(k, k))}-schools-in-{slug(a)}">{e(CUR_SHORT.get(k, k))} schools in {e(a)}</a>' for k in combos) + "</p>") if combos else ""}
<h2>Schools in {e(a)}</h2>
{school_table(inside, dist_from=c)}
{f"<h2>Schools within 5 km of {e(a)}</h2>" + school_table(nearby, dist_from=c) if nearby else ""}
<p class="muted small">Distances are straight lines from the centre of {e(a)}. Fees are KHDA-approved annual tuition. Page updated {TODAY}.</p>'''
    page(f"/areas/{slug(a)}", f"Schools in {a}, Dubai: fees 2026-27 and KHDA ratings", f"All {len(lst)} private schools in {a}, Dubai, plus schools within 5 km, with KHDA ratings, fees by grade and curriculum.",
         body, [("Home", "/"), ("Areas", "/areas"), (a, f"/areas/{slug(a)}")])
    for k in combos:
        sub = best([s for s in lst if k in curricula(s)])
        short = CUR_SHORT.get(k, k)
        body = f'''<h1>{e(short)} schools in {e(a)}, Dubai: fees and ratings</h1>
<p class="lead">{len(sub)} {e(CUR_LABEL.get(k, k))} schools in {e(a)}, best KHDA rating first. See <a href="/areas/{slug(a)}">all schools in {e(a)}</a> or <a href="/curriculum/{slug(k)}">all {e(short)} schools in Dubai</a>.</p>
{school_table(sub, dist_from=c)}
<p class="muted small">Fees are KHDA-approved annual tuition for the lowest to highest grade. Page updated {TODAY}.</p>'''
        page(f"/find/{slug(short)}-schools-in-{slug(a)}", f"{short} schools in {a}, Dubai: fees 2026-27", f"{len(sub)} {short} schools in {a}, Dubai with KHDA ratings and fees by grade.",
             body, [("Home", "/"), ("Areas", "/areas"), (a, f"/areas/{slug(a)}"), (f"{short} schools", f"/find/{slug(short)}-schools-in-{slug(a)}")])

# ---------- curriculum pages ----------
for k, lst in sorted(CURS.items()):
    short = CUR_SHORT.get(k, k); lst = best(lst)
    fees = [s["fee_min_aed"] for s in lst if s["fee_min_aed"] is not None]
    body = f'''<h1>{e(CUR_LABEL.get(k, k))} schools in Dubai: fees and KHDA ratings</h1>
<p class="lead">{len(lst)} private schools in Dubai teach the {e(CUR_LABEL.get(k, k))} curriculum{f", with annual fees starting from {aed(min(fees))}" if fees else ""}. Best KHDA rating first.</p>
{school_table(lst)}
<p class="muted small">Fees are KHDA-approved annual tuition for the lowest to highest grade. Page updated {TODAY}.</p>'''
    page(f"/curriculum/{slug(k)}", f"{short} schools in Dubai: fees 2026-27 and KHDA ratings", f"All {len(lst)} {short} schools in Dubai with KHDA ratings, fees by grade and location.",
         body, [("Home", "/"), ("Curricula", "/curriculum"), (short, f"/curriculum/{slug(k)}")])

# ---------- index pages ----------
page("/schools", "All private schools in Dubai: fees 2026-27 and KHDA ratings", f"All {len(S)} KHDA-registered private schools in Dubai with fees by grade, KHDA ratings, curriculum and area.",
     f'<h1>All {len(S)} private schools in Dubai</h1><p class="lead">Every KHDA-registered private school, A to Z. Open a school for its fees by grade, rating, location and nearby schools.</p>'
     + school_table(sorted(S, key=lambda s: s["name"].lower())), [("Home", "/"), ("Schools", "/schools")])
page("/areas", "Dubai schools by area: fees and KHDA ratings", "Find private schools by area in Dubai, with fees by grade and KHDA ratings.",
     '<h1>Dubai schools by area</h1><p class="lead">Pick an area to see its schools and the schools within 5 km.</p><ul class="cols">'
     + "".join(f'<li><a href="/areas/{slug(a)}">{e(a)}</a> <span class="muted">({len(v)})</span></li>' for a, v in sorted(AREAS.items())) + "</ul>",
     [("Home", "/"), ("Areas", "/areas")])
page("/curriculum", "Dubai schools by curriculum: fees and KHDA ratings", "British, American, IB, CBSE, French and more: Dubai private schools by curriculum with fees and ratings.",
     '<h1>Dubai schools by curriculum</h1><ul class="cols">'
     + "".join(f'<li><a href="/curriculum/{slug(k)}">{e(CUR_LABEL.get(k, k))}</a> <span class="muted">({len(v)})</span></li>' for k, v in sorted(CURS.items(), key=lambda kv: -len(kv[1]))) + "</ul>",
     [("Home", "/"), ("Curricula", "/curriculum")])

# ---------- shared stylesheet and sitemap ----------
css = open(os.path.join(ROOT, "web/base.css")).read() + open(os.path.join(ROOT, "web/extra.css")).read() + """
/* static pages */
.page .rating{display:inline-block;color:#fff;padding:1px 9px;border-radius:999px;font-size:.82rem;font-weight:600;line-height:1.5}
.page .lead a,.page .facts a{color:var(--accent);font-weight:600}
.page{padding-block:8px 40px}.crumbs{font-size:.85rem;color:var(--muted);margin:14px 0 4px}.crumbs a{color:var(--accent);text-decoration:none}
.page h1{font:700 clamp(1.5rem,3.2vw,2.2rem)/1.15 var(--font-display);margin:6px 0 8px}.page h2{font:700 1.2rem var(--font-display);margin:28px 0 10px}
.lead{color:var(--muted);max-width:75ch;margin:0 0 14px}.muted{color:var(--muted)}.small{font-size:.85rem;margin-top:22px}
.panel{background:var(--surface);border:1px solid var(--line);border-radius:14px}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;padding:16px;margin:12px 0}
.facts .label{display:block;font:600 .7rem var(--font-data);letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:3px}
.page .links a,.page td a,.cols a{color:var(--accent);font-weight:600;text-decoration:none}.page .links a:hover,.page td a:hover{text-decoration:underline}
.page table{border-collapse:collapse;width:100%;background:var(--surface);border:1px solid var(--line);border-radius:12px;font-size:.93rem}
.page th,.page td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top}.page th{font:600 .72rem var(--font-data);letter-spacing:.05em;text-transform:uppercase;color:var(--muted)}
.page td.num,.page th.num{text-align:right;font-variant-numeric:tabular-nums}.page table.fees{max-width:520px}
.page .tablewrap{overflow-x:auto}
.cols{columns:3 220px;padding:0;list-style:none;margin:8px 0}.cols li{padding:4px 0;break-inside:avoid}
.cta{display:flex;gap:16px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:16px;margin-top:32px}
.btn{background:var(--accent);color:var(--accent-ink);padding:10px 16px;border-radius:10px;font-weight:600;text-decoration:none;white-space:nowrap}
@media (max-width:640px){
  .page table.list thead{display:none}.page table.list,.page table.list tbody,.page table.list tr,.page table.list td{display:block;width:100%}
  .page table.list{border:0;background:none}.page table.list tr{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:8px 12px;margin-bottom:10px}
  .page table.list td{border:0;padding:2px 0}.page table.list td:first-child{font-size:1.02rem}
}
"""
open(os.path.join(ROOT, "site.css"), "w").write(css)
urls = ["/", "/terms.html", "/privacy.html"] + URLS
sm = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
sm += [f"<url><loc>{e(SITE + u)}</loc><lastmod>{TODAY}</lastmod></url>" for u in urls]
open(os.path.join(ROOT, "sitemap.xml"), "w").write("\n".join(sm + ["</urlset>"]) + "\n")
print(f"pages: {len(URLS)} ({len(S)} schools, {len(AREAS)} areas, {len(CURS)} curricula) + sitemap.xml")
