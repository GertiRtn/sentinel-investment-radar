# Sentinel — Work Order 03

**Scope:** Fix three open defects, then build the EDGAR ingest and the kill-criteria evaluator.
**Date:** 16 September 2026 · **Supersedes nothing** — this is additive to the Build Standard v2.0.
**Audience:** the build agent. This document is self-contained; no prior conversation is assumed.

---

## 0. Context — what already exists and must not break

Verified by independent read-only inspection on 16 Sep 2026. These properties are load-bearing. **Any change that weakens one of them is a regression, regardless of what it enables.**

| Property | Status | Evidence it currently holds |
|---|---|---|
| Server-side persistence | ✅ Working | `POST /api/workspace` → 200; `localStorage.saved` stays `[]` while items survive hard reload |
| Journal immutability | ✅ Working | No edit/delete control exists; no PUT/PATCH/DELETE on any endpoint |
| Point-in-time queries | ✅ Working | Cutoff at 13:15 returns $76,082.815 vs live $75,951.16; pre-recording cutoffs return empty, not backdated |
| Raw capture + integrity | ✅ Working | `Inspect original response` returns stored body with SHA-256 matching the rendered value |
| Provenance fields | ✅ Working | Per-quote `rawEventId`, `knownFrom`, `stale`, `reconciliation`; per-source `lastGoodAt`, `retryAt`, `failures`, `stale` |
| Server-side proxy | ✅ Working | Zero browser-originated external requests |
| Honest absence | ✅ Working | "No dedicated topic source connected… This is limited source coverage, not evidence that nothing happened." |

**Hard constraints carried into all work below:**

1. **Nothing is ever mutated.** No `UPDATE`, no `DELETE` on captured data, facts, journal entries, or criterion trips. Change is expressed by appending a superseding record.
2. **`known_from` governs every read.** Any query must be answerable as of a past timestamp using only records where `known_from <= T`.
3. **Unevaluable is not passing.** A check that cannot run returns `unknown` and displays as unknown. It never returns `pass`, and never renders as a blank or a green state.
4. **No value reaches the UI without provenance** — source, source timestamp (or explicit null), ingest timestamp, staleness.
5. **Credentials stay server-side.** No key in a client bundle, in `localStorage`, or in any user-visible field.

---

# PART A — Three defects to close first

Do these before starting Part B. Two are small; the third is a design decision that gets harder to reverse later.

## A1. The 503s are not fixed (defect D-03)

`/api/market` and `/api/news` returned HTTP 503 twice each during an 11-minute window — the same failure rate observed before retry logic was added. The schema now carries `retryAt` and `failures`, but 503s still reach the browser.

**Diagnose before patching.** There are two distinct causes with different fixes:

| Cause | How to tell | Fix |
|---|---|---|
| Upstream (Coinbase/ECB/Fed) failing | 503 body is your application's JSON error shape; `failures` increments | Server-side retry with backoff — may already be working |
| Your own endpoint failing | 503 body is the hosting platform's error page, not your JSON; `failures` stays 0 | Application retry cannot help. See below. |

If it is the second — which the unchanged failure rate suggests — the fix is architectural, and you now have what you need for it:

- **Serve reads from the durable store, not from an upstream fetch.** `GET /api/market` should return the latest stored fact immediately, with `knownFrom` and `stale`. Refreshing upstream becomes a separate concern from serving a request. This removes the upstream call from the request path entirely and makes the endpoint fast and near-unfailable.
- **Add a client-side retry** on both fetches: 3 attempts, exponential backoff with jitter (e.g. 400ms / 1200ms / 3500ms ±25%).
- **On exhausted retries, render the last known value marked stale with its age.** Never render nothing; never render a stale value as fresh.

**Acceptance:** with upstream unreachable, the UI shows the last good value, correctly labelled stale with age, and `failures` increments. Zero unhandled 503s reach the user across a 1-hour observation.

