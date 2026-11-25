# Research evaluation, stage 1 (2026-11-25)

Founder brief "SENTINEL RESEARCH EVALUATION: stage 1". Phase 1 was a read-only audit; this records its findings, what Phase 2 built, and what is still missing. Branch `research-eval-stage1` (from main 3c37b8f). Nothing is merged, deployed or published. The running Practice experiment (`auto-practice-v1`) and its rules are untouched.

**No result in this document uses real data.** Production D1 is not reachable from the development sandbox, and neither is Alpaca. Every figure below comes from synthetic fixtures and is labelled as such.

---

## 1. Audit findings (Phase 1)

### Defects in the offline harness (`scripts/research/harness.mjs`, harness-v1)

Each was shown on a synthetic probe before any change:

| # | Defect | Synthetic demonstration |
|---|---|---|
| 1 | Outcome windows crossed into the next set. The 30-day calendar embargo could not see a 60-session window. | Last train window ended 2020-10-20; validation started 2020-08-28. |
| 2 | Costs were charged to the stock only. A stock that exactly matched SPY looked like a loss. | Stock = SPY = +5% showed −0.3148% excess. |
| 3 | Invalid rows were accepted (NaN, missing SPY, returns of −100% or worse). | n = 41 rows, status "computed", average NaN. |
| 4 | The median of an even count took the upper middle value. | Median reported as 9.670%; the true value is about 4.97%. |

The interval was also a plain bootstrap by date, which understates uncertainty when windows overlap.

### Data and design limits (not code defects)

- **Too early for a test.** `research-screen-v2` has existed since 2026-11-12, so no 20-interval outcome for a screen-v2 case can exist before about 2026-12-11 (29 calendar days). Older 5-interval outcomes are mostly screen v1, and screen v1 measured data completeness (known issue 1).
- **Overlap.**
  - Hourly cases produce overlapping windows.
  - The same company can appear several times within a few days.
- **Point-in-time gaps.**
  - Company identity uses SEC's *current* ticker list.
  - Delisted coverage on IEX is unknown.
  - There is no point-in-time universe.
  - Re-fetched bars carry later adjustments: returns stay right, but price levels shift.
