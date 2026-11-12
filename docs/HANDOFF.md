# Sentinel — Session Handoff Log

Append a dated entry at the end of every session. **Never rewrite an earlier entry.** Same principle as the research journal: the record of what was believed and when is the point.

Template at the bottom.

---

## 2026-09-17 — Claude (Cowork) — independent code review

**Worked on:** first direct read of the repository. Previous sessions had only browser-level observation of the deployed app.

**Verified by running, not by reading:**

- `node --test tests/` — **23 tests pass** (9 in `work-order03.test.mjs`, 14 across `feeds`/`persistence`/`worker-feeds`). Miniflare with real D1, migrations applied, `disableNetConnect()`.
- **36 SQL triggers** enforce immutability at the database level across `raw_event`, `fact`, `signal_log`, `resolution_record`, `entity`, `filing`, `financial_fact`, `collector_run`, `workspace_revision`. This is stronger than the spec asked for — application code cannot mutate these tables even if a future session tries.
- `known_from = e.filed + 'T23:59:59.999Z'` confirmed in `parseFacts`. Look-ahead bias avoided, conservatively (end of UTC day).
- `selectFacts` restatement ordering confirmed correct; test fixtures include a real restatement (Revenues restated 100 → 120 under a later accession).
- `evaluate()` confirmed: any `unknown` child forces overall `unknown`. Cannot pass while unevaluable.
- `material_weakness_disclosed` returns `unknown` with an honest reason rather than inferring from 8-K item codes.

**Better than specified:** `companyFile()` distinguishes a `public` clock (what was publicly knowable at T, reconstructed from filing dates) from a `recorded` clock (what Sentinel actually held at T). These are genuinely different questions and most systems conflate them. Keep both.

**Five open issues, none fixed this session:**

1. **Replay determinism is cached, not recomputed.** `evaluateCriterion` returns `JSON.parse(replay.snapshot_json)` when a prior evaluation exists for the same `as_of`. The "replay matches" test therefore compares a snapshot to itself and proves nothing about `evaluate()` being deterministic. Worse: a snapshot taken before the 12-year archive backfill completed rests on incomplete data and is pinned permanently; a later, more complete ingest would give a different and more correct answer for that same moment, and the cache hides the divergence. **Fix: recompute and compare, flag mismatch rather than silently serving the stale snapshot.**

2. **`consecutive_periods` counts fiscal YEARS, not quarters.** `selectFacts` drops anything that is not a 330–380 day period. A kill criterion with `consecutive_periods: 2` therefore takes two years to confirm, not two quarters. Reason strings are honest about this, but it is a large latency difference for a thesis-breaking condition. **Needs a deliberate decision, not inheritance.**

3. **Alerts do not disclose estimated confidence.** `ebitda`, `net_debt_to_ebitda`, `roic`, `invested_capital` and the incremental-ROIC family are computed with `estimate=true` → `confidence:'estimated'`, but the alert body carries only `current: c.values[0]?.value`. A trip on `net_debt_to_ebitda > 3.5` will not say the EBITDA is a proxy (operating income + D&A) and the ratio is an estimate. Provenance gap in the place it matters most.

4. **`evaluateEntity` passes `c` as both criterion and memo** — `evaluateCriterion(c, c, asOf)`. Works only because the SELECT joins memo columns onto the criterion row. Any future read of `memo.id` inside that function silently gets a criterion id. Latent, not live.

5. **`effective_tax_rate` excludes loss years and tax benefits** (`pretax > 0 && tax >= 0 && tax <= pretax`). Correct by principle — unavailable beats wrong — but NOPAT and ROIC go unavailable for any loss-making year. On cyclicals, where ROIC history matters most, this will be frequent.

**The critical unknown: no real SEC call has ever happened.** All 23 tests run under `disableNetConnect()` with small synthetic fixtures. A real large filer's `companyfacts` payload exceeds 10MB; the code guards at 35MB then does sequential fetches through a 2/sec token bucket inside a Cloudflare Worker with CPU and subrequest limits. That combination passes easily on fixtures and is plausible to fail on real data. **Untested, and cannot be tested from a sandbox without sec.gov egress.**

**Repo bug found, unrelated to any work order:** `pnpm-workspace.yaml` has no `packages:` field, so `pnpm install` fails outright on a fresh clone. Add `packages:` with `- '.'` under it. Not fixed here — flagged for a standalone commit.

**Nothing committed or pushed this session.** Local changes were debugging artifacts only (the workspace patch above, and a lockfile rewritten by an install that bypassed `minimumReleaseAge`). Both reverted; tree left clean.

**Next action, in order:**