## A2. The stale path has never executed

Every source reported `stale:false`, `failures:0` throughout both inspections, so the degraded-state rendering has never run. An untested error path is an error path that does not work.

**Add a forced-failure test mode**, server-side only, not reachable from the UI:

```
SENTINEL_FORCE_FAIL=coinbase:BTC    # env var or admin-only flag
```

**Acceptance:** with the flag set, within one poll cycle — the BTC card renders a visible stale badge with age; `failures` increments; `retryAt` populates; `lastGoodAt` stays at the last real success; the stored value does not change; and after three consecutive failures an operational incident record appears in Data history. Clearing the flag returns everything to normal within one cycle. Record the test in the journal as a `decision` entry.

## A3. Prediction resolution — append, never mutate

There is currently **no way to resolve a prediction**, so Brier scoring is unreachable despite the UI promising it ("Brier score is calculated only after you record an outcome").

**The trap:** the obvious implementation is to set `outcome` on the existing prediction row. That is a mutation and it silently destroys the immutability guarantee that was just built and verified.

**Required implementation — resolution is a new record:**

```json
POST /api/journal
{
  "kind": "resolution",
  "resolves_id": "<prediction entry id>",
  "outcome": 1,
  "evidence": "Source and observation that settles it",
  "resolution_source_url": "https://…"
}
```

Rules:

- `resolved_at` is set **server-side**, never from the browser clock.
- The prediction record is never touched. The UI joins prediction → resolution for display.
- A prediction may have **at most one** non-superseded resolution. A correction is a second `resolution` record carrying `supersedes_id` pointing at the first. Both remain retrievable.
- Brier is computed from the join at read time: `(p − o)²`. Never stored as a field on the prediction.
- A prediction past its `resolution_date` with no resolution renders as **`Overdue — unresolved`**. Do not auto-resolve, and do not let it quietly disappear from the list. Unresolved predictions are the ones most likely to have been wrong, and dropping them is how a calibration record flatters its owner.

**Acceptance:** resolve a prediction; the original text and probability remain byte-identical; the Brier score appears; submitting a second resolution with `supersedes_id` shows the corrected outcome while both records remain in the history view.

## A4. Minor — counter clarity

`All updates` shows 12 cards while the header reads `Official releases (35)` and the coverage line reads `24 retrieved items dated within 30 days`. Three numbers on one screen with no stated relationship. Relabel the list **"Latest 12 of 35 retrieved"** and keep the 30-day line as is.

---

# PART B — EDGAR ingest

This is the first source that feeds the research core. It is free, requires no negotiation, and it is what makes Part C possible.

## B1. API surface

Base: `https://data.sec.gov`

| Purpose | Endpoint |
|---|---|
| Ticker → CIK map | `https://www.sec.gov/files/company_tickers.json` |
| Filing history | `/submissions/CIK##########.json` |
| All XBRL facts for a company | `/api/xbrl/companyfacts/CIK##########.json` |
| Single concept | `/api/xbrl/companyconcept/CIK##########/us-gaap/{Tag}.json` |

**CIK must be zero-padded to 10 digits** in the path (`320193` → `CIK0000320193`).

**Mandatory request header.** SEC blocks clients that omit it:

```
User-Agent: Sentinel Research <your-real-email>
Accept-Encoding: gzip, deflate
```

**Rate limit: 10 requests/second.** Implement a token bucket. Exceeding it gets your IP blocked, and the block is not instant to clear.

Cache `company_tickers.json` daily — it is large and changes slowly.

## B2. The three traps that will otherwise corrupt everything

### Trap 1 — `filed`, not `end`, sets `known_from`

Each XBRL fact looks like:

```json
{"start":"2023-01-01","end":"2023-12-31","val":383285000000,
 "accn":"0000320193-24-000006","fy":2024,"fp":"FY",
 "form":"10-K","filed":"2024-11-01","frame":"CY2023"}
```