- **News label version.** Cases before 2026-11-15 have no stored news-direction label. Their label is computed from their stored text with the current version.
- **Experiments.** `auto-practice-v2` (#41) is not on main; v1 is the only experiment running.

---

## 2. What Phase 2 changed

### `lib/sentinel/research-stats.ts` (`research-stats-v1`, new, pure)

Shared by the harness and the selection comparison, so both apply one set of rules:

- **Costs (`afterCosts`, `excessAfterCosts`).** 15 bp per side on both the stock and SPY, so a stock matching SPY shows exactly zero.
- **Validity (`validReturn`, `validDay`).** A return must be finite and above −100%. A date must be a real `YYYY-MM-DD` day.
- **`median`.** For an even count, the average of the two middle values.
- **`blockBootstrap` / `blockBootstrapMean`.** Circular moving-block bootstrap over time-ordered decision dates, seeded so the same data gives the same interval.
- **`overlapBlockLength`.** Sets the block length to the median number of decision dates inside one outcome window.

### `scripts/research/harness.mjs` (`harness-v2`)

- Rows now carry `exitDate`. **Purging:** an earlier-set row is kept only if its whole window ends before the next set starts (minus an optional `embargoDays`). Purged rows are counted.
- `validateRows` rejects invalid rows with a reason. Rejected rows never reach a figure and cannot lift a set over the minimum.
- `evaluate` uses the shared costs, the shared median and the block-bootstrap interval. `finalTest` reports the version, the purged and rejected counts, and the updated gate rule.

### Selection comparison (`selection-comparison-v1`, new)

**Code:** `lib/sentinel/selection-comparison.ts` (pure) and the route `GET /api/selection-comparison?horizon=5|20|60|120` (default 20; owner-scoped; read-only; on request only; no page uses it).

**Question:** over one horizon, were cases that met the idea rules followed by a different return against SPY than the cases assessed and not selected, after the same simulated costs?

**Universe:**
- Included: `research-screen-v2` cases whose ticker matched one SEC company.
- Counted and left out: first-screen cases, unmatched tickers, and probable wrong-company reports (`name_conflict`).

**Groups:**
- **Selected:** meets `idea-select-v2`'s rules from stored fields. The test is `meetsIdeaRules`, now exported from `idea-select.ts` and used by the idea list itself, so the two cannot drift.
- **Not selected:** every other compared case: Watch, Waiting for data, neutral, bad and mixed news.

**SPY:** measured on each outcome's own matched dates.

**Checks on every outcome record:**
- Same symbol as the case.
- **Entry strictly after the case's UTC date.** This is the leak guard against information from before the decision.
- Exit after entry, on a completed session.
- Finite returns above −100%.
- Benchmark is SPY.
- `matchedDates` covers exactly the horizon, starts at entry, ends at exit, and is in order.
- One record per case and horizon.

Every rejection is listed with its reason.

**Missing outcomes:** split into *not yet due* and *due with no record*. A missing outcome is never counted as a gain or a loss.

**Same company:**
- Within a group, a later case is left out while the same company's earlier window is still open. It is counted as left out.
- Overlaps across the two groups are counted.

**Horizons:** one per comparison; never pooled.

**News-direction version:**
- Every compared case records `labelVersion`, `labelSource` (stored or computed from its stored text) and `storedLabelVersion`.
- If the compared cases carry more than one version, the status is `mixed_label_versions` and only counts are returned.

**Below 20 usable outcomes in either group:** `counts_only`, with no average, median, share or interval, and the exact shortfall stated (for example "Selected: 12 usable outcomes at 5 trading-day intervals; 20 needed.").

**From 20 in each group:**
- Per group: gross and after-cost averages for the stock and SPY, average and median excess after costs, and the share above SPY.
- A block-bootstrap interval for each group, plus the difference between the groups with its own block-bootstrap interval over shared entry dates.

**Fixed text:** what the comparison can and cannot establish. It cannot establish:
- That the rules caused a difference: the groups also differ in data completeness, news wording and company type.
- Anything about other periods, horizons or versions.
- Returns anyone could have achieved: these are IEX daily closes with simulated costs, not fills.
- Any forecast.

### Tests (all synthetic, labelled)

- **`tests/research-harness.test.mjs`** (6 tests, rewritten):
  - One test for each of defects 1–4.
  - The block bootstrap: wider than the date-level one on a persistent series, deterministic, block length about 10 for 28-day windows with decisions every 3 days.
  - The gate: a planted 3% effect passes; no effect does not; reproducible.
- **`tests/selection-comparison.test.mjs`** (10 tests):
  - The rule is the idea list's rule.
  - Counts only below 20.
  - A planted edge is found, and zero edge gives zero.
  - The future-information guard.
  - Invalid and misaligned records.
  - Not yet due vs due with no record; other horizons are excluded.
  - Same-company overlap.
  - The universe exclusions.
  - Label versions, including the refusal to pool.
  - Banned words.
- **`tests/work-order03.test.mjs`** (+1 Miniflare route test):
  - Owner scoping and a 400 for a bad horizon.
  - Counts only at 12 selected; figures at 20.
  - Default horizon 20.
  - Label source stored vs computed.
  - Nothing written.
  - Banned words in every returned string.

### Methods and licences

Purging overlapping windows and the moving-block bootstrap are standard methods, also covered in *Machine Learning for Trading* (stefan-jansen). **No code was copied** from that repository, awesome-quant or FinceptTerminal, so their licences (including Fincept's AGPL) do not apply to this change. No data source was added, and the budget is unchanged at $0.

---

## 3. Defect documented, not fixed (founder decides separately): decision-replay entry price

**Where:**
- `replayDecisions` in `lib/sentinel/decision-run.ts` (line 214) sets the entry to the last IEX close completed **at or before** the case time: `closes.filter(d => closeInstant(d) <= k.created_at).at(-1)`.
- `performance()` in `lib/sentinel/decision-snapshot.ts` measures from that close to the latest available close.

**Consequence:**
- The replay credits price moves that happened **before** the decision could have been acted on.
- **Example:** a case assessed at 10:00 New York time on a day the stock jumped 8% on pre-market news. The replay enters at the *previous* day's close, so the 8% jump counts as a result of the decision, though nobody could have acted at that price.
- The same applies to every case assessed during a session or overnight. The bias favours cases that follow good news, which is exactly what the idea rules select, so replay figures would overstate the selected group.
- Exits are "latest available close", so replay windows also differ in length from case to case and are not comparable with each other.

**Proposed fix (not applied):**
- Enter at the close of the first full session that **completes after** the case time. This is the rule the outcome records already use (`compareForwardBars`: first matched close after the case's UTC date) and the rule `auto-practice-v2` specifies.
- Give replay windows a fixed horizon (5/20/60/120 matched sessions) instead of "latest".
- Version it (`decision-replay-v2`), and never mix v1 and v2 replay figures.
- Stored `decision_snapshot` records stay unchanged (append-only). Only the on-demand replay view changes.

Until it is fixed, the replay view is not used in this evaluation. The selection comparison reads only the outcome records.

---

## 4. Real-data result

**None.** What is missing:

1. **Access.** The comparison runs only where the data is: on the Site, after this branch is merged and deployed (not done; the founder decides). Signed in as the owner, open `/api/selection-comparison?horizon=5` and `?horizon=20`.
2. **Enough outcomes.** At least 20 usable outcomes in *each* group at one horizon.
   - 5 intervals: screen-v2 cases from 2026-11-12 become due from about 2026-11-20.
   - 20 intervals: from about 2026-12-11.
   - How many good-news, rule-meeting cases exist is unknown here. Before 2026-11-13, every off-hours case was WAIT (known issue 7), so the selected group may stay below 20 for weeks.
3. **Outcome capacity.** At most 8 (case, horizon) pairs per hourly run, so many cases will show "due with no record" for a while. That is a capacity count, not a loss.

---

## 5. Before a predictive model can be tested

1. Enough selected and not-selected outcomes at 20 intervals: at least 20 per group to show anything; the harness gate needs 30 selected on an untouched test set.
2. A point-in-time universe and ticker history (identity currently uses SEC's current list), and a known treatment of delisted companies.
3. The decision-replay entry fix above, if replay figures are ever used.
4. Stored label versions on every new case (news direction since 2026-11-15; keep doing so for any new label). Never pool versions.
5. A rule frozen in writing before the test set is read (`finalTest` enforces this), then a prospective check: a new virtual experiment with its own ledger (`auto-practice-v2` or later), compared with the outcomes of all assessed cases (invariant 10).
6. Only then any model, and its output stays out of the UI until the founder approves (invariants 5–7).