1. **Run one real SEC ingest from the deployed environment** — a mid-sized US filer, not Apple. Record the outcome. Then retry with a large filer specifically to find the ceiling. Everything else is polish on code that has not met real data.
2. Work Order 04: the five issues above, plus whatever the real ingest exposes.
3. Note for the parked hosting decision: the stack is already Cloudflare Workers + D1, and **Cloudflare Cron Triggers** provide always-on scheduling natively. The platform is not the obstacle it was assumed to be — which makes the recurring `/api/*` 503s worth diagnosing rather than migrating away from.

---

## Template

```
## YYYY-MM-DD — <which AI / who> — <one-line topic>

**Worked on:**
**Verified by running:**        (state how, not just that)
**Changed:**                    (files, and why)
**Open / broken:**
**Could NOT verify, and why:**
**Next action:**
```


---

## 2026-09-17 — Codex — production ingest blocked at sign-in

**Worked on:** Read the current GitHub AGENTS.md and this handoff in full, then summarized the verified baseline before any code change. Attempted to reach the deployed watchlist for the required real SEC ingest.

**Verified by running:** Sites get_site confirmed the owner-accessible live deployment (version 5). Live D1 overview returned binding DB. Reading sec_run and financial_fact with limit 1 returned rows: [], has_more: false for each: both tables were empty at inspection. Clicking the deployed site's Continue with ChatGPT link reached auth.openai.com, which displayed "Performing security verification" and a Cloudflare "Verify you are human" checkbox (Ray ID a3c9a2a2aa50abf8). No watchlist submission was made. Recent Worker error logs (30-minute window, limit 10) returned no events; this is not evidence that an ingest succeeds or avoids resource limits.

**Changed:** Appended this handoff entry only. No application code, database schema, triggers, dependencies, runtime configuration or deployment changes. No test rerun; the 23-test/36-trigger baseline remains the independent review's finding.

**Open / broken:** Task 1 remains blocked by interactive sign-in verification. Neither the mid-sized filer nor Apple was ingested. All five Task 2 issues remain unstarted, including the quarterly-period decision.

**Could NOT verify, and why:** End-to-end ingest completion, wall-clock time, companyfacts payload bytes, per-filer financial_fact row counts, and Worker CPU/subrequest/memory limits are unmeasured because authentication prevented the watchlist action. The zero-row database observation is a pre-ingest baseline, not a successful zero-result ingest. Browser guidance requires explicit user permission before attempting the CAPTCHA.

**Next action:** Obtain permission to attempt the visible human-verification challenge or use the supported manual browser handoff, complete normal sign-in, and run the mid-sized filer then Apple through the deployed watchlist. Report actual measurements before starting Task 2. Preserve the existing invariants and annual-period semantics.

---

<!-- Entries below were written in the deployed Sites project (snapshot v36) and are restored here verbatim. -->


## 2026-11-09 — Codex — simpler starting screen

Added a Start here screen with paths to market updates, the watchlist, research examples and the journal. The future simulated trading pilot is labeled as upcoming. Existing workspace and research functionality are retained.

Verified: all 23 existing fixture tests passed. Managed preview did not finish starting in this environment, so browser interaction remains unverified.

Next: verify the navigation in the deployed site, then design the simulated pilot experience.

## 2026-11-09 — Codex — interactive pilot walkthrough

Replaced the inactive pilot placeholder with a clearly labeled, session-only walkthrough using fictional Bitcoin or Apple prices and a $50 example. The user can step through an illustrative purchase and sale; the UI states that there is no broker connection, automatic monitoring, live data, fees or persistence. No trading, portfolio, brokerage or existing data APIs were added. The 23 existing fixture tests passed. Browser preview service remained starting, so interactive browser verification was unavailable.

Next: validate real paper-trading data capture and a durable simulation ledger separately; never promote walkthrough values as real signals or account balances.

## 2026-11-10 — Codex — SEC quarterly research view

Production SEC runs for Etsy and Apple reported success; Etsy's 2025 revenue displayed by Sentinel was checked against its original 10-K. Added a separate view of directly reported approximately three-month facts, respecting filing and recorded cutoffs and keeping annual criteria unchanged. Year-to-date and instant figures are excluded; missing quarters are not estimated. Automatic monitoring is not active.

Verification: 25 Node tests passed in the site checkout, including fixture tests for historical cutoffs, restatements, and exclusion of non-quarter durations. The deployed quarterly view still needs a real-company comparison after publication. Run markers report processed observations rather than inserted fact counts; total ingest duration and payload sizes were not measured.

## 2026-11-10 — Codex — unattended SEC refresh preparation