A figure describing the period ending **2023-12-31** was not knowable until **2024-11-01**. Setting `known_from` from `end` introduces look-ahead bias into every historical query and every future backtest, and it will not announce itself.

```
fact.period_end  = entry.end
fact.known_from  = entry.filed     ← REQUIRED
```

### Trap 2 — restatements produce multiple facts for the same period

The same `end` date appears repeatedly with different `accn` and `filed` values as figures are restated. **Store all of them.** Do not deduplicate to "the latest."

Resolution rule for a point-in-time read at time `T`:

> Select the fact for that `(entity, metric, period_end)` with the greatest `filed` where `filed <= T`.

This is exactly what makes "what did we know in March" answerable. The supersession chain is the feature, not noise.

### Trap 3 — tag names vary by company and by year

There is no single revenue tag. Define a resolution order per metric and **record which tag actually produced each value**:

```
revenue: [
  "RevenueFromContractWithCustomerExcludingAssessedTax",
  "RevenueFromContractWithCustomerIncludingAssessedTax",
  "Revenues",
  "SalesRevenueNet",
  "SalesRevenueGoodsNet"
]
operating_income:  ["OperatingIncomeLoss"]
net_income:        ["NetIncomeLoss"]
cfo:               ["NetCashProvidedByUsedInOperatingActivities"]
capex:             ["PaymentsToAcquirePropertyPlantAndEquipment"]
depreciation:      ["DepreciationDepletionAndAmortization",
                    "DepreciationAmortizationAndAccretionNet"]
cash:              ["CashAndCashEquivalentsAtCarryingValue"]
total_debt:        ["LongTermDebtNoncurrent" + "LongTermDebtCurrent",
                    "DebtLongtermAndShorttermCombinedAmount"]
equity:            ["StockholdersEquity"]
tax_expense:       ["IncomeTaxExpenseBenefit"]
pretax_income:     ["IncomeLossFromContinuingOperationsBeforeIncomeTaxes" +
                    "ExtraordinaryItemsNoncontrollingInterest"]
ppe_net:           ["PropertyPlantAndEquipmentNet"]
shares_diluted:    ["WeightedAverageNumberOfDilutedSharesOutstanding"]
```

Store `source_tag` on every derived fact. When a number looks wrong in two years, the tag is the first thing you will need.

If no tag in the list resolves, the metric is **`unavailable`** for that period. Never substitute zero, never interpolate, never fall back to a different concept silently.

## B3. Schema additions

```sql
CREATE TABLE entity (
  id            TEXT PRIMARY KEY,        -- canonical internal id
  cik           TEXT UNIQUE,
  name          TEXT NOT NULL,
  tickers       TEXT,                    -- JSON array
  exchanges     TEXT,                    -- JSON array
  sic           TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE filing (
  id            TEXT PRIMARY KEY,
  entity_id     TEXT NOT NULL REFERENCES entity(id),
  accession      TEXT NOT NULL UNIQUE,   -- accn
  form          TEXT NOT NULL,           -- 10-K, 10-Q, 8-K…
  filed_at      TEXT NOT NULL,
  period_end    TEXT,
  raw_event_id  TEXT NOT NULL REFERENCES raw_event(id)
);

-- Append-only. Restatements append; nothing is updated.
CREATE TABLE financial_fact (
  id            TEXT PRIMARY KEY,
  entity_id     TEXT NOT NULL REFERENCES entity(id),
  metric        TEXT NOT NULL,           -- canonical name, e.g. 'revenue'
  source_tag    TEXT NOT NULL,           -- the us-gaap tag actually used
  value         REAL,
  unit          TEXT NOT NULL,           -- 'USD', 'shares' — never bare
  period_start  TEXT,
  period_end    TEXT NOT NULL,
  fiscal_year   INTEGER,
  fiscal_period TEXT,                    -- FY, Q1…
  form          TEXT NOT NULL,
  known_from    TEXT NOT NULL,           -- = entry.filed
  accession     TEXT NOT NULL,
  raw_event_id  TEXT NOT NULL REFERENCES raw_event(id),
  UNIQUE(entity_id, metric, period_end, accession)
);

CREATE INDEX idx_ff_pit ON financial_fact(entity_id, metric, period_end, known_from);

-- Computed, cached, always recomputable from financial_fact.
CREATE TABLE derived_metric (
  id, entity_id, metric, value, unit, period_end,
  known_from,                            -- = max(known_from) of all inputs
  inputs_json,                           -- {input_metric: financial_fact.id}
  method,                                -- formula identifier + version
  confidence                             -- 'computed' | 'estimated' | 'unavailable'
);
```

