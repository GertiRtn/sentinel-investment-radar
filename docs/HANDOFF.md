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

## 2026-11-09 — Codex — offline Study 3 development baseline

**Worked on:** Added the standalone Python research package at `research/study3-momentum/`. The frozen protocol compares BTCUSDT and ETHUSDT independently using development data through December 2022.

**Verified by running:** All four Python fixture tests and all 23 existing Sentinel tests passed. Verified 74 official public spot ZIPs against their published SHA-256 sidecars, including December 2019 warm-up. Two offline runs generated byte-identical JSON. Manifest SHA-256: `7c4f795136c58d852d19ebb456461ce41bde8f1a8fc95484593264debde0b929`.

**Changed:** Research package and this handoff entry. The generated archives and JSON results are local and ignored by Git.

**Open:** The development winners were BTC 28 bars and ETH 14 bars. The next-open fill, spread and slippage are simulated assumptions. This run allows fractional units without venue order filters. The validation and holdout ranges were not accessed.

**Next action:** Apply the frozen validation gate to the selected candidates in a separate step. Preserve the untouched holdout until the gate decision is recorded.

## 2026-11-09 — Codex — selected-rule validation

Ran frozen 2023-01-01 through 2024-06-30 validation, starting flat with December 2022 warm-up, separately for BTC 28-day and ETH 14-day momentum. Both had positive modeled net returns and pass the stated validation gate. BTC returned 242.83% versus 278.91% buy-and-hold, with 15.24% maximum daily-close drawdown. ETH returned 28.35% versus 187.01% buy-and-hold, with 36.45% drawdown. One-extra-bar sensitivity returned 187.09% and 57.58% respectively. Two runs produced identical stdout. These estimates use the original assumed fees and execution model, without exchange filters. Results do not establish an edge.

The executable validation script and manifest/metrics are recorded in research/study3-momentum. The final holdout has not been opened. No application or execution code changed.

## 2026-11-09 — Codex — independent validation arithmetic review

Re-ran four fixture tests and cross-checked the two validation equities with separately written Decimal position accounting over the recorded bars. BTC differed by 3e-25 USDT, ETH matched to displayed precision. Ran a 2x assumed-cost scenario. Added research/study3-momentum/REVIEW.md with measured results, timing limitations and decisions for review. This was a validation-period analysis, not holdout evaluation. No strategy thresholds were changed. Next: improve reproducibility and assess timing using finer-resolution data before deciding on holdout.

## 2026-11-09 — Codex — one-hour validation timing sensitivity

Re-ran the existing selected BTC 28-day and ETH 14-day validation rules with fills proxied by the 01:00 UTC hourly open on each signal day. The 36 hourly archives passed published SHA-256 sidecar checks and expected-day coverage checks. Modeled net returns were 234.09% and 27.10%, respectively. The original daily-boundary runs returned 242.83% and 28.35%. Hourly opening prices are execution proxies, not real fills. Four baseline fixture tests passed, and rerunning the sensitivity script gave identical displayed results. Final holdout remains sealed. Next: strengthen timing fixture tests and freeze the holdout protocol before evaluation.

## 2026-11-09 — Codex — frozen historical holdout

Committed HOLDOUT_PROTOCOL.md before accessing the holdout, and added a fixture verifying the assumed execution-price change leaves signal timing unchanged. Ran selected BTC 28-day and ETH 14-day rules on 2024-07-01 to 2026-10-31, then the specified 2x costs and one-hour execution-price sensitivities. Main results: BTC +7.90%, buy-and-hold +23.41%, maximum close drawdown 31.44%; ETH +30.17%, buy-and-hold -34.49%, drawdown 44.91%. Results and dataset hashes are recorded in holdout-results.json and holdout-timing-results.json. These are modeled returns, using a quote-token cash balance, not actual fills. Five Python fixture tests passed. The test window is now consumed. Next: review methodology and decide whether to proceed to prospective shadow observations; never re-tune on this holdout.