Added an authenticated Site MCP tool that checks up to five saved companies per call, prioritizing the oldest prior attempt, and exposes the most recent check status on company files. It uses the caller's verified identity/contact and scopes its query to the caller's own watchlist. Existing SEC caching, rate limits, append-only captures, and failure records remain in use. No trading or background thesis evaluation is enabled.

Local verification: work-order03 tests passed including an actual fixture-backed refresh of three companies, rejection of missing identity, and isolation of another owner's empty watchlist; TypeScript passed. The tool and any proposed schedule require production authorization and independent readback verification; do not claim the schedule is working before then. SEC data may remain cached for 24 hours. One invocation checks at most five companies.

## 2026-11-10 — Codex — plain-language annual company summary

Added a deterministic sourced summary of latest annual revenue, net income and operating cash flow. Previous-period comparisons require the same tag, unit, a year-apart period and similar duration; percentage change is withheld for a nonpositive prior value. The UI identifies missing values, stale captures and reporting-scope caveats and cites both source records. It uses existing as-of-selected figures, does not infer investor recommendations or modify thesis checks. Corrected manual-refresh copy to acknowledge the scheduled check; first scheduled run remains unverified.

Verification: TypeScript passed; 28 tests passed on rerun including two new summary tests. An existing SEC rate timing test failed once under concurrent full-suite load and passed on rerun; timing flakiness remains an open issue. Build and deployed visual verification are tracked separately.

## 2026-11-10 — Codex — executive summary and filing explanation

Added a deterministic executive sentence from the sourced annual revenue, net income and operating cash flow comparisons, preserving unknowns and the selected cutoff. Added an on-demand current-view-only revenue explanation reader: it checks watchlist ownership, constructs a narrow SEC report URL from matched filing metadata, follows no redirects, uses the SEC rate limiter, archives and hashes the raw HTML, and displays only one unambiguous short direct statement. It does not infer causes or generate trading advice. Missing or ambiguous explanations remain unavailable. Historical views cannot use this current-source explanation.

Validation: TypeScript passed. The 30-test suite passed before the additional route integration test; the 11-test work-order suite passed after it, including access isolation, source capture and a synthetic filing statement. Live SEC narrative retrieval, real-world extraction and visual QA remain unverified. Source may contain multiple matching statements; in that case the reader intentionally returns unavailable. The earlier intermittent SEC request-timing test remains an open issue.

## 2026-11-10 — Codex — company summary clarity

Responded to founder feedback that the company summary was visually crowded. Kept the executive sentence and moved the three reported metrics into compact responsive cards; the direct company quote has a dedicated section. Exact figures, provenance, capture and caveats remain available in expandable sections. No calculation, source selection, filing reader, historical cutoff or trading behavior changed. Founder screenshot confirmed the Etsy revenue explanation from the deployed reader; no claim is made for every company.

Verification: 31 existing Node tests and TypeScript passed. The production build and visual review are tracked separately.

## 2026-11-10 — Codex — saved practice portfolio

Added a private, append-only $50 USD practice ledger under Trading pilot. User-entered symbol, quantity, price, source and reason create simulated trades with a 0.1% fee assumption (rounded up, minimum one cent). The server rejects insufficient cash, oversells and stale concurrent writes; retry identifiers make repeat requests idempotent. Portfolio state is rebuilt from immutable paper_trade signal records; no schema migrations or live orders. Original example remains accessible. Manually entered last trade prices are clearly labelled and are not a current valuation.

Verified: 32 Node tests passed, including D1-backed balance, fees, idempotency, oversell, account isolation and stale revision, and TypeScript passed. Build and visual QA tracked separately. This is manual paper trading only: no stock price feed, automated decisions, spread/slippage modelling, current valuation, profit/benchmark report or real broker integration. Scheduled SEC updater and all existing features remain separate.

## 2026-11-10 — Codex — first investment brief

Added a private, rules-based investment brief for SEC watchlist companies. It synthesizes available annual filing figures, identifies missing price, valuation, complete news and validation, and currently returns WAIT for every stock because those inputs are not connected. It does not claim to be a tested buy/sell strategy. Users may append a source-preserving, timestamped brief snapshot and see the last ten saved snapshots. Preserved company-file access, append-only signal_log and paper ledger; no real or simulated orders are placed. Current/previous values retain filing and capture references; stale data is flagged.

Verification: 33 tests passed, including D1-backed watchlist ownership, evidence, missing-price WAIT, snapshot persistence and duplicate retry; TypeScript passed. Live UI and production read/write remain unverified pending deployment. Next: investigate a permitted no-cost stock data source, add price timestamps and valuation evidence, then validate a decision rule in shadow mode; the existing WAIT-only prototype is not a directional recommendation engine.