`derived_metric.known_from` is the **latest** `known_from` among its inputs. A ratio is not knowable before its slowest component.

## B4. Derived metrics

Compute, cache, and always record `inputs_json` so any figure can be traced back to its filings.

```
effective_tax_rate = tax_expense / pretax_income
NOPAT              = operating_income × (1 − effective_tax_rate)
invested_capital   = (total_debt + equity) − excess_cash
                     where excess_cash = max(0, cash − 0.02 × revenue)
ROIC               = NOPAT / average(invested_capital[t], invested_capital[t−1])
incremental_ROIC   = (NOPAT[t] − NOPAT[t−k]) / (IC[t] − IC[t−k])    k = 3 to 5 years
cash_conversion    = cfo / net_income
net_debt           = total_debt − cash
gross_margin       = (revenue − cogs) / revenue
share_count_yoy    = shares_diluted[t] / shares_diluted[t−1] − 1
```

**Owner earnings** requires `maintenance_capex`, which cannot be derived from XBRL. Do **not** default it to depreciation.

```
maintenance_capex: confidence = 'unavailable' until a human enters an
                   estimate plus its triangulation method.
owner_earnings   : confidence = 'unavailable' while maintenance_capex is.
```

Show it as unavailable with a prompt to supply an estimate. A wrong owner-earnings figure is worse than none, because it looks authoritative.

**Excess-cash rule:** the 2%-of-revenue operating-cash assumption is a convention, not a truth. Record `method` so it can be revisited, and display the assumption on the company file.

## B5. Ingest job

```
1. Resolve identifier → CIK (ticker map, cached daily)
2. GET /submissions/CIK{padded}.json      → raw_event, then entity + filing rows
3. GET /api/xbrl/companyfacts/CIK{padded}.json → raw_event (store gzipped; these are large)
4. Walk facts[us-gaap][tag][units][unit][] :
     - resolve tag → canonical metric via B2 Trap 3 order
     - insert financial_fact with known_from = entry.filed
     - UNIQUE(entity, metric, period_end, accession) makes re-ingest idempotent
5. Recompute derived_metric for affected periods
6. If any new filing arrives → trigger kill-criteria evaluation (Part C)
```

Run on watchlist entities: daily is ample. Filings arrive on business days; nothing is gained by polling faster, and the rate limit is real.

## B6. Watchlist must accept arbitrary entities

Currently only six fixed illustrative cards can be saved.

```
POST /api/watchlist  {"identifier": "ASML" | "0000937966" | "US0378331005"}
→ resolves → creates entity + triggers ingest → returns entity_id
```

Resolution order: exact ticker match → CIK → ISIN. On ambiguity, return candidates and ask; never guess. **Store the canonical `entity_id`, never the ticker** — tickers change hands and get reused.

Non-US entities have no CIK. Mark them `coverage: none` with an explicit message: *"No filing source connected for this jurisdiction."* Do not silently create an entity with no data behind it.

## B7. Acceptance criteria — Part B

