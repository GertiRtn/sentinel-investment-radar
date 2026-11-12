# AGENTS.md — read this before changing anything

Sentinel is an investment **research and discovery** platform. It scans beyond the watchlist, turns market news into dated, evidence-backed research cases, and measures what happened afterwards. Its value is that its own record can be trusted. The invariants below protect that.

**Starting a session:** read this file, `docs/HANDOFF.md` and the latest founder brief, then state back what you understand the current state to be before writing code. When the founder's latest explicit instruction conflicts with an older proposal in these docs, the founder's instruction wins. The invariants are not "older proposals": changing one needs the founder's explicit approval.

Last revised 2026-11-12, when development moved from ChatGPT/Codex to Claude Code. The baseline is the deployed Sites code (snapshot v36), not the September `main`.

---

## Invariants — breaking one is a regression, regardless of what it enables

1. **Nothing is mutated.** No UPDATE or DELETE on captured data, facts, journal entries, resolutions, criteria, evaluations, discovery candidates, cases or outcomes. Change is expressed by appending a superseding record. Enforced by **36 SQL triggers** (`RAISE(ABORT, ...)`) in `drizzle/`. Do not remove or weaken a trigger. If a migration needs one dropped, stop and ask.

2. **`known_from` governs every read.** Any query must be answerable as of a past timestamp using only records where `known_from <= T`. For SEC facts, `known_from` is the **filing date**, never the period end (`e.filed + 'T23:59:59.999Z'` in `lib/sentinel/financial.ts`). Keep publication time, first-observed time and assessment time separate for news and cases.

3. **Unevaluable is not passing.** A check that cannot run returns `unknown`/`unavailable`/`WAIT`. It never returns pass, never renders green, never renders blank. In `evaluate()`, any `unknown` child forces the whole result to `unknown`.

4. **No value reaches the UI without provenance:** source, source timestamp (or explicit null), ingest timestamp, staleness and confidence.

5. **No model-generated numbers.** No probability, forecast, score or estimate produced by a language model reaches the UI. Probabilities are the user's own, recorded before the outcome. Extraction from a source must cite the span; uncited claims are dropped.

6. **No composite scores presented as forecasts.** A queue-priority order is research routing, never a return forecast. *Amended 2026-11-12 with the founder's explicit approval* ("We have to build such algorithms or systems that recommend that score based on the information we have"): one composite is allowed, the **evidence score** (`lib/sentinel/evidence-score.ts`, `evidence-score-v1`). It is a published checklist of pass/fail/unknown checks with fixed points (sum = 100), computed only from stored, sourced records, shown with its full checklist and always labelled as evidence strength, **never** as a probability, expected return or buy signal. Unknown checks score 0 and are shown as unknown; below 60 known points there is no score. Changing a weight or check means a new version, never an edit in place. Its usefulness is judged by outcomes per score band before anyone relies on it.

7. **Alerts inform, never instruct.** No "buy", "sell" or price target in any alert or case body. `INVESTIGATE` means "warrants research", `WAIT` means "required evidence is missing". Buy/sell labels are a future experiment that needs explicit rules and prospective validation first.

8. **Credentials stay server-side.** No key in a client bundle, `localStorage`, a commit, a handoff note or any user-visible field. `.env` stays gitignored; `.env.example` carries empty values. **This repository is public.**

9. **Tier 5 sources are not ingested:** no social media, price commentary or TV.

10. **Outcomes are recorded for everything assessed, including WAIT and rejected cases.** Without that comparison group, outcome tracking proves nothing.

---

## Current system (deployed v36, verified by reading and by `node --test tests/*.test.mjs`: 61/61 pass on 2026-11-12)