## 2026-11-10 — Codex — Alpaca IEX stock quote adapter

Prepared a read-only stock-quote connection for saved SEC companies. Server-only credentials are optional; no account, secret or paid plan was added. The authenticated POST endpoint uses Alpaca's IEX latest quote endpoint, limits the symbol to the selected watched company, verifies bid/ask and provider timestamp, records the source and capture time, caches for 60 seconds, and reports stale quotes over five minutes old and provider errors honestly. The brief remains WAIT because a quote alone does not establish valuation or a tested strategy. Existing live and paper trading are not connected.

Verification: 36 Node tests and TypeScript passed, including fixture-backed owner isolation, source capture, secret redaction, caching, malformed/crossed/future data and stale marking. Actual Alpaca authentication, quote access, exchange entitlements, display and costs are unverified because no account/credentials are present. Alpaca's free IEX feed is a single-exchange quote, not the consolidated US market or an execution guarantee.

---

## 2026-11-12 — Claude (Claude Code) — consolidate deployed v36 as the new baseline

**Worked on:** Development moves from ChatGPT/Codex to Claude Code. Audited the deployed Sites code (branch `snapshot/deployed-site-2026-11-12`, "site version 36") against the founder's 12 Nov platform brief, and prepared it to become `main`.

**Verified by running:** `pnpm install --frozen-lockfile` then `node --test tests/*.test.mjs` on this branch: **61 tests, 61 pass, 0 fail** (Node 22.23.4, pnpm 11.25.0). Trigger count unchanged at 36 (24 in 0001, 12 in 0000, 0 in 0002). Everything else in the audit is from reading code, not observing production.

**Changed:**
- `pnpm-workspace.yaml`: restored `packages: ['.']`; without it a fresh install fails. The snapshot had dropped the 17 Sep fix.
- `AGENTS.md`: restored (the snapshot dropped it) and rewritten around the brief's discovery vision. Invariants kept; added #10 (outcomes recorded for WAIT/rejected cases too). Documents the ChatGPT Sites deployment, the external scheduler and the platform-header auth risk.
- `CLAUDE.md`: new; imports AGENTS.md so Claude Code loads the same rules.
- `docs/HANDOFF.md`: restored the 17 Sep entries and the template from `main`; the Nov entries from the snapshot are appended verbatim below them. No entry was edited.
- `tsconfig.tsbuildinfo`: removed from git and ignored (build cache).
- No application code, schema, triggers, dependencies or lockfile changed.

**Open / broken:** see "Known issues" in AGENTS.md. Most important: INVESTIGATE measures data completeness, not attractiveness; 5-day-only outcomes; outcome capacity of 1/run; one-request pipeline. The handoff has no entries for the discovery, case, outcome and throughput work that is in v36. That work was reported in ChatGPT but never logged here.

**Could NOT verify, and why:** whether v36 is exactly what is live (the brief cites "Library version 69", which may be a different counter); whether the hourly ChatGPT scheduled task is still running; production queue size and outcome counts; whether the exposed Alpaca paper keys were rotated. None of these are reachable from the repository.

**Next action:** founder merges this PR. Then: rotate Alpaca keys; split the INVESTIGATE label and pre-register a real screening rule; add 20/60/120-day outcomes with batched fetching; decide hosting (stay on Sites vs own Cloudflare, which needs auth replaced first).


## 2026-11-12 — Codex — screen v2 readiness and research rules

**Worked on:** Split data readiness from event, relevance and P/E research rules; route new cases and label historic records.

**Verified by running:** Baseline 61 passing; updated suite 64 passing, zero failures. `pnpm build` succeeded. TypeScript check passed before the final UI grouping change; the build passed with that change.

**Changed:** Price assessment, discovery collection and cases, watchlist news, discovery API and UI, dashboard mapping and tests. Outcome records are displayed by screen version and conclusion; historic records remain unchanged.

**Open / broken:** Rules are unvalidated. v1 WAIT and v2 WAIT are not equivalent: v2 readiness excludes direct-role matching. Outcome coverage and throughput remain limited.

**Could NOT verify, and why:** Browser rendering, scheduled operation and production behavior were not exercised; no deployment was performed.

**Next action:** Review the PR and experimental rules before merge or any deployment.

## 2026-11-12 — Codex — relevance matching and analyst queue ordering

**Worked on:** Improved headline-only company relevance and discovery assessment routing for new cases on PR #14.

