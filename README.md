# SchoolScout Dubai

Ask in plain words, get a cited shortlist of Dubai private schools. A retrieval-augmented (RAG) assistant over KHDA ratings, fees, curriculum and area.

- **36 schools**: all 22 Outstanding schools (2026-27 fees), 11 Very Good schools (2026-27 fees), 3 with 2022 figures (flagged in the UI and to the AI).
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

All data lives in `scripts/build-data.py`. Edit it, then `npm run data` regenerates `data/schools.csv`, `schools.json` (front end) and `api/_schools.js` (server).

To cover all ~227 Dubai private schools, request KHDA's open dataset on Dubai Pulse (`khda_dubai_private_schools-open`; access is granted within about 14 days) and load its CSV in `build-data.py`. Above a few hundred records, swap the keyword retrieval for embeddings.

## Files

| Path | Purpose |
| --- | --- |
| `index.html` | The whole front end |
| `schools.json` | School records for Explore and Compare |
| `api/ask.js` | `/api/ask`: validation, rate limit, retrieval, AI call |
| `api/_retrieval.js` | Needs parsing and scoring |
| `api/_prompt.js` | The AI's rules |
| `api/_llm.js` | Gemini / Groq / Claude / mock adapters |
| `api/_schools.js` | Generated server copy of the data |
| `scripts/` | Data builder, local dev server, tests |

Information only. Confirm fees and ratings on khda.gov.ae and with the school.
