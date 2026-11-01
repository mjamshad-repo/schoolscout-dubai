"""Source of truth for the SchoolScout knowledge base.

Edit the SCHOOLS list (or replace it with a loader for the KHDA open dataset), then run:
    python3 scripts/build-data.py
It writes data/schools.csv, schools.json (front end) and api/_schools.js (server).
"""
import csv, json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

KT   = "Khaleej Times, 15 Jul 2026 (2026-27 fees; fees frozen for 2026-27)"
KTR  = "Khaleej Times, 15 Jul 2026 (list of 23 Outstanding schools)"
GN26 = "Gulf News, 6 Aug 2026 (KHDA rating and 2026-27 fees)"
GN22 = "Gulf News, 6 Sep 2022 (rating and fees at that date; verify current values)"
GK   = "area: general knowledge, not from the cited source"

# name, curriculum, rating, fee_min, fee_max, area, grades, rating_source, fee_source, notes
SCHOOLS = [
 # ---- Outstanding (all 22 schools with fees in the Khaleej Times July 2026 table) ----
 ("Dubai International Academy, Emirates Hills","IB","Outstanding",44979,79696,"Emirates Hills","",KTR,KT,GK),
 ("Deira International School","IB / British","Outstanding",44616,89889,"Dubai Festival City","",KTR,KT,GK),
 ("Jumeirah English Speaking School, Jumeirah","British","Outstanding",54129,65097,"Jumeirah","",KTR,KT,GK),
 ("Kings' School Al Barsha","British","Outstanding",57999,105873,"Al Barsha South","",KTR,KT,GK),
 ("Repton School Dubai","British","Outstanding",57178,102753,"Nad Al Sheba","",KTR,KT,GK),
 ("Jumeirah English Speaking School, Arabian Ranches","British / IB","Outstanding",54129,104544,"Arabian Ranches","",KTR,KT,GK),
 ("Kings' School Dubai","British","Outstanding",47179,71801,"Umm Suqeim","",KTR,KT,GK),
 ("Dubai English Speaking College","British","Outstanding",84326,90633,"Dubai Academic City","Secondary",KTR,KT,GK),
 ("Dubai English Speaking School","British","Outstanding",43084,53320,"Oud Metha","Primary",KTR,KT,GK),
 ("Dubai College","British","Outstanding",97415,110305,"Al Sufouh","Secondary",KTR,KT,GK),
 ("GEMS Jumeirah Primary School","British","Outstanding",44200,55714,"Al Safa","Primary",KTR,KT,GK),
 ("GEMS Wellington International School","British / IB","Outstanding",47527,103399,"Al Sufouh","",KTR,KT,GK),
 ("Horizons English School","British","Outstanding",43849,58825,"Al Safa","Primary",KTR,KT,GK),
 ("Jumeirah College","British","Outstanding",78496,98681,"Al Safa","Secondary",KTR,KT,GK),
 ("Nord Anglia International School Dubai","British / IB","Outstanding",69625,105288,"Al Barsha South","",KTR,KT,GK),
 ("Safa Community School","British / IB","Outstanding",54437,89440,"Al Barsha South","",KTR,KT,GK),
 ("Victory Heights Primary School","British","Outstanding",40138,54733,"Victory Heights (Dubai Sports City)","Primary",KTR,KT,GK),
 ("Dubai British School Emirates Hills","British","Outstanding",53027,79541,"Emirates Hills","",KTR,KT,GK),
 ("Dubai British School Jumeirah Park","British","Outstanding",65719,111799,"Jumeirah Park","",KTR,KT,GK),
 ("GEMS Dubai American Academy","American","Outstanding",66185,93300,"Al Barsha","",KTR,KT,GK),
 ("GEMS Modern Academy","Indian (CBSE) / IB","Outstanding",38246,73876,"Nad Al Sheba","",KTR,KT,GK),
 ("Lycée Français International Georges Pompidou","French","Outstanding",29488,62363,"Oud Metha","",KTR,KT,GK),
 # ---- Very Good, current figures (Gulf News, August 2026) ----
 ("Delhi Private School","Indian (CBSE)","Very Good",11389,15842,"Jebel Ali First","KG1-Grade 12",GN26,GN26,""),
 ("The Winchester School","British","Very Good",14950,33352,"Jebel Ali First","FS1-Year 13",GN26,GN26,""),
 ("JSS International School","Indian (CBSE)","Very Good",17214,41513,"Jumeirah Village Circle","KG1-Grade 12",GN26,GN26,""),
 ("GEMS New Millennium School","Indian (CBSE) / British","Very Good",23143,33557,"Al Khail","",GN26,GN26,"fee range is for the Indian curriculum section"),
 ("Credence High School","Indian (CBSE)","Very Good",17673,29486,"Al Quoz First","KG1-Grade 12",GN26,GN26,""),
 ("GEMS Our Own Indian School","Indian (CBSE)","Very Good",7389,15336,"Al Quoz First","KG1-Grade 12",GN26,GN26,""),
 ("JSS Private School","Indian (CBSE)","Very Good",12731,26375,"Al Wasl","KG1-Grade 12",GN26,GN26,""),
 ("GEMS Our Own English High School","Indian (CBSE)","Very Good",7858,16549,"Al Warqa First","KG1-Grade 12",GN26,GN26,""),
 ("The Indian High School","Indian (CBSE)","Very Good",8625,13815,"Oud Metha","Grade 5-Grade 12",GN26,GN26,""),
 ("GEMS Founders School - Al Barsha","British","Very Good",24749,37124,"Al Barsha Second","FS1-Year 13",GN26,GN26,""),
 ("The Millennium School","Indian (CBSE)","Very Good",18308,26906,"Al Qusais First","KG1-Grade 12",GN26,GN26,""),
 # ---- older figures, kept and flagged ----
 ("Ambassador School","Indian (CBSE)","Very Good",21123,42298,"Mankhool","Pre-primary-Grade 12",GN22,GN22,""),
 ("Woodlem Park School","Indian (CBSE)","Good",12000,23000,"Al Qusais First","Pre-primary-Grade 10",GN22,GN22,""),
 ("MSB Private School","British","Very Good",9606,22500,"Al Nahda Second","FS1-Year 12",GN22,GN22,""),
]

def band(lo, hi):
    m = (lo + hi) / 2
    return ("Budget (avg under AED 20k)" if m < 20000 else "Mid (AED 20k-45k)" if m < 45000
            else "Premium (AED 45k-75k)" if m < 75000 else "Ultra-premium (AED 75k+)")

rows = []
for i, (n, c, r, lo, hi, a, g, rs, fs, note) in enumerate(SCHOOLS, 1):
    rows.append(dict(id=f"SCH{i:03d}", name=n, curriculum=c, khda_rating=r, fee_min_aed=lo, fee_max_aed=hi,
                     fee_band=band(lo, hi), area=a, grades=g or "Not in source", rating_source=rs,
                     fee_source=fs, stale=("2022" in fs), notes=note))

os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
with open(os.path.join(ROOT, "data", "schools.csv"), "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)
js = json.dumps(rows, ensure_ascii=False, indent=1)
open(os.path.join(ROOT, "schools.json"), "w").write(js)
open(os.path.join(ROOT, "api", "_schools.js"), "w").write("// Generated by scripts/build-data.py. Do not edit by hand.\nexport const SCHOOLS = " + js + ";\n")
print(f"{len(rows)} schools; stale: {sum(r['stale'] for r in rows)}")