**Verified by running:** `node --test tests/*.test.mjs`: 64 passed before and 66 passed after, zero failures. `pnpm build` succeeded. Focused relevance and D1-backed queue tests passed, including the reserved oldest slot.

**Changed:** `lib/sentinel/news-assessment.ts` and `tests/news-assessment.test.mjs` add `headline-relevance-v2`, cleaned names, restricted first-word aliases, direct-action and possessive matching, and negative fixtures. `lib/sentinel/discovery-case.ts` and `tests/work-order03.test.mjs` place analyst-only candidates behind other topics on normal slots; every third slot remains oldest-first. Existing stored relevance and cases are not rewritten.

**Open / broken:** Headline matching and aliases remain heuristics, not verified entity or event resolution. Research screen rules remain unvalidated and old and new WAIT definitions differ. Queue and outcome throughput limitations remain.

**Could NOT verify, and why:** Production matching, scheduled processing, real-provider coverage and browser rendering were not exercised; no deployment was performed.

**Next action:** Review PR #14 and the experimental rules before merging or deploying.

---

## 2026-11-12 — Claude (Claude Code) — CI, replay recompute, alert provenance

**Worked on:** In parallel with Codex's screen-v2 work (PR #14), on branch `fix/ci-and-criteria` from `main` at c50347d. No overlap with PR #14 files.

**Verified by running:** `node --test tests/*.test.mjs` → **64/64 pass** (61 before + 3 new in `tests/criteria-replay.test.mjs`). `tsc --noEmit` → 0 errors.

**Changed:**
- `.github/workflows/ci.yml` (new): frozen install, full tests, type check and Sites build on every PR and on pushes to main.
- `lib/sentinel/criteria.ts`:
  - Replay no longer serves the earlier snapshot. Every evaluation recomputes; when an earlier evaluation of the same `as_of` exists, `compareReplay()` records `replayOf {evaluationId, matches, earlierResult, differences}` in the new evaluation, and a mismatch appends an Operational alert ("REPLAY DIFFERS…"). Both evaluations are kept (append-only).
  - Alert evidence now carries `confidence`, `method` and `estimated` per condition, and the alert note says when values are estimates (e.g. EBITDA proxy). Closes September issue 3.
  - `evaluateEntity` passes an explicit memo object instead of `c` twice (September issue 4).
- `tests/work-order03.test.mjs`: the replay test now asserts the replay names the earlier evaluation, `matches === true`, and no mismatch alert. `tests/criteria-replay.test.mjs` (new): a matching replay; a moment evaluated before a backfill (unknown) differing after it (trip); a changed input set flagged even when the result is unchanged.
- `AGENTS.md` known issue 6 updated.

**Decided, not changed:** effective tax rate for loss years stays unavailable (September issue 5): correct by the "unavailable beats wrong" principle. `consecutive_periods` years vs quarters (issue 2) still needs a founder decision.

**Could NOT verify:** the CI workflow itself until GitHub runs it on this PR; the mismatch alert end-to-end through the API (covered by the pure comparison tests, not a fixture backfill).

**Next action:** merge PR #14 and this PR; then Nemotron shadow mode.

---

## 2026-11-12 — Claude (Claude Code) — Nemotron shadow reader (evaluation only)

**Worked on:** Took over from Codex's scaffold (`f8175dd`) on branch `shadow-reader`, from `main` at f681c25.

**Verified by running:** `node --test tests/*.test.mjs` → **80/80** (69 before + 10 in `tests/shadow-reader.test.mjs` + 1 integration test in `work-order03`). `tsc --noEmit` 0 errors. `pnpm build` succeeds. The integration harness now runs with `SHADOW_READER_ENABLED=1` and a mocked NVIDIA endpoint, so every existing batch test also runs with the reader on; all still pass.

**Changed:**
- `lib/sentinel/shadow-reader.ts`: reader (Nano Omni default; `enable_thinking:false`; temperature 0; 1500 tokens; 8 s timeout; one attempt), thinking/code-fence stripping, strict zod schema, verbatim-quote and number-outside-quote checks, allow-listed `storedReading`, comparison mapping (rules `direct_candidate` ↔ model subject/counterparty; rules topics ↔ model event types) and CSV export with formula-injection guard.
- `lib/sentinel/shadow-store.ts`: runs after `assessDiscoveryBatch` has created its cases; max 10 readings and 20 s per run; appends `shadow_reading` rows; never throws.
- `lib/sentinel/discovery-case.ts`: `assessDiscoveryQueue` also returns `caseId`; the batch calls the shadow hook after its loop and reports `shadow: {status, attempted, statuses}`. Case content and conclusions unchanged.
- `app/api/shadow-comparison/route.ts` (new) and a CSV download link in `components/sentinel/discovery.tsx`.
- `AGENTS.md`: "Shadow reader" section.