- [ ] Three US companies ingested; ten years of revenue, operating income, CFO, capex, net debt and share count visible
- [ ] Every displayed figure shows its `source_tag`, `accession`, `form` and `filed` date
- [ ] **Look-ahead test:** query FY2023 revenue as of 2024-06-01 (before the 10-K was filed) → returns **not yet known**, not the value
- [ ] **Restatement test:** a metric with two `accn` for the same `period_end` returns the earlier value for a `T` between the two filing dates
- [ ] Re-running ingest twice produces zero duplicate rows
- [ ] A company with a missing tag shows `unavailable`, not zero
- [ ] `owner_earnings` shows `unavailable` until maintenance capex is entered by hand
- [ ] Rate limiter never exceeds 10 req/s under a 3-company backfill
- [ ] `User-Agent` header present on every SEC request

---

# PART C — Kill-criteria evaluator

This is the feature the platform exists for. It converts a written thesis into a monitored condition, checked automatically against filings, and it is the only alert type that is worth waking someone up for.

## C1. Predicate format

Stored as JSON against a memo. Deliberately small — no arbitrary expressions, no user-supplied code.

```json
{
  "all": [
    {"metric":"net_debt_to_ebitda","op":">","value":3.5,"consecutive_periods":2},
    {"metric":"cash_conversion","op":"<","value":0.7,"consecutive_periods":2},
    {"metric":"gross_margin","op":"<","value":0.34},
    {"metric":"share_count_yoy","op":">","value":0.02},
    {"event":"auditor_change"},
    {"event":"late_filing"},
    {"event":"material_weakness_disclosed"}
  ]
}
```

- Top-level `all` / `any` — one level of nesting only.
- `op` ∈ `> >= < <= == !=`
- `consecutive_periods` defaults to 1. Periods are consecutive **fiscal** periods with data; a gap breaks the streak rather than being skipped over.
- `event` predicates are matched against filing metadata and 8-K item codes, not against free text.

## C2. Evaluation semantics — the part that must be exactly right

```sql
CREATE TABLE criterion_evaluation (   -- append-only
  id, kill_criterion_id, evaluated_at, as_of,
  result,          -- 'pass' | 'trip' | 'unknown'
  reason,          -- human-readable, always populated
  inputs_json,     -- every fact id consulted
  triggering_filing_id
);
```

**Three outcomes, never two:**

| Result | Meaning | Behaviour |
|---|---|---|
| `pass` | Condition evaluated and is not met | Silent |
| `trip` | Condition evaluated and is met | **Immediate alert** |
| `unknown` | Could not be evaluated — missing metric, missing period, unavailable tag | **Surfaced prominently, never silent** |

**`unknown` is the dangerous state and must never look like `pass`.** A kill criterion that silently cannot evaluate means the safety net you believe is in place is not there. Requirements:

- The memo view shows a persistent banner: **"N of M kill criteria cannot currently be evaluated"**, with the reason per criterion.
- If a criterion is `unknown` for **two consecutive evaluation runs**, raise an operational alert.
- `unknown` never renders green, never renders as a blank cell, and never counts toward "all clear."

**Trips are permanent.** When a criterion trips, append a `trip` evaluation. If a later restatement would un-trip it, **do not retract**. Append a new evaluation with `result: 'pass'` and a `supersedes_id`. The trip stays in the record with its original timestamp. You need to know that it tripped, and when, even if the number was later revised — especially then.

**Evaluation is point-in-time.** Every evaluation reads facts with `known_from <= as_of`. Re-running an evaluation for a past `as_of` must reproduce the identical result. This is what makes the evaluator testable at all.

## C3. Edit discipline

Kill criteria may not be edited while a position is open without a dated written justification.

```sql
CREATE TABLE kill_criterion (
  id, memo_id, predicate_json, created_at,
  superseded_by REFERENCES kill_criterion(id),
  supersede_reason,       -- required and non-empty when superseding
  superseded_at
);
```