- Server-side persistence on Cloudflare D1, raw captures in D1/R2 with SHA-256 dedup.
- SEC: identity, filings, annual + quarterly figures, token bucket below SEC's ceiling, identifying User-Agent.
- Discovery: Alpaca market news (`lib/sentinel/discovery-collector.ts`), up to 5×50 items per run, checkpointed.
- Cases: `lib/sentinel/discovery-case.ts`, up to 6 per run with a 35 s budget, one slot in three oldest-first. Only `topic match` candidates are assessed.
- Screen: `researchDecision()` in `lib/sentinel/price-assessment.ts` (`research-screen-v1`).
- Indicative P/E from an IEX midpoint and reported annual diluted EPS; cash-flow scenarios (fixed 12% discount, ±5% growth, 5 years).
- Outcomes: `lib/sentinel/outcome-collector.ts`, 5/20/60/120 matched trading days vs SPY, gross, up to 8 per run.
- Journal, thesis memos, kill criteria.
- Practice v2 (`lib/sentinel/practice.ts`, `app/api/practice/route.ts`, `components/sentinel/practice.tsx`): $10,000 virtual; open/close priced by the server from a recorded IEX midpoint (never typed), SPY recorded at every trade as the position's benchmark; thesis, exit plan, kill condition and the user's own conviction 0–100 required; review prompts at 1 week / 1 month / 3 months; scorecard by evidence band and conviction band (median only from 5 trades); one `practice_mark` per UTC day from the hourly run. Gross returns. The old $50 manual ledger (`paper_trade`) is kept read-and-write under a fold.
- Discover ranking (`lib/sentinel/discover-rank.ts`, `discover-rank-v1`): last 7 days of cases, one row per symbol, highest evidence score first, with a "why here" line; research routing, not a return forecast (invariant 6). The raw feed is folded below.
- Following monitor (`lib/sentinel/thesis-monitor.ts`, `GET /api/following`): per followed company, Broken / Weakening / Holding / Can't check / No thesis, from the owner's kill criteria only, plus what changed in the last 7 days (filings, news, criterion alerts, Sentinel cases). Unknown is never Holding.
- Navigation (2026-11-12): main tabs Brief (home) / Discover / Following / Practice; the rest under a Library menu. Old tab names map via `TAB_ALIAS` in `app/page.tsx`.
- Evidence score 0–100 (`evidence-score-v1`, see invariant 6): stored on every new discovery case with the quarterly revenue comparison it used; older cases are recomputed from their stored fields with the quarter unknown. The brief ranks strong cases and watch items by it.
- Morning brief (`/brief`, `GET /api/morning-brief`, builder `lib/sentinel/morning-brief.ts`): executive summary of the last 24 h, bottom line first. Every sentence is assembled from stored records and rule templates (no model text, no estimated numbers); only `research-screen-v2` cases become takes or radar.

### How it runs and deploys (important)

- **Hosting is ChatGPT Sites.** Deployment happens from the Sites project, not from GitHub. A merged PR is not live until it is deployed there.
- **There is no scheduler in this code.** The hourly run is an external ChatGPT scheduled task calling the MCP tool `refresh_saved_company_filings` (`app/mcp/route.ts`), which runs filings, news, discovery, assessment and outcomes in one request.
- **Auth trusts platform headers** (`oai-authenticated-user-id`, `oai-authenticated-user-email`) and `getChatGPTUser()`. These are safe only because the Sites platform sets them. **Before hosting anywhere else, replace authentication first**, or anyone can impersonate the owner.

---

## Known issues (from the 2026-11-12 audit; fix deliberately, not in passing)

1. Fixed by research-screen-v2 on 2026-11-12 for new cases; historical `INVESTIGATE` from `research-screen-v1` is a data-completeness gate (company named + P/E computable + recent revenue). The P/E value, valuation, price move and news direction do not affect it. INVESTIGATE-vs-WAIT outcomes are therefore confounded with data quality.
2. Fixed by research-screen-v2 on 2026-11-12 for new records; previously `INVESTIGATE` was hard-coded on every raw discovery candidate (`discovery.ts`) and every watchlist news case (`app/mcp/route.ts`), giving one label three meanings.
3. **Fixed 2026-11-12:** outcomes are recorded at 5, 20, 60 and 120 matched trading-day intervals, one record per horizon (`horizonIntervals`). Pre-existing records are the 5-interval horizon. Never compare across horizons.
4. **Improved 2026-11-12:** `observeOutcomes` checks up to 8 (case, horizon) pairs per run within 20 s (was 1). Each pair still fetches the stock and SPY separately; batching those requests is the next step if the `outcomeObservation` counts show a backlog.
5. Capacity: ~250 headlines collected vs ≤6 assessed per run; the whole pipeline in one request is the likely cause of partial scans.
6. From September: **fixed 2026-11-12** — replay now recomputes and compares (mismatch raises an operational alert); `evaluateEntity` passes an explicit memo; alerts disclose estimated values. **By design, not a bug:** effective tax rate (and so NOPAT/ROIC) is unavailable for loss years — unavailable beats wrong. **Still needs a founder decision:** `consecutive_periods` counts fiscal years, not quarters.

