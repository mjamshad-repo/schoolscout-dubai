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


# Optional manual fee overrides, keyed by exact KHDA name: (lowest, highest, grades, source, note).
# Normally empty: fees come from KHDA's open data (data/khda_fees_by_grade.txt).
FEES = {}

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

STEPS = ["ECC", "Pre-KG / FS1", "KG1 / FS2", "KG2 / Year 1"] + [f"Grade {g} / Year {g+1}" for g in range(1, 13)]
YEARS = {25: "2025-26", 26: "2026-27", 27: "2027-28"}
KHDA_FEES = {}
for line in open(os.path.join(ROOT, "data", "khda_fees_by_grade.txt")):
    if not line.strip() or line.startswith("#"): continue
    cid, yr, ncur, mx, steps = line.strip().split("|")
    vals = [int(v) if v else None for v in steps.split(",")]
    if any(v is not None for v in vals):
        KHDA_FEES[int(cid)] = {"year": YEARS.get(int(yr), yr), "steps": vals, "max": int(mx), "multi": int(ncur) > 1}

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
    k = KHDA_FEES.get(r.get("educationcenterid"))
    steps = None
    if k:
        steps = k["steps"]
        present = [i for i, v in enumerate(steps) if v is not None]
        lo, hi = min(v for v in steps if v is not None), k["max"]
        grades = f"{STEPS[present[0]]} to {STEPS[present[-1]]}"
        fsrc = f"KHDA open data, fees by grade ({k['year']})"
        note = "fees differ by curriculum or section; lowest shown per grade" if k["multi"] else ""
        if k["year"] != "2026-27": note = (note + "; " if note else "") + f"latest KHDA fees are for {k['year']}"
    est = r.get("establishedon")
    out.append({
        "name": clean_name(r["name_eng"]),
        "name_ar": r.get("name_ar") or "",
        "curriculum": curriculum(r.get("curriculumen")),
        "khda_rating": rating(r.get("overallperformanceen")),
        "rating_year": r.get("inspectionyear") or "",
        "area": title_area(r.get("areaen")),
        "lat": coords(r.get("lat"), r.get("long"))[0], "lng": coords(r.get("lat"), r.get("long"))[1],
        "fee_min_aed": lo, "fee_max_aed": hi, "fee_band": band(lo, hi), "fees_by_grade": steps,
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
print(f"KHDA per-grade fees: {sum(s['fees_by_grade'] is not None for s in out)}")
print(f"no valid map location: {sum(s['lat'] is None for s in out)}")
print(f"{len(out)} schools; with fees: {withfee} (stale {sum(s['stale'] for s in out)}); register {register_date}")
