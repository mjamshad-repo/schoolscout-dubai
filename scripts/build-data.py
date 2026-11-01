"""Builds the SchoolScout knowledge base from KHDA's school register plus published fee lists.

Inputs
  data/khda_register_*.xlsx   KHDA private-schools register export (newest file is used)
  FEES below                  published annual fees, keyed by the school's exact KHDA name
Outputs
  data/schools.csv, schools.json (front end), api/_schools.js (server)

Run: python3 scripts/build-data.py     (needs openpyxl: pip install openpyxl)
"""
import csv, glob, json, os, re
import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

KT   = "Khaleej Times, 15 Jul 2026 (2026-27 fees; fees frozen for 2026-27)"
GN26 = "Gulf News, 6 Aug 2026 (2026-27 fees)"
GN22 = "Gulf News, 6 Sep 2022 (older fees; verify the current fee)"

# exact KHDA name: (lowest fee, highest fee, grades, fee source, note)
FEES = {
 "Dubai International Academy L.L.C": (44979, 79696, "", KT, ""),
 "Deira International School": (44616, 89889, "", KT, ""),
 "Jumeirah English Speaking School": (54129, 65097, "", KT, ""),
 "Kings School Al Barsha L.L.C": (57999, 105873, "", KT, ""),
 "Repton School": (57178, 102753, "", KT, ""),
 "Jumeirah English Speaking School (Br)": (54129, 104544, "", KT, ""),
 "Kings School Dubai L.L.C": (47179, 71801, "Primary", KT, ""),
 "Dubai English Speaking School - (College)": (84326, 90633, "Secondary", KT, ""),
 "Dubai English Speaking School": (43084, 53320, "Primary", KT, ""),
 "Dubai College": (97415, 110305, "Secondary", KT, ""),
 "GEMS Jumeira Primary School - Dubai Branch": (44200, 55714, "Primary", KT, ""),
 "GEMS Wellington International School - Dubai Branch": (47527, 103399, "", KT, ""),
 "Horizons English School L.L.C": (43849, 58825, "Primary", KT, ""),
 "Jumeirah College": (78496, 98681, "Secondary", KT, ""),
 "Nord Anglia International School L.L.C": (69625, 105288, "", KT, ""),
 "Safa Community School LLC": (54437, 89440, "", KT, ""),
 "Victory Heights Primary School L.L.C": (40138, 54733, "Primary", KT, ""),
 "Dubai British School": (53027, 79541, "", KT, ""),
 "Dubai British School Jumeirah Park": (65719, 111799, "", KT, ""),
 "GEMS Dubai American Academy - Dubai Branch": (66185, 93300, "", KT, ""),
 "GEMS Modern Academy": (38246, 73876, "", KT, ""),
 "Lycee Francais International Georges Pompidou School Oud Metha": (29488, 62363, "", KT, "published range may cover both Lycee Pompidou Oud Metha campuses"),
 "Delhi Private School L.L.C": (11389, 15842, "KG1-Grade 12", GN26, ""),
 "The Winchester School - DUBAI BRANCH": (14950, 33352, "FS1-Year 13", GN26, ""),
 "JSS International School L.L.C": (17214, 41513, "KG1-Grade 12", GN26, ""),
 "GEMS New Millennium School L.L.C": (23143, 33557, "", GN26, "fee range is for the Indian curriculum section"),
 "Credence High School L.L.C": (17673, 29486, "KG1-Grade 12", GN26, ""),
 "GEMS Our Own Indian School": (7389, 15336, "KG1-Grade 12", GN26, ""),
 "JSS Private School L.L.C": (12731, 26375, "KG1-Grade 12", GN26, ""),
 "GEMS Our Own English High School": (7858, 16549, "KG1-Grade 12", GN26, ""),
 "The Indian High School": (8625, 13815, "Grade 5-Grade 12", GN26, ""),
 "GEMS Founders School - Dubai Branch": (24749, 37124, "FS1-Year 13", GN26, ""),
 "The Millenium School": (18308, 26906, "KG1-Grade 12", GN26, ""),
 "Ambassador School": (21123, 42298, "Pre-primary-Grade 12", GN22, ""),
 "Woodlem Park School L.L.C": (12000, 23000, "Pre-primary-Grade 10", GN22, ""),
}

def clean_name(n):
    n = re.sub(r"\s*(L\.?L\.?C\.?|LLC)\b\.?", "", n, flags=re.I).strip(" -,")
    n = re.sub(r"DUBAI BRANCH", "Dubai Branch", n)
    return n if not n.isupper() else n.title()

def title_area(a):
    a = (a or "").strip()
    return " ".join(w if w.isupper() and len(w) <= 3 else w.capitalize() for w in a.lower().split()).replace("Al ", "Al ") if a.isupper() else a

CUR_MAP = [("Ministry of Education", "UAE Ministry of Education"), ("International Baccalaureate", "IB"),
           ("UK/IB", "British / IB"), ("UK", "British"), ("SABIS (UK/US)", "SABIS (UK/US)")]