Editing appends a new criterion and links the old one. The original is never deleted and remains visible in the memo's history. Loosening a criterion after it trips is the single most predictable failure mode in this whole system, and the record is what makes it visible to you afterwards.

## C4. Alert generation

A `trip` produces an **Immediate**-tier alert. Content is fixed and contains no instruction:

```
KILL CRITERION TRIPPED — {company}

Condition you defined on {created_at}:
  {human-readable predicate}

Current value:  {value}  ({period_end}, filed {filed})
Threshold:      {op} {threshold}
Streak:         {n} of {consecutive_periods} consecutive periods

Your thesis assumed: {relevant memo line}

Source: {form} {accession} — {link}

This is a research record, not a trade instruction.
Acting on it requires a decision session and the cooling-off interval.
```

No "sell", no "consider reducing", no price target. The condition and the number are the entire message.

## C5. Acceptance criteria — Part C

- [ ] A criterion built against known historical data **fires on the exact filing that should trigger it** and not before
- [ ] Re-evaluating any past `as_of` reproduces the identical result
- [ ] A criterion referencing an unavailable metric returns `unknown`, surfaces the banner, and **never returns `pass`**
- [ ] `consecutive_periods: 2` does not fire on a single breach, and does fire on the second
- [ ] A restatement that would un-trip appends `pass` with `supersedes_id`; the original trip remains visible with its original timestamp
- [ ] Editing a criterion without a `supersede_reason` is rejected
- [ ] An alert renders with source, accession and filing date, and contains no action language
- [ ] `unknown` never renders in a green or neutral state anywhere in the UI

---

# PART D — Explicit non-goals

Do not build these now, even if they seem adjacent. Each depends on something above, or on a decision not yet made.

- Background scheduling and external delivery (Telegram/push) — next work order
- Decision gates, cooling-off enforcement, portfolio limits — depends on memos existing
- Any price feed for equities or gold — requires a paid provider not yet chosen
- Any breaking-news source beyond ECB/Fed — requires a licensed feed; out of budget
- Event→company exposure mapping — depends on segment data from Part B
- Any model-generated number, probability, or forecast anywhere in the system
- Any composite score
- Any Tier 5 source (social media, price commentary, TV)

---

# Build order

| # | Item | Depends on | Rough effort |
|---|---|---|---|
| 1 | A1 — diagnose and fix 503s | — | half day |
| 2 | A3 — resolution as append | — | half day |
| 3 | A2 — forced-failure test | A1 | 2 hours |
| 4 | A4 — counter labels | — | 30 min |
| 5 | B1–B3 — EDGAR ingest, schema, raw capture | — | 2–3 days |
| 6 | B4 — derived metrics | B3 | 1–2 days |
| 7 | B6 — arbitrary watchlist entities | B1 | half day |
| 8 | C1–C2 — predicate evaluator | B4 | 2 days |
| 9 | C3–C4 — edit discipline, alert format | C2 | 1 day |

A3 is listed early on purpose. Every prediction recorded before resolution exists is one that cannot be scored, and the journal is already accepting entries.

---

## Verification

When this work order is complete, the following must hold simultaneously. Report against each, with evidence:

1. Zero unhandled 503s reach the user across one hour
2. A forced source failure renders a stale badge and increments `failures`
3. A resolved prediction shows a Brier score; the original prediction is byte-identical
4. FY2023 revenue queried as of 2024-06-01 returns "not yet known"
5. A restated metric returns the period-appropriate value for any historical `as_of`
6. A kill criterion fires on the correct filing and reproduces on re-evaluation
7. An unevaluable criterion shows `unknown` and a banner, never `pass`
8. Every displayed financial figure traces to a tag, accession and filing date
9. No mutation occurred: no UPDATE or DELETE against `raw_event`, `financial_fact`, `journal`, or `criterion_evaluation`

State plainly which of these you could not verify and why. An unverified item reported as passing is worse than a failure reported honestly — the whole point of this system is that its own record can be trusted.