**Design choice:** Codex's plan ran the reader inside each case assessment. That would spend up to 8 s per case from the batch's 35 s budget and reduce how many cases are assessed, a silent product change. It now runs after the loop instead.

**Could NOT verify:** a real call to NVIDIA (no key here, and none should be used in tests); whether the Nano Omni model honours `enable_thinking:false` (handled either way); real latency and the free-tier quota. All are observable after deploy through each reading's `status`, `httpStatus` and `latencyMs`.

**Next action:** founder merges, redeploys the Site, sets `SHADOW_READER_ENABLED=1`. After about a week, download the CSV, label about 100 rows, and compare.

---

## 2026-11-12 — Claude (Claude Code) — outcome horizons 5/20/60/120 and more observations per run

**Worked on:** Known issues 3 and 4. Branch `outcome-horizons` from `main` at c8884cd.

**Verified by running:** `node --test tests/*.test.mjs` → **83/83** (80 before + 3 new). `tsc --noEmit` 0 errors. `pnpm build` OK.

**Changed:**
- `lib/sentinel/outcome-observation.ts`: `compareForwardBars(…, intervals=5)` (the 5-interval result is unchanged); `OUTCOME_HORIZONS = [5,20,60,120]`; `horizonWaitDays` (5 → 8 days as before; 20 → 29, 60 → 85, 120 → 169).
- `lib/sentinel/outcome-collector.ts`: picks the oldest case with a due horizon that has no record yet, per horizon. A record without `horizonIntervals`, or an attempt without one, counts as 5, so existing records and cooldowns keep their meaning. The 5-interval record keeps its original id key (no duplicates). New `observeOutcomes(owner, 8, 20000)`; the MCP run uses it instead of one observation per run.
- `app/api/discovery/route.ts` groups outcomes by screen version · label · horizon; `components/sentinel/discovery.tsx` shows the horizon on every outcome line.
- Tests: horizon math; an end-to-end old case producing four separate records in one run with no repeats; a short-history case recording 5 and waiting on 20 (with the attempt and cooldown logged, nothing guessed).
- `AGENTS.md`: known issues 3 and 4 and the current-system line.

**Could NOT verify:** real Alpaca bar coverage over 120 trading days for thinly traded IEX symbols (missing bars give `pending`, never a guess), and real run time on Sites.

**Next action:** founder merges and publishes. Watch `outcomeObservation.counts` in the hourly run output for backlog.

---

## 2026-11-12 — Claude (Claude Code) — morning-brief dashboard at /brief

**Worked on:** The founder asked for an executive-summary dashboard ("save me time, show only what matters"). The design was researched (BLUF, sell-side morning note, progressive disclosure) and prototyped in Lovable (project "Sentinel Research Dashboard", sample data only). Lovable's free credits ran out, so the dashboard layout was built directly in Sentinel. Branch `morning-brief` from `main` at 9236d69.

**Verified by running:** `node --test tests/*.test.mjs` → **90/90** (83 before + 6 in `tests/morning-brief.test.mjs` + 1 integration test). `tsc` 0 errors; `pnpm build` OK; locally `/brief` returns 200 and `/api/morning-brief` returns 401 without sign-in.

**Changed:**
- `lib/sentinel/morning-brief.ts` (pure): bottom line (conclusion → radar → watchlist → system warning, including "no scan for N hours"), takes (v2 INVESTIGATE, max 3; why/check lines from the existing `news-assessment` templates; one key fact with source), radar (v2 MONITOR, closest misses first, reason derived from stored rule results), waiting, status level, outcome counts per horizon (counts only, no averages).
- `app/api/morning-brief/route.ts`: loads the owner's last-24 h cases, watched entities with filings and news from that window, the last checkpoint, queue size, outcome counts and shadow readings, plus case details for the side panel.
- `app/brief/page.tsx`: dashboard layout in Sentinel's existing theme. `app/page.tsx`: "Morning brief →" link in the header. The home page is otherwise unchanged.

**Could NOT verify:** how the page looks with real data (no browser or sign-in here). The founder should check it after publishing.

**Next action:** founder merges, publishes, opens /brief, and gives feedback. If approved, make /brief the home page.

## 2026-11-12 — Claude Code: navigation restructure (Batch 1 of 4)

