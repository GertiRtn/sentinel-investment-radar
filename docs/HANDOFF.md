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
