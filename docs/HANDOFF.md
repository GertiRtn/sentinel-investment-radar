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
