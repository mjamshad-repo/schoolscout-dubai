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
FAVICON = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="15" fill="#0b6e6e"/>'
  '<path d="M32 15 7 26.5 32 38l25-11.5z" fill="#fff"/><path d="M17 32v9.5c0 3.8 6.7 7.5 15 7.5s15-3.7 15-7.5V32l-15 7z" fill="#fff" opacity=".86"/>'
  '<path d="M52.5 28v11" stroke="#ffc94a" stroke-width="3" stroke-linecap="round"/><circle cx="52.5" cy="41" r="3.2" fill="#ffc94a"/>'
  '<path d="M51 6.5l1.8 4.4 4.4 1.8-4.4 1.8L51 18.9l-1.8-4.4-4.4-1.8 4.4-1.8z" fill="#ffc94a"/></svg>')
import urllib.parse
open(os.path.join(ROOT, "favicon.svg"), "w").write(FAVICON)
ICON_TAGS = '<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,' + urllib.parse.quote(FAVICON) + '">\n<meta name="theme-color" content="#0b6e6e">\n'
# Real icon files for the website (Google Search can't read an icon embedded in the page); the artifact keeps the embedded one.
WEB_ICONS = ('<link rel="icon" href="/favicon.ico" sizes="48x48">\n<link rel="icon" type="image/svg+xml" href="/favicon.svg">\n'
  '<link rel="apple-touch-icon" href="/apple-touch-icon.png">\n<link rel="manifest" href="/site.webmanifest">\n')
HEAD = ICON_TAGS + '''<title>Dubai School Fees · Dubai school fees, KHDA ratings and AI shortlist</title>
<meta name="description" content="Official KHDA-approved fees by grade for Dubai private schools, with ratings, distance from your area and a free AI shortlist.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=Source+Sans+3:wght@400;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<script src="https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.0.6/purify.min.js"></script>
'''
WEB_HEAD = HEAD.replace(ICON_TAGS, WEB_ICONS + '<meta name="theme-color" content="#0b6e6e">\n', 1)
def strip_exports(js): return re.sub(r"^export\s+", "", js, flags=re.M)

# website
web = body.replace('"__MODE__"', '"web"').replace("__DATA__", "[]").replace("/*__RETRIEVAL__*/", "")
web_html = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
  '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
  '<meta property="og:title" content="Dubai School Fees">\n<meta property="og:description" content="Dubai school fees by grade, KHDA ratings and distance, with a free AI shortlist.">\n<meta property="og:url" content="https://www.dubaischoolfees.com/">\n<meta property="og:type" content="website">\n<link rel="canonical" href="https://www.dubaischoolfees.com/">\n'
  + WEB_HEAD + "<style>\nhtml{color-scheme:light}body{margin:0}[hidden]{display:none!important}img{max-width:100%}\n"
  ":root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}\n" + css + "</style>\n</head>\n<body>\n" + web + "\n</body>\n</html>\n")
open(os.path.join(ROOT, "index.html"), "w").write(web_html)

# artifact
data = json.load(open(os.path.join(ROOT, "schools.json")))
inline = strip_exports(rd("api/_retrieval.js")) + "\n" + strip_exports(rd("api/_prompt.js"))
art = body.replace('"__MODE__"', '"artifact"').replace("__DATA__", json.dumps(data, ensure_ascii=False, separators=(",", ":"))).replace("/*__RETRIEVAL__*/", inline)
os.makedirs(os.path.join(ROOT, "dist"), exist_ok=True)
open(os.path.join(ROOT, "dist", "artifact.html"), "w").write(
    HEAD.replace("<title>", '<meta name="claude:viewport-fit-sides" content="cover">\n<title>', 1) + "<style>\n" + css + "</style>\n" + art)

# legal pages (terms.html, privacy.html) from web/legal/*.md
def md2html(t):
    out=[];lst=False
    inl=lambda s: re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<em>\1</em>", s)))
    for line in t.splitlines():
        if line.startswith("- "):
            if not lst: out.append("<ul>"); lst=True
            out.append("<li>"+inl(line[2:])+"</li>"); continue
        if lst: out.append("</ul>"); lst=False
        if line.startswith("## "): out.append("<h2>"+inl(line[3:])+"</h2>")
        elif line.startswith("# "): out.append("<h1>"+inl(line[2:])+"</h1>")
        elif line.strip(): out.append("<p>"+inl(line)+"</p>")
    if lst: out.append("</ul>")
    return "\n".join(out)
LEGAL_CSS = """:root{--bg:#f7f5f0;--ink:#17201f;--muted:#5b6563;--accent:#0b6e6e;--line:#e2ddd2;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#121716;--ink:#e9eeec;--muted:#a4aeab;--accent:#5cc7c0;--line:#2a3331}}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 'Source Sans 3',system-ui,sans-serif}
main{max-width:720px;margin:0 auto;padding:28px 16px 48px}
h1{font:700 2rem/1.2 'Bricolage Grotesque',system-ui,sans-serif;margin:16px 0 4px}h2{font:700 1.15rem 'Bricolage Grotesque',system-ui,sans-serif;margin:28px 0 6px}
a{color:var(--accent)}em{color:var(--muted)}.back{font-weight:600;text-decoration:none}li{margin:4px 0}
footer{border-top:1px solid var(--line);margin-top:32px;padding-top:14px;color:var(--muted);font-size:.85rem}"""
for name,title in (("terms","Terms of use"),("privacy","Privacy policy")):
    page=('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n'
      + WEB_ICONS + '<meta name="theme-color" content="#0b6e6e">\n' + f'<title>{title} · Dubai School Fees</title>\n<link rel="canonical" href="https://www.dubaischoolfees.com/{name}.html">\n'
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700&family=Source+Sans+3:wght@400;600&display=swap">\n'
      f"<style>{LEGAL_CSS}</style>\n</head>\n<body>\n<main>\n<a class=\"back\" href=\"/\">← Dubai School Fees</a>\n"
      + md2html(rd(f"web/legal/{name}.md")) + '\n<footer>Dubai School Fees · Information only · Not affiliated with KHDA or the Government of Dubai.</footer>\n</main>\n</body>\n</html>\n')
    open(os.path.join(ROOT, f"{name}.html"), "w").write(page)
print("index.html", len(web_html)//1024, "KB; dist/artifact.html", os.path.getsize(os.path.join(ROOT, "dist", "artifact.html"))//1024, "KB")
