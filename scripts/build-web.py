"""Builds both front ends from web/app.src.html:
  index.html          the public website (Vercel); answers come from /api/ask
  dist/artifact.html  the Claude artifact; retrieval and prompt are inlined, Claude answers in the page
Run after build-data.py: python3 scripts/build-web.py
"""
import json, os, re
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rd = lambda p: open(os.path.join(ROOT, p)).read()
css = rd("web/base.css") + rd("web/extra.css")
body = rd("web/app.src.html")
HEAD = '''<title>SchoolScout Dubai</title>
<meta name="description" content="Shortlist Dubai private schools by budget, curriculum, KHDA rating and distance. Ask in plain words and get a cited answer.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=Source+Sans+3:wght@400;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<script src="https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.0.6/purify.min.js"></script>
'''
def strip_exports(js): return re.sub(r"^export\s+", "", js, flags=re.M)

# website
web = body.replace('"__MODE__"', '"web"').replace("__DATA__", "[]").replace("/*__RETRIEVAL__*/", "")
web_html = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
  '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
  '<meta property="og:title" content="SchoolScout Dubai">\n<meta property="og:description" content="Find a Dubai school that fits your family, with sources for every fee and rating.">\n'
  + HEAD + "<style>\nhtml{color-scheme:light}body{margin:0}[hidden]{display:none!important}img{max-width:100%}\n"
  ":root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}\n" + css + "</style>\n</head>\n<body>\n" + web + "\n</body>\n</html>\n")
open(os.path.join(ROOT, "index.html"), "w").write(web_html)

# artifact
data = json.load(open(os.path.join(ROOT, "schools.json")))
inline = strip_exports(rd("api/_retrieval.js")) + "\n" + strip_exports(rd("api/_prompt.js"))
art = body.replace('"__MODE__"', '"artifact"').replace("__DATA__", json.dumps(data, ensure_ascii=False, separators=(",", ":"))).replace("/*__RETRIEVAL__*/", inline)
os.makedirs(os.path.join(ROOT, "dist"), exist_ok=True)
open(os.path.join(ROOT, "dist", "artifact.html"), "w").write(
    HEAD.replace("<title>", '<meta name="claude:viewport-fit-sides" content="cover">\n<title>', 1) + "<style>\n" + css + "</style>\n" + art)
print("index.html", len(web_html)//1024, "KB; dist/artifact.html", os.path.getsize(os.path.join(ROOT, "dist", "artifact.html"))//1024, "KB")