- Four main tabs: **Brief** (home, embeds the morning brief), **Discover** (was Hot market + Market discovery), **Following** (was Watchlist + Thesis checks + Alerts), **Practice** (was Trading pilot). Everything else sits in a **Library** dropdown.
- Old tab names still resolve through `TAB_ALIAS` in `app/page.tsx`, so existing internal links keep working. `/brief` still works as its own page (`components/sentinel/morning-brief.tsx`, `MorningBriefView`).
- Plain labels for v2 screen results only: INVESTIGATE → "Strong case", MONITOR → "Watch", WAIT → "Not enough data" (`friendlyLabel`, exact match). v1 labels are unchanged ("Data ready (v1 label)"), so a v1 data-completeness pass never shows as a strong case.
- No data, schema or rule changes. Verified: `node --test tests/*.test.mjs` 90/90, `tsc --noEmit` clean, `pnpm build` OK. UI not checked in a browser. Look at it on the Site after publishing.
- Next: Batch 2 (evidence score 0–100, needs an AGENTS invariant 6 amendment with the founder's approval), Batch 3 (Practice rebuild), Batch 4 (Discover ranking + Following thesis monitor).

## 2026-11-12 — Claude Code: evidence score 0–100 (Batch 2 of 4)

- New `lib/sentinel/evidence-score.ts` (`evidence-score-v1`). Eight checks, fixed points summing to 100: material event (15), company named directly (15), P/E 0–30 (15), latest quarter revenue up year on year from SEC quarterly figures (15), annual revenue up (10), profitable (10), positive operating cash flow (10), fresh SEC data (10). Unknown = 0 points and shown as unknown; under 60 known points there is no score ("Not enough data to score"). Bands: 70+ strong, 40–69 mixed, under 40 weak.
- Founder approved the score on 2026-11-12; AGENTS invariant 6 is amended with the limits (checklist only, never a probability, versioned, judged by outcomes per band).
- `discovery-case.ts` stores `evidenceScore` and `quarterlyRevenue` on new cases. Older cases are recomputed at read time from stored fields with the quarterly check unknown, so most will show "Not enough data to score" or a lower score until new cases arrive.
- Brief: takes and watch items sorted by score; bottom line says "(evidence N/100)"; take cards show the badge and what is holding the score back; the case sheet shows the full checklist with sources. `morning-brief-v2`.
- The morning-brief test that banned the word "score" now bans buy/sell/hold/price target/probability/confidence and requires every score to come from `evidence-score-v1`.
- The weights are a hypothesis set before looking at outcomes. Not yet done: track record per score band (needs outcomes; planned with Practice in Batch 3).
- Verified: tests (see PR), tsc, build. Not checked in a browser.

## 2026-11-12 — Claude Code: Practice v2 (Batch 3 of 4)

- Practice is now $10,000 of virtual money with live prices. The server prices every open and close from a recorded IEX quote midpoint. The quote's raw-event id and time are stored, and a price typed in the request is rejected. SPY is recorded at each trade, so every position has its own benchmark: the same dollars in SPY at the same moments.
- Opening requires a thesis, an exit plan, what would prove it wrong, and the founder's own conviction 0–100 (his number, recorded before the outcome, so it fits invariant 5). Opening from a case ("Practice-trade this" in the brief's case sheet, link `/#practice?case=…&symbol=…`) copies the case's evidence score from the stored record, not from the client.
- Live: the Practice tab refreshes every 60 s while visible. The quote cache is 60 s and up to 12 open symbols are priced. A missing price shows "unknown" and the portfolio value becomes unknown, never guessed.
- History: `markPractice` in the hourly MCP run appends one `practice_mark` per UTC day (skipped when a position cannot be priced). The chart starts after the first mark.
- Reviews at 1 week / 1 month / 3 months ("Still holding" / "Thesis broken — close") are stored as `practice_review`. Scorecard by evidence band and by conviction band: count and beat-SPY count; median gap only from 5 trades per band.
- All records are append-only signal_log kinds (`practice_trade`, `practice_review`, `practice_mark`); conditional append on the trade count, as with the old ledger. The old $50 ledger stays under a fold.
- Gross returns: no fees, taxes or slippage, and the page says so. Closed-market quotes are allowed (up to 5 days old, spread ≤ 2%) and labelled with their time.
- Verified: unit tests (`tests/practice.test.mjs`), a Miniflare API test with mocked IEX quotes in work-order03, tsc, build. Not verified against real Alpaca or in a browser.

## 2026-11-12 — Claude Code: Discover ranking + Following monitor (Batch 4 of 4)