---

## Shadow reader (evaluation only — added 2026-11-12)

`lib/sentinel/shadow-reader.ts`, `lib/sentinel/shadow-store.ts`, `app/api/shadow-comparison/route.ts`.

- NVIDIA Nemotron (free developer API) reads discovery headlines **in parallel with the rules** and its output is stored as `shadow_reading` records. It **must not feed** any conclusion, rule, queue order, label or alert until the founder approves it, based on the labelled comparison.
- Off unless the Site variable `SHADOW_READER_ENABLED` is exactly `"1"`. Key: Site secret `NVIDIA_API_KEY`. Model: optional `SHADOW_MODEL` (defaults to Nemotron 3 Nano Omni).
- Runs **after** the batch has created its cases (max 10 readings, 20 s), so it cannot change what was assessed. Every failure is recorded as `unavailable`/`invalid`, never thrown.
- Sends only the public headline, provider summary, SEC company name and ticker. Nothing from journal, memos, watchlist or positions.
- Code, not the model, enforces: strict schema, verbatim quotes, no numbers outside quotes (invariant 5). Stored rows are built from an allow-list; the key cannot be stored.
- Comparison: `GET /api/shadow-comparison`, labelling sheet at `?format=csv`.

---

## Research team (on demand, per case — added 2026-11-12)

`lib/sentinel/evidence-pack.ts`, `lib/sentinel/research-team.ts`, `app/api/research-team/route.ts`, `components/sentinel/research-team-panel.tsx` (in the case sheet).

- **Evidence pack (`evidence-pack-v1`):** deterministic, built from the stored case plus SEC figures filed **and** recorded by the case's assessment time. Every item has an id, source (URL or null), source and capture times, period, unit, currency, confidence and staleness. Missing data is listed, not filled. Only `shareable` items (public headline, provider summary, SEC identity and SEC facts) may reach a model. Quotes, the screen, the score and anything private are never sent.
- **Run:** synchronous, at most one model call (20 s cap, no retries), only when the user clicks. It is never part of the hourly run. It is off unless the Site variable `RESEARCH_TEAM_ENABLED` is exactly `"1"`. It reuses `NVIDIA_API_KEY`, uses the fixed NVIDIA endpoint, and accepts only models on the allow-list (`RESEARCH_MODEL` optional). When the model is off or fails, a deterministic **rules template** fills the panel, labelled "no AI model ran".
- **Code enforces the output contract:** a strict schema, citations limited to this pack's shareable ids, verbatim quotes, numbers that must appear in the cited sources, and no buy/sell/hold, targets or probabilities. Failing statements are dropped and logged, never repaired. A credential-like answer is discarded unread.
- **Records:** append-only `research_run` rows (id = the client's request id, so a retry returns the stored run). A 20 s cooldown applies per case. The research team never changes a case, screen, score, ranking, outcome, alert or trade.
- Offline only: `lib/sentinel/event-backtest.ts`. Next steps: `docs/RESEARCH-ROADMAP.md`.

## Out of scope unless the founder asks

Live order execution or broker credentials in this app (a separate, controlled execution service is the agreed direction) · leveraged/forex products · Tier 5 sources · model-generated probabilities.

---

## Running the tests

`pnpm install --frozen-lockfile` then `node --test tests/*.test.mjs` (pass the files; `node --test tests/` fails to resolve the directory on Node 22).

Never run `pnpm install` with `--config.minimumReleaseAge=0`. It bypasses the seven-day quarantine on newly published packages.

---

## Session discipline

- Work on a branch and open a PR. Never force-push, never push straight to `main`.
- Append to `docs/HANDOFF.md` at the end of every session. Never rewrite an earlier entry.
- If you could not verify something, say so. An unverified item reported as passing is worse than a failure reported honestly.