def curriculum(raw):
    parts = []
    for p in re.split(r"\s+-\s+", raw or ""):
        p = re.sub(r"\s*\(.*$", "", p).strip()
        if p.startswith("UK/IB"): p = "British / IB"
        elif p.startswith("UK/BTEC"): p = "British / BTEC"
        elif p.startswith("UK"): p = "British"
        elif p.startswith("International Baccalaureate") or p == "IB": p = "IB"
        elif p == "Ministry of Education": p = "UAE Ministry of Education"
        elif p == "Indian" or p.startswith("Indian/"): p = "Indian (CBSE/ICSE)"
        for t in p.split(" / "):
            if t and t not in parts: parts.append(t)
    return " / ".join(parts)

def rating(raw):
    r = (raw or "").strip()
    if r.lower().startswith("not inspected due"): return "Not inspected (COVID-19)"
    if r.lower().startswith("not inspected"): return "Not yet inspected"
    return {"very good": "Very Good", "very weak": "Very Weak"}.get(r.lower(), r)

def site(w):
    w = (w or "").strip()
    if not w or "." not in w: return ""
    return w if w.startswith("http") else "https://" + w.rstrip("/")

def coords(lat, lng):
    """KHDA coordinates have some zeros, swapped pairs and missing decimal points; repair or drop them."""
    in_dubai = lambda a, b: 24.6 < a < 25.5 and 54.8 < b < 55.8
    try: lat, lng = float(lat), float(lng)
    except (TypeError, ValueError): return None, None
    for a, b in ((lat, lng), (lng, lat)):
        for k in range(0, 8):
            if in_dubai(a / 10**k, b / 10**k): return round(a / 10**k, 5), round(b / 10**k, 5)
    return None, None

def band(lo, hi):
    if lo is None: return "Fee not on file"
    m = (lo + hi) / 2
    return ("Budget (avg under AED 20k)" if m < 20000 else "Mid (AED 20k-45k)" if m < 45000
            else "Premium (AED 45k-75k)" if m < 75000 else "Ultra-premium (AED 75k+)")

src = sorted(glob.glob(os.path.join(ROOT, "data", "khda_register_*.xlsx")))[-1]
wb = openpyxl.load_workbook(src, read_only=True)
rows = list(wb.active.iter_rows(values_only=True))
H = rows[0]
reg = [dict(zip(H, r)) for r in rows[1:] if r[H.index("name_eng")]]
register_date = os.path.basename(src)[len("khda_register_"):-5]

unused = set(FEES)
out = []
for r in sorted(reg, key=lambda r: r["name_eng"].lower()):
    f = FEES.get(r["name_eng"]); unused.discard(r["name_eng"])
    lo, hi, grades, fsrc, note = f if f else (None, None, "", "", "")
    est = r.get("establishedon")
    out.append({
        "name": clean_name(r["name_eng"]),
        "name_ar": r.get("name_ar") or "",
        "curriculum": curriculum(r.get("curriculumen")),
        "khda_rating": rating(r.get("overallperformanceen")),
        "rating_year": r.get("inspectionyear") or "",
        "area": title_area(r.get("areaen")),
        "lat": coords(r.get("lat"), r.get("long"))[0], "lng": coords(r.get("lat"), r.get("long"))[1],
        "fee_min_aed": lo, "fee_max_aed": hi, "fee_band": band(lo, hi),
        "fee_source": fsrc, "stale": "2022" in fsrc,
        "grades": grades or "Not in source",
        "phone": str(r.get("telephone") or ""), "email": r.get("email") or "",
        "website": site(r.get("web_address")),
        "established": est.year if hasattr(est, "year") else "",
        "inspection_report": (r.get("inspectionreportpdflinken") or "").replace("http://", "https://"),
        "khda_id": r.get("educationcenterid"),
        "rating_source": f"KHDA private schools register (exported {register_date})",
        "notes": note,
    })
for i, s in enumerate(out, 1):
    s["id"] = f"SCH{i:03d}"
out = [{"id": s.pop("id"), **s} for s in out]

if unused: raise SystemExit(f"Fee records with no KHDA match: {sorted(unused)}")

os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
with open(os.path.join(ROOT, "data", "schools.csv"), "w", newline="") as fh:
    w = csv.DictWriter(fh, fieldnames=list(out[0])); w.writeheader(); w.writerows(out)
js = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
open(os.path.join(ROOT, "schools.json"), "w").write(js)
open(os.path.join(ROOT, "api", "_schools.js"), "w").write("// Generated by scripts/build-data.py. Do not edit by hand.\nexport const SCHOOLS = " + js + ";\n")
withfee = sum(s["fee_min_aed"] is not None for s in out)
print(f"no valid map location: {sum(s['lat'] is None for s in out)}")
print(f"{len(out)} schools; with fees: {withfee} (stale {sum(s['stale'] for s in out)}); register {register_date}")