- Discover now opens with "Ranked by evidence — read these first". It covers the last 7 days of cases, one row per symbol (duplicate reports merged and counted), and orders scored cases by evidence score: ties go to the stronger screen label, then the newer report, and unscored cases come last. Each row has a "Why here" line and a "Practice-trade this" link. The raw feed and outcome records sit under a fold, and Discovery now comes above Hot market. `discover-rank-v1`.
- Following now opens with a thesis monitor (`GET /api/following`, `thesis-monitor-v1`). Each followed company gets a status from the founder's own kill criteria: Broken if any tripped; Weakening if all pass but a condition is already met without its full streak (read from the evaluation snapshot); Holding only if every criterion was evaluated and passes; Can't check if anything is unknown or unevaluated; No thesis if there is no memo or criterion. It also lists the last 7 days of changes: new filings, news, criterion alerts and Sentinel cases with their score. Rows are ordered Broken first and changed first, and a company with nothing new reads "No change this week".
- Verified: tests 111/111 (unit + Miniflare smoke for `/following` and `/discovery` ranking), tsc, build. Not checked in a browser.
- Merge order: #19 → #20 → #21 → this. Then ask Codex to publish the latest main to the Site in one go.
- Open founder decisions: `consecutive_periods` counts fiscal years (affects Weakening/Broken timing); whether to switch on the shadow reader (SHADOW_READER_ENABLED=1); rotate the Alpaca keys exposed earlier in a ChatGPT chat.

## 2026-11-12 (evening) — Claude Code: research team v1 + offline backtest (founder brief "research team and quantitative research engineering")

**Baseline:** main 07a6573 (PRs 14–22 merged); `node --test tests/*.test.mjs` 111/111 on that commit. The deployed Site revision was not verified from this session.

**Built (branch `research-team-v1`):**
- `lib/sentinel/evidence-pack.ts` (`evidence-pack-v1`): a point-in-time pack per case. SEC figures are loaded with `companyFile(..., asOf=case time, 'recorded')`, so a fact must be filed and recorded by the case time. Annual: revenue, net income, operating income, CFO, capex, cash, total debt, equity, EPS, diluted shares, share-count change (latest year plus the prior year). Quarterly: three-month revenue, net income and CFO with the same quarter a year earlier. Also the quote, P/E, screen, score, missing items and cautions. Only `shareable` items can reach a model.
- `lib/sentinel/research-team.ts` (`research-team-v1`, prompt `research-team-prompt-v1`): one call returns evidence / bull (≤3) / bear (≤3) / editor. Strict zod schema; checks on citations, verbatim quotes, numbers, forbidden language and credentials. Errors give a status (`disabled` / `unavailable` / `timeout` / `invalid` / `partial` / `ok`) and fall back to a deterministic rules template.
- `app/api/research-team/route.ts`: GET runs for a case and the feature state; POST is a synchronous run with the request id as the record id (idempotent), a 20 s per-case cooldown, and append-only `research_run`. Owner-scoped (404 cross-owner). Raw model text is stored but never returned to the browser.
- `components/sentinel/research-team-panel.tsx` in the brief's case sheet. It shows positives, risks with "would be wrong if", missing information, the editor's open disagreements and checks, and every source with its link, times, staleness and "not sent to any model". It is labelled "Model-assisted research (unvalidated)" or "Rules template — no AI model ran".
- `lib/sentinel/event-backtest.ts` (offline only, fixtures): next-open fill after signal + latency, explicit spread/fee/slippage on both sides, an SPY comparator with the same costs, rejected fills on missing bars, a clock-order check, determinism.
- `docs/RESEARCH-ROADMAP.md`: P3 plan, the reference-project review (TradingAgents Apache-2.0, OpenBB Apache-2.0 since v5, Qlib MIT; ideas only, nothing imported) and how the three books map onto the design.

**Verified here:** tests 127/127 after (111 before; none loosened), `tsc --noEmit` clean, `pnpm build` OK. The model path is tested with mocked fetch only. The route is tested in Miniflare with the feature off (as by default), so no network is reachable.

**Not verified:** the real NVIDIA endpoint, free-tier terms and quota for this use, real latency, the live Site, and the browser UI. Discover rows have no case sheet, so the panel is only reachable from the Brief's case sheet.

**Enablement (founder only; not done):** set the Site variable `RESEARCH_TEAM_ENABLED=1` (and optionally `RESEARCH_MODEL` to an allow-listed id). `NVIDIA_API_KEY` is already a Site secret. Leave `SHADOW_READER_ENABLED` as it is.

**Open risks carried forward:** D1 overload in outcome observation (this feature adds no hourly load); Alpaca key rotation still unconfirmed; evidence-score weights unvalidated; IEX is a single-exchange midpoint; share basis unverified; provider news coverage partial.
