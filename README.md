# SchoolScout Dubai

Ask in plain words, get a cited shortlist of Dubai private schools. A retrieval-augmented (RAG) assistant over KHDA ratings, fees, curriculum and area.

- **All 236 KHDA-registered private schools** from KHDA's register (rating with inspection year, curriculum, area, map location, phone, website, inspection report).
- **Fees for 35 schools** from published 2026-27 lists (2 older 2022 figures, flagged). Others show "Fee not on file".
- **Distance search**: "near Sports City" is measured from KHDA map points (straight line).
- **Views:** Ask (AI shortlist) · Explore (filters) · Compare (side by side) · About & sources.
- **AI providers:** Google Gemini (free tier), Groq (free tier) or Claude (paid). One environment variable switches between them.
- **No dependencies.** Plain HTML + one Node serverless function.

## How it works

```
Browser ──POST /api/ask {question, history}──▶ api/ask.js
                                               1. Understand: budget, curriculum, rating, area (incl. earlier questions)
                                               2. Retrieve:   score all records, keep top 8   (api/_retrieval.js)
                                               3. Generate:   AI writes shortlist from those 8 only, cites [SCH IDs]
◀── {answer (markdown), retrieved IDs} ────────
```
The API key stays on the server. Retrieval runs on the server too, so a visitor cannot send the AI an arbitrary prompt on your key. Each visitor is limited to 8 questions a minute (`RATE_LIMIT_PER_MIN`).

## Deploy free on Vercel (about 15 minutes)

1. **Get a free AI key.** Google AI Studio → *Get API key* (Gemini). Alternative: console.groq.com → API Keys.
   Note: on free tiers the provider may use prompts to improve its models. SchoolScout sends only the question and public school data.
2. **Put the code on GitHub.** Create an empty repo `schoolscout-dubai`, then from this folder:
   ```
   git remote add origin https://github.com/<you>/schoolscout-dubai.git
   git push -u origin main
   ```
3. **Import into Vercel.** vercel.com → *Add New → Project* → pick the repo. Framework preset: **Other**. No build command.
4. **Add the key.** *Settings → Environment Variables* → `GEMINI_API_KEY` = your key (or `GROQ_API_KEY`). Redeploy.
5. Open the `*.vercel.app` link and ask a question.

## Run locally

```
cp .env.example .env        # paste your key
npm run dev                 # http://localhost:3000
npm run dev:mock            # no key needed; canned answers
npm test                    # retrieval checks
```
Node 18 or newer. No `npm install` needed.

## Update or extend the data

`scripts/build-data.py` reads the newest `data/khda_register_*.xlsx` and merges the `FEES` table (keyed by exact KHDA name). Run `npm run data` (needs `pip install openpyxl`), then `npm run web`, which builds `index.html` (website) and `dist/artifact.html` (Claude artifact) from `web/app.src.html`.

To refresh, export a newer KHDA register into `data/` and add fees to `FEES` as they are published. Above a few thousand records, swap the keyword retrieval for embeddings.

## Files

| Path | Purpose |
| --- | --- |
| `web/app.src.html` | Front-end source for both the website and the Claude artifact |
| `index.html` | Built website (do not edit; run `npm run web`) |
| `schools.json` | School records for Explore and Compare |
| `api/ask.js` | `/api/ask`: validation, rate limit, retrieval, AI call |
| `api/_retrieval.js` | Needs parsing and scoring |
| `api/_prompt.js` | The AI's rules |
| `api/_llm.js` | Gemini / Groq / Claude / mock adapters |
| `api/_schools.js` | Generated server copy of the data |
| `scripts/` | Data builder, local dev server, tests |

Information only. Confirm fees and ratings on khda.gov.ae and with the school.
