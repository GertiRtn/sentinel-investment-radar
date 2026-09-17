# Sentinel — Build Standard & Best Practices

**Owner:** Gerti · **Version:** 2.0 · **Date:** 16 September 2026
**Supersedes:** v1.0 (16 Sep 2026), now merged with verified observation of the running app.
**Purpose:** The engineering and investment-discipline standard for a personal investment research platform, anchored on what is actually deployed.

---

## What changed in v2.0

v1.0 was written blind. This version is anchored on a read-only inspection of the live app (16 Sep 2026, 12:09–12:20 BST), which resolved every open question about what is real.

**The headline finding: the discipline layer is already built and is genuinely good. The data and persistence layers are nearly absent.**

That is an unusual and favourable position. Most people build the opposite — a feature-rich app with dishonest labelling — and honesty never gets retrofitted. You have the hard-to-add half. What remains is ordinary engineering.

New in this version: §0 (verified state audit), concrete API contracts extending what exists (§2.4, §4.5), the persistence migration as the critical path (§2.3), §13 (defect log with severities), and a build sequence rewritten as a code-ready backlog.

---

## 0. Verified current state

### 0.1 Confirmed working, with live external data

| Component | Evidence |
|---|---|
| `/api/market` → Coinbase BTC/ETH | 5 distinct price points over 10 min; matched CoinGecko within **0.024%** on a 6-second paired read |
| `/api/news` → ECB + Fed RSS | 24 items, real resolvable press-release URLs, `"mode":"public-feeds"` |
| Source status reporting | 4 chips backed by `"status":"available"` + `checkedAt` in payload |
| Manual refresh | Real network round-trip, updates timestamps |
| Category filtering | Genuinely filters; reaches items beyond the default view |
| Radar search | Filters correctly, correct empty state |
| Bookmark persistence | Writes `localStorage`, survives hard reload |

### 0.2 Confirmed absent

Background monitoring · notification delivery · any alert rule engine · alert history · gold and equity prices · broad news coverage · broker/Revolut link · prediction validation · arbitrary ticker entry · any server-side persistence.

All six Connections items are **descriptive text with a status badge** — no connect button, no form, no key field anywhere in the app.

### 0.3 Architecture as built

```
Browser (Next.js SPA)
   └── GET /api/market   ─┐
   └── GET /api/news     ─┴→ server-side proxy → Coinbase / ECB / Fed
   └── localStorage["sentinel-workspace-v1"]
         {saved:[], notes:{}, digest:true, urgent:true}
```

**Zero browser-originated external requests.** Every upstream call goes through the app's own origin. This is the correct pattern and it was already chosen — credentials never reach the client.

### 0.4 Compliance against the principles in §1

| Principle | Status | Evidence |
|---|---|---|
| 1.1 Provenance or it doesn't render | **Largely met** | `receivedAt`, `checkedAt`, `source` on every quote; `sourceTimestamp: null` honestly recorded rather than faked |
| 1.2 Absence displayed as absence | **Met** | "Provider required", "Risk unknown", "Unavailable — no live market feed" |
| 1.3 No composite scores | **Met** | No score anywhere in the app |
| 1.4 Alerts inform, never instruct | **Met** | Sample alert contains no action; "Evidence required" on every radar card |
| 1.5 Friction before action | **Not built** | No decision flow exists yet |
| 1.6 "Wait"/"already moved" first-class | **Partially met** | Copy says it; no computed already-moved check |
| 1.7 Record before you know | **Not possible** | No server store — see §2.3 |
| 1.8 Information hierarchy enforced | **Met** | Tier 1 only ingested; no Tier 5 anywhere |

Six of eight, in an app that was never given these principles. Keep whoever wrote the copy.

### 0.5 The two findings that should change your plan

**Finding 1 — `Digital assets`: 0 results. `Trade & geopolitics`: 0 results.**

Your two highest-priority topics return nothing, from the only sources that are connected. This is not a bug. ECB and the Fed do not publish about crypto policy or tariffs at any useful frequency. It is the free tier's coverage boundary, rendered as an empty state. Closing it costs licensed-wire money (§3.2), not engineering.

**Finding 2 — the interpretation layer is a lookup table.**

Two different articles returned **byte-identical** expander text. The body is keyed to the topic badge, not the article. Four topic badges exist, so there are at most four possible explanations. The app says so ("Topic explanations use headline keywords"), and the label is accurate — but this means the "what does this mean" feature does not currently exist in any form.

---

## 1. Design principles (non-negotiable)

Constitutional. A feature violating one is rejected, however useful it looks.

**1.1 Provenance or it doesn't render.** Every value displays source, source publication timestamp, ingest timestamp, and staleness. Including derived values: a computed ROIC shows which filing and which XBRL tags produced it. *Already largely honoured — extend the existing pattern rather than inventing a new one.*

**1.2 Absence is displayed as absence.** Missing data renders as "not available," never blank, zero, or a neutral default. A check that could not run shows **"unknown"** — never **"pass."**

**1.3 No composite scores.** Separate, independently-sourced assessments: business quality, balance-sheet resilience, valuation, catalyst, risk. A composite hides which input is weak, which is the one you needed to see.

**1.4 Alerts inform; they never instruct.** No "buy," "sell," "opportunity," or price target. State what happened, what is confirmed, what is inferred, what would falsify it, and how price already responded.

**1.5 Friction before action, not after.** At the moment of excitement the platform's job is to **slow you down**. Every path from "I saw something" to "I placed a trade" passes through a written memo and a cooling-off period.

**1.6 "Wait," "already moved," and "unknowable" are first-class outputs.** Prominent, satisfying conclusions — not empty states. Most days the correct output is "nothing to do."

**1.7 Record before you know.** Every signal, thesis, probability and suggestion written to an immutable log **before** the outcome, timestamped. Without this you cannot evaluate anything, and you will remember yourself as having been right.

**1.8 Information hierarchy enforced in the UI.**

| Tier | Source | Treatment |
|---|---|---|
| 1 | Filings, regulatory documents, official releases, court records | Default view |
| 2 | Company communications — transcripts, IR decks | One click away |
| 3 | Ecosystem — competitor/customer/supplier filings, trade data | One click away |
| 4 | Interpretation — analyst research, trade press | Collapsed, labelled |
| 5 | Narrative — social media, price commentary, TV | **Not ingested** |

Tier 5 is excluded deliberately. It is the tier the radar instinct wants most and the one that most reliably costs money. *Currently honoured — do not "improve" coverage by adding it.*

---

## 2. Architecture

### 2.1 Target shape

```
Collectors (scheduled, server-side)
      ↓
Raw Event Store (immutable, append-only)      ← THE MISSING PIECE
      ↓
Normalizer → Fact Store (point-in-time)
      ↓
Analyzers → Derived Views
      ↓
Rules Engine → Alert Queue → Delivery (Telegram)
      ↓
Signal Log (append-only)
```

The existing `/api/market` and `/api/news` proxies become **collectors** rather than request-time fetchers. The UI then reads from the store, not from upstream. This is the single structural change that unlocks everything else.

### 2.2 Keep the proxy pattern

Already correct. No credential, key, or upstream URL reaches the browser. All six Connections items, when built, must follow it: keys live in server environment variables, never in `localStorage`, never in a client bundle, never in the notes field (the app's own footer warning is right about this).

### 2.3 **Critical path: localStorage → server store**

Current state is `localStorage["sentinel-workspace-v1"]` on one device. That means:

- No cross-device access
- No history — clearing site data destroys everything
- **No immutable signal log, therefore §1.7, §4.3, §6 and §8 are all impossible**

Nothing else in this document can be built until this is fixed, and it must be fixed **before** more features, because a signal log cannot be backfilled. Every week you wait is a week of evidence you will never have.

**Recommended: SQLite in WAL mode on the app server.** At single-user scale it needs no separate service, handles far more than you'll generate, and backs up by copying a file. Postgres is fine if you prefer it; do not reach for anything larger.

Minimum schema to start:

```sql
-- Immutable capture. Never UPDATE, never DELETE.
CREATE TABLE raw_event (
  id            INTEGER PRIMARY KEY,
  source        TEXT NOT NULL,          -- 'coinbase' | 'ecb' | 'fed' | 'sec'
  fetched_at    TEXT NOT NULL,          -- ISO8601 UTC, when WE got it
  published_at  TEXT,                   -- source's own timestamp, NULL if none
  content_hash  TEXT NOT NULL,          -- dedup key
  payload       TEXT NOT NULL,          -- raw JSON, exactly as received
  http_status   INTEGER,
  UNIQUE(source, content_hash)
);

-- Point-in-time facts derived from raw. Superseded, never overwritten.
CREATE TABLE fact (
  id            INTEGER PRIMARY KEY,
  entity        TEXT NOT NULL,          -- ticker, CIK, or series id
  metric        TEXT NOT NULL,
  value         REAL,
  unit          TEXT NOT NULL,          -- currency or unit — never a bare number
  period_end    TEXT,                   -- what period it describes
  known_from    TEXT NOT NULL,          -- when WE could first know it
  superseded_by INTEGER REFERENCES fact(id),
  raw_event_id  INTEGER NOT NULL REFERENCES raw_event(id)
);

-- Append-only. The evaluation record. Never edited.
CREATE TABLE signal_log (
  id            INTEGER PRIMARY KEY,
  created_at    TEXT NOT NULL,
  kind          TEXT NOT NULL,          -- 'alert'|'thesis'|'prediction'|'decision'
  entity        TEXT,
  body          TEXT NOT NULL,          -- JSON
  probability   REAL,                   -- for scoreable predictions
  resolves_at   TEXT,
  outcome       INTEGER,                -- 0/1, written once at resolution
  resolved_at   TEXT
);

CREATE TABLE memo (           -- see §4.2
  id, company, created_at, price_at_write, body_json, status
);
CREATE TABLE kill_criterion ( -- see §4.3
  id, memo_id, predicate_json, created_at, tripped_at, edit_log_json
);
```

**Rule:** any query must be answerable *as of a past date* using only `known_from <= T`. If your schema can't do that, fix the schema before building features. This is what makes every later evaluation honest, and it is why `fact` has `known_from` rather than a simple `updated_at`.

### 2.4 Fix the collector contract

The existing `/api/market` response schema is good and should be kept and extended:

```json
{
  "quotes":[{"symbol":"BTC","amount":75847.045,"currency":"USD",
             "receivedAt":"...","source":"Coinbase spot reference",
             "sourceTimestamp":null}],
  "sources":[{"name":"Coinbase BTC/USD","status":"available","checkedAt":"...",
              "message":"Indicative spot price. Provider trade timestamp not supplied."}],
  "checkedAt":"..."
}
```

`sourceTimestamp: null` recorded honestly rather than faked is exactly §1.1. Keep that.

**Add to every collector:**

- **Retry with exponential backoff and jitter.** Two `503`s were observed on each endpoint inside eleven minutes — roughly a one-in-six failure rate, currently unhandled and invisible to the user.
- **Last-known-good cache with an explicit staleness flag.** On upstream failure, serve the cached value labelled stale with its age. Never show nothing; never show a stale value as fresh.
- **Circuit breaker.** After N consecutive failures, stop hammering and mark the source `degraded` in the `sources` array — the schema already has the field for it.
- **Health events.** Missing three consecutive expected runs raises an *operational* alert to you, separate from market alerts. A silently dead feed is the worst failure mode in the system.
- **Content-hash dedup**, already implied by the schema above.
- **Correct identification.** SEC requires a `User-Agent` header with real contact details and enforces 10 req/sec; it will block you otherwise.

### 2.5 Data quality gates

Before any fact enters the Fact Store:

- **Cross-source price reconciliation** — two independent sources, flag divergence beyond a threshold. One source is a single point of fabrication. *The CoinGecko cross-check the extension performed manually is exactly this; automate it.*
- **Corporate actions** — splits, dividends, spin-offs, ticker changes, delistings silently corrupt every price series and every backtest. Cheap providers handle these badly. Test explicitly against a known split before trusting any history.
- **Unit and currency tagging** — every monetary value carries currency and scale. Never store a bare number. *Already honoured in `/api/market`.*
- **URL construction** — the ECB link currently emits a double slash (`ecb.europa.eu//press/...`). Harmless today; the class of bug is not.

---

## 3. Data sources — honest tiering

### 3.1 The free tier, and what is already wired

| Source | Status | What it gives |
|---|---|---|
| **Coinbase spot** | ✅ Connected | BTC/ETH reference prices, verified accurate to 0.024% |
| **ECB RSS** | ✅ Connected | Releases and speeches, real URLs |
| **Federal Reserve RSS** | ✅ Connected | Policy and supervisory releases |
| **SEC EDGAR** | ❌ Not wired — **highest value next connection** | US filings; `companyfacts` gives machine-readable XBRL: the entire ten-year reconstruction, free |
| **FRED / ALFRED** | ❌ Not wired | Economic series; **ALFRED gives point-in-time vintages** — required for §8.4 |
| **Federal Register** | ❌ Not wired | US regulatory documents, proposed and final |
| **Companies House (UK)** | ❌ Not wired | UK filings and accounts |
| **Company IR RSS** | ❌ Not wired | Primary announcements, earliest legitimate access |

EDGAR is the one to build next. It is free, it needs no negotiation, and it is the only source that feeds §4 — the part of the platform that actually has edge.

For non-US equities, filing access is fragmented by jurisdiction. Budget real time; there is no single free global EDGAR.

### 3.2 Paid, and what it honestly buys

| Need | Reality |
|---|---|
| Global end-of-day equity prices | Achievable (~$20–100/mo band; verify current vendor pricing directly) |
| Global **real-time** consolidated equities | Not achievable at your budget — exchange licensing sets the floor, not the vendor |
| Gold spot | Cheap; LBMA publishes daily fixings, spot needs a metals feed |
| **Licensed breaking-news wire** | Hundreds to thousands/month. **This is what the two empty filter chips cost.** |
| Analyst consensus | Specialist providers; check historical coverage depth before paying |

**Rule:** never let a vendor's "real-time" marketing set your latency expectation. Measure publication-to-delivery yourself for two weeks and display *your measured* number.

### 3.3 Instrument availability

Every company carries: **tradable in your Revolut account — confirmed / unconfirmed / no**. An opportunity you cannot act on is not an opportunity. Verify against your actual catalogue. Where an alternative listing or ETF exists, label it as a *different instrument* with different economics. *The existing "Not a Revolut execution quote" disclaimer is the right instinct — extend it into a real field.*

---

## 4. The research core — this is the product

Everything above serves this section. Build only §4 and you have something valuable. Build everything except §4 and you have a news reader.

**This is currently 0% built.** The Watchlist holds six fixed illustrative cards and cannot accept an arbitrary ticker. That is the gap between what exists and what has edge.

### 4.1 Company file

Per watchlist company, built from filings — never from a vendor's pre-computed ratios:

- Ten-year reconstruction: revenue, gross/operating margin, NOPAT, invested capital, ROIC, **incremental ROIC**, FCF conversion, share count, net debt, maturity schedule
- Owner earnings: `Reported Earnings + non-cash charges − maintenance capex − required working capital`
- Maintenance capex **estimated independently**, never assumed equal to depreciation. Store the triangulation method and its confidence.
- ROIC both including and excluding acquired goodwill — the gap tells you whether M&A destroyed capital
- Segment-level where disclosed

Store the **derivation**, not just the result: which filing, which tag, which adjustment. When a number looks wrong in two years you need to see how it was made.

All of this is available free from EDGAR `companyfacts`.

### 4.2 The memo as structured data

The central object. Structured fields, **not a prose blob**, so the platform can monitor it:

```
memo:
  company, date, price_at_write
  thesis: [3 sentences]
  circle_of_competence: understood / unknowable
  five_year_earnings_range: {low, high}     # gate — see below
  moat: {mechanism, evidence[], attack_vectors[], expected_fade_years}
  management: {capital_allocation_record[], say_do_ledger[]}
  accounting_flags[]
  balance_sheet_stress: {rev −25%, margin −500bps, rates +300bps} → survives?
  valuation: {bear, base, bull} × {value, probability, assumptions}
  reverse_dcf_implied_assumptions
  market_view: what the market believes, where precisely I differ
  disconfirming_evidence: [5 strongest reasons not to invest]
  position: {initial_weight, max_weight, add_conditions}
  kill_criteria: [predicate...]
```

**Enforce the gate in code:** if `five_year_earnings_range` cannot be filled, the memo is blocked. That is the circle-of-competence test, made mechanical.

### 4.3 Kill criteria as machine-checkable predicates

**The platform's best feature, and almost nobody builds it.** It is also, now that EDGAR is the next connection, the cheapest high-value thing you can ship.

Written at purchase time while you are calm and unattached; evaluated server-side on every new filing:

```json
{"all": [
  {"metric":"net_debt_to_ebitda","op":">","value":3.5,"consecutive_periods":2},
  {"metric":"cfo_to_net_income","op":"<","value":0.7,"consecutive_periods":2},
  {"metric":"gross_margin","op":"<","value":0.34},
  {"metric":"share_count_yoy","op":">","value":0.02},
  {"event":"auditor_change"},
  {"event":"late_filing"},
  {"event":"material_weakness_disclosed"}
]}
```

An alert reading *"the condition you yourself defined as thesis-breaking has occurred"* is worth more than every political headline the radar will ever surface — and it computes from free XBRL.

**Edit discipline:** kill criteria are never edited while a position is open without a dated written justification. Log every edit in `edit_log_json`. Otherwise you will quietly move the goalposts, and you will not notice yourself doing it.

### 4.4 Thesis drift monitoring

Per position, thesis assumption vs. current actual:

| Variable | Thesis level | Current | Direction | Status |
|---|---|---|---|---|
| Organic volume growth | ≥4% | 1.8% | ↓ | ⚠ drifting |
| Incremental ROIC | ≥15% | 16.2% | → | ok |
| Net leverage | <2.0× | 2.4× | ↑ | ⚠ approaching kill |

Intrinsic value updates **only when business economics change** — never because price moved. Enforce it: **the IV edit form does not display the current price.**

### 4.5 Watchlist must accept arbitrary entities

Currently impossible — the only path into the watchlist is bookmarking one of six fixed demo cards. Replace with:

```
POST /api/watchlist  {"identifier": "ASML" | "CIK0000937966" | "US0378331005"}
→ resolves to a canonical entity, creates a company_file stub, returns entity_id
```

Resolution order: ticker+exchange → CIK (US) → ISIN. Store the canonical id, not the ticker — tickers change and reuse.

---

## 5. The event layer — correctly scoped

Keep it. Demote it. Make it earn its place. The observation gave you hard evidence on what it can and cannot cover; build to that evidence, not to the ambition.

### 5.1 Classification is mandatory

No event enters without a certainty class:

`rumour` → `proposal` → `announced` → `legislated` → `in force`

These carry radically different information. Most retail losses in political trading come from treating the first as the last. Display the class more prominently than the headline. *The existing radar copy already says this in prose ("a budget is not a contract") — make it a field.*

### 5.2 Exposure mapping must be evidence-backed

```
event → exposure_link: {company, mechanism, evidence_source, confidence}
```

Segment revenue by geography from filings. Manufacturing locations from the 10-K. If you cannot source the exposure it is `unknown` and displays as unknown — never a soft "possible beneficiary." Sector headlines do not affect every company equally, and the cases where it's obvious are already priced.

### 5.3 The "already moved" gate

Before any event is presented as potentially actionable, compute and display:

- Price change since event publication timestamp
- **Sector/index change over the same window** — separates the idiosyncratic move from the market move
- Volume vs. trailing average

If the idiosyncratic move already exceeds your estimated impact, render **"likely priced"** and file to research, not to opportunities. *Note the current sample alert reads "Price response: Unavailable — no live market feed" — honest, and a placeholder for exactly this.*

### 5.4 The second-order rule

Never alert on the move. Alert on the **implication that survives the move**. The first-minute spike is unreachable. Whether this changes the five-year earnings range of a business you understand is reachable, still open days later, and where a patient participant actually competes.

Operationally: events batch into a **daily digest by default**. Immediate alerts are §6.1 only.

### 5.5 Latency honesty

Display three timestamps and the gaps:

```
Published 14:32:07 → Ingested 14:36:41 (+4m34s) → Delivered 14:36:52 (+4m45s)
```

Keep a rolling median on the dashboard. Over months this display will settle the radar question from your own data rather than anyone's opinion.

### 5.6 Coverage must be visible, not implied

The `Digital assets` and `Trade & geopolitics` chips return zero. Do not hide empty categories. Show, per topic: **sources covering it** and **items in the last 30 days**. A topic with no source shows "no source connected for this topic," not "no releases." The current empty state ("Choose another topic") misattributes a coverage gap to a quiet news week.

### 5.7 Fix the default view

`All updates` shows 12 items while `/api/news` returns 24, so the default view is the *least* complete and the filters reveal items it hides. Either paginate to the full pool or relabel it "Latest 12." Never let the default view silently be the most incomplete one.

---

## 6. Alerting discipline

**Currently 0% built.** Two `localStorage` toggles with no condition, target, or channel. Build in this order: store (§2.3) → rule engine → delivery → tiers.

### 6.1 Three tiers, strictly defined

| Tier | Triggers | Delivery |
|---|---|---|
| **Immediate** | A kill criterion trips · trading halt on a holding · auditor change / late filing / material weakness · covenant event | Push, any hour |
| **Important** | Thesis variable drifts past threshold · valuation moves materially vs. your IV · scheduled catalyst (T−7) | Digest, or push in waking hours |
| **Digest** | Everything else, **including all political and macro events** | Once daily, morning |

Note what is in Immediate: **almost all of it concerns businesses you already own, not opportunities you might take.** That ratio is correct and deliberate.

### 6.2 Rate limit yourself

Hard cap: **maximum 3 Immediate alerts per week.** If more trigger, the rules are miscalibrated and the system must tell you that rather than flood you. Scarcity is what preserves the signal value of a push notification.

Also required: dedup by event identity, quiet hours, explicit **correction alerts** when an earlier alert is superseded, and reviewable history. *Every generated alert needs a timestamp — the current sample has none.*

### 6.3 Cooling-off — the protection you actually asked for

No alert is actionable in the same session:

1. Alert received → read → **logged as read**
2. To act: open a **decision session**, a separate deliberate flow
3. Requires a written memo (or memo update); displays your own policy limits
4. **Minimum interval: 24 hours for a new position, 4 hours for adding to an existing one**
5. Only then does the platform show instrument details for you to act on in Revolut

This is the single most protective feature in the document. No feed protects you from being flushed by a large participant; a mandatory delay does, because it is immune to whatever induced the urgency.

---

## 7. Risk, sizing, and the policy layer

### 7.1 Written policy, enforced as data

```
policy:
  capital_committed
  leverage: none                      # changing requires dated justification
  max_position_weight: 8%
  max_sector_weight: 25%
  max_single_permanent_loss_contribution: 2%
  speculative_bucket_cap: 5%          # crypto lives only here
  min_cash: 10%
  review_cadence: quarterly
  never_do: [leverage, tokens < 6mo old, anything I cannot bound 5y earnings for, ...]
```

### 7.2 Downside-budget sizing

```
max_weight = permanent_loss_budget / estimated_permanent_loss_fraction
```

40% plausible impairment against a 2% portfolio budget caps at **5%**. Kelly is a *ceiling and sanity check only*, never a target — full Kelly on estimated probabilities routinely returns >100% of capital. If your inputs were reliable enough for Kelly you wouldn't need risk management.

### 7.3 Pre-trade gate

Blocks the decision session unless **all** pass:

- [ ] Memo complete, including `five_year_earnings_range`
- [ ] Kill criteria written and machine-evaluable
- [ ] Bear case computed; price below bear-case value **or** shortfall acknowledged in writing
- [ ] Size within policy caps, including sector and correlation
- [ ] Cooling-off elapsed
- [ ] Instrument confirmed tradable in your account
- [ ] Disconfirming evidence non-empty and specific

### 7.4 Crypto quarantine

Crypto does not enter the research core. Owner earnings, ROIC and moats do not exist for a token; pretending otherwise is the error, not a tooling limitation.

Separate bucket, own cap, own rules:

- **Fraud screen first:** exact contract identity, ownership concentration, liquidity depth and lock status, mint/freeze authority, contract verification, privileged functions, sellability simulation, promotional-activity anomalies
- Incomplete checks produce **"risk unknown"** — never "safe." Passing means "no disqualifier found," nothing more. *The existing "Unverified token" card already models this correctly — it is the single best-designed card in the app.*
- Cap is absolute and independent of conviction
- Same cooling-off, same logging

---

## 8. Evaluation — prove it works before trusting it

**Blocked until §2.3 ships.** This is why the persistence migration is the critical path rather than a refactor.

### 8.1 Signal log from day one

Append-only, never edited. Every suggestion, thesis, alert and probability, timestamped **before** outcome. Costs nothing to build early; impossible to reconstruct later.

### 8.2 Calibration scoring

Explicit probabilities on falsifiable statements ("70% that revenue CAGR exceeds 5% over three years"). Brier score `(p − o)²`. Calibration curve annually. Target ~100 scoreable predictions a year, mostly about businesses, not prices. The skill being trained is not accuracy — it is knowing what your own "80% confident" is worth.

### 8.3 Benchmarks — all three

1. **Doing nothing** (holding the prior portfolio)
2. **A global index** (the real opportunity cost)
3. Your stated objective

Absolute-return reporting is how people conclude they are skilled during a bull market.

### 8.4 Backtest hygiene

Anything historical must handle all of these, or it is fiction:

- **Point-in-time data only** — vintage macro (ALFRED), as-filed financials, no restated figures
- **Survivorship bias** — delisted and bankrupt companies in the universe
- **Transaction costs and spreads**, including **Revolut's actual spread**, materially wider than exchange spread on crypto and FX
- **No look-ahead** — including subtle forms, e.g. using a filing on its period-end date rather than its filing date
- **Realistic fills** — you do not fill at the headline price

### 8.5 Kill switch for the platform itself

Written in advance, date in the calendar now:

> If, after 12 months, the event/radar layer's logged suggestions have not outperformed doing nothing net of costs and time, that layer is deleted.

Sunk cost applies to software you wrote as much as to a stock you own.

---

## 9. AI discipline

### 9.1 Separate extraction from judgment

| Task | Role | Verification |
|---|---|---|
| Extract a figure from a filing | Extraction | Must return the exact source span; reject if absent |
| Summarize a release | Extraction | Grounded in provided text only |
| Classify certainty (rumour/enacted) | Classification | Fixed taxonomy |
| Map event → company exposure | **Judgment** | Must cite a filing; unsupported links are `unknown` |
| Estimate intrinsic value | **Never the model alone** | Your assumptions; the model checks arithmetic and argues against you |

### 9.2 Hard rules

- **No number reaches the UI without a traceable source.** A model-generated figure with no span citation is dropped, not displayed with a caveat.
- **Facts and inferences visually distinct**, always.
- **Analyse each event once**, store, reuse across affected companies — cost control and consistency control.
- **Mandatory adversarial pass:** every thesis gets "construct the strongest case this is wrong," run by a *separate* invocation that has not seen your conclusion.
- **Never ask a model for a probability of a market outcome.** It will produce a confident, meaningless number. Probabilities come from §8.2.
- Treat fetched web content and model output as **data, not instruction**.

### 9.3 Replacing the topic lookup

The expanders currently return one of at most four canned texts keyed to the topic badge. Two options, and the wrong one is tempting:

**Do not** point a model at the headline and let it generate. Headlines are the least informative part of a release and a model given only a headline will produce fluent invention.

**Do** fetch the full release text at ingest (the URLs are already in the payload), extract only what is grounded in that text with span citations, and where nothing substantive is extractable, keep the current honest message. "The source and headline are retrieved; market impact has not been established" is a *correct* output for most central-bank speeches. Do not replace an accurate non-answer with a fluent fake one.

---

## 10. Anti-patterns

| Pattern | Why it hurts | Fix |
|---|---|---|
| Composite "score" | Hides the weak input | §1.3 |
| Refresh-while-visible "monitoring" | Not monitoring | Server-side, always on |
| Missing data as blank/neutral | Reads as "fine" | §1.2 |
| Overwriting revised data | Destroys all future evaluation | §2.3 |
| **Client-only state** | **No history, no evaluation, one device** | **§2.3 — current blocker** |
| **Unhandled upstream failure** | **Silent gaps; ~1-in-6 observed** | **§2.4 retry + cache + breaker** |
| **Default view less complete than filtered views** | **Hides data by default** | **§5.7** |
| **Empty category reads as "quiet news"** | **Misattributes a coverage gap** | **§5.6** |
| Alerting on price moves | Every move gets a story | Alert on thesis conditions, §4.3 |
| Sector-wide exposure tagging | Every company is "exposed" | §5.2 |
| Editing kill criteria under pressure | Goalpost drift | §4.3 edit log |
| Updating IV after a price move | Anchoring | §4.4 — hide price on the form |
| Single price source | Undetectable fabrication | §2.5 |
| Ignoring corporate actions | Corrupts every series | §2.5 |
| Absolute-return reporting | Flatters you in a bull market | §8.3 |
| Model output shown as fact | Confident fabrication | §9.2 |
| **Navigation glyph on an in-page control** | **Implies more exists than does** | **§13 D-07** |

---

## 11. Build sequence — code-ready backlog

Phases ship and get used before the next begins. Exit criteria are met, not approximated.

**Phase 0 and 1 are done.** The app exists, four real feeds are connected, honest labelling is in place. Start at Phase 2.

| # | Build | Exit criterion | Effort |
|---|---|---|---|
| **2 — Persistence** | SQLite WAL; `raw_event` / `fact` / `signal_log` tables; migrate `localStorage` state server-side; `/api/*` writes raw before serving | A query answers "what did we know at 14:00 yesterday" correctly | 1 weekend |
| **3 — Collector hardening** | Retry + backoff + jitter; last-known-good cache with staleness flag; circuit breaker; health events; fix §5.7 and §5.6 | 48h continuous run with zero silent gaps; a forced upstream failure degrades visibly, not invisibly | 1 weekend |
| **4 — Signal log UI** | Manual entry for predictions and decisions; append-only; probability + resolution date | 30 days of logged predictions with resolution dates | 2–3 days |
| **5 — EDGAR + company file** | `companyfacts` ingest; ten-year reconstruction for **3 companies**; arbitrary-ticker watchlist (§4.5) | You can explain why every major ratio moved, from filings | 3–4 weekends |
| **6 — Memo + kill criteria** | Structured memo; predicate evaluator; five-year-range gate | One complete memo; one kill criterion verified to fire correctly against historical filings | 2–3 weekends |
| **7 — Always-on + delivery** | Scheduler (cron/systemd timer); Telegram bot; alert tiers; dedup; quiet hours; corrections | Alert fires with laptop closed; you have measured real end-to-end latency | 2–3 weekends |
| **8 — Drift dashboard + decision flow** | §4.4 table; cooling-off (§6.3); pre-trade gate (§7.3) | One full quarterly review completed | 2 weekends |
| **9 — Event layer, digest-only** | Classification field; exposure links with confidence; already-moved gate; latency display | 60 days of logged events showing whether any were actionable | 3+ weekends |
| **10 — Evaluation** | Brier scoring; calibration curve; three benchmarks; backtest harness | First annual scorecard | Ongoing |

**Phases 2–6 are the product.** Stop after Phase 7 and you have something genuinely better than most retail investors have, running at near-zero cost.

**Do not jump to Phase 9 because it is the interesting one.** It depends on everything before it and delivers least.

---

## 12. Cost reality

| Item | Monthly |
|---|---|
| Hosting (small VPS, always-on) | $5–15 |
| SQLite | $0 |
| Telegram delivery | $0 |
| Coinbase, ECB, Fed, EDGAR, FRED/ALFRED, Federal Register, Companies House | **$0** |
| Model inference (batched, cached, analyse-once) | $10–40 |
| Global end-of-day prices (Phase 9+) | $0–100 (verify current vendor pricing) |
| **Realistic total, Phases 2–8** | **$15–70** |

Deliberately excluded, with the honest reason:

- **Licensed breaking-news wire** — hundreds to thousands/month. This is the price of the two empty filter chips, and speed is not a game you can win.
- **Consolidated real-time global equities** — exchange licensing, not vendor pricing, sets the floor.
- **Analyst consensus** — verify historical coverage depth before deciding it is worth paying for.

The valuable part of this platform costs under a fifth of your stated budget. The budget was sized for the layer that does not work.

---

## 13. Defect log

From the 16 Sep observation. Severity: **S1** blocks everything downstream · **S2** causes wrong conclusions · **S3** cosmetic or misleading affordance.

| ID | Sev | Defect | Fix |
|---|---|---|---|
| D-01 | **S1** | All state in `localStorage`; no server store. No history, no signal log, no cross-device, no evaluation possible. | §2.3 |
| D-02 | **S1** | No always-on service. "Closing the app stops checks." | Phase 7 |
| D-03 | **S2** | `/api/market` and `/api/news` returned 503 twice each in 11 min; unhandled, invisible, no retry or cache. | §2.4 |
| D-04 | **S2** | `All updates` caps at 12 while the pool is 24 — the default view hides items the filters reveal. | §5.7 |
| D-05 | **S2** | `Digital assets` and `Trade & geopolitics` return 0 and read as "no releases," attributing a coverage gap to a quiet news week. | §5.6 |
| D-06 | **S2** | Expander text keyed to topic badge, not article — two different articles returned byte-identical text. | §9.3 |
| D-07 | S3 | `View setup ↗` and `Limited feed coverage` carry a navigation glyph but only switch the in-page tab. No setup page exists. | Remove the ↗, or build the page |
| D-08 | S3 | Connections items have no connect button, form or key field — six status badges over descriptive copy. | Phase 7, or relabel as a roadmap |
| D-09 | S3 | Watchlist accepts only the six fixed demo cards; no arbitrary ticker entry. | §4.5 |
| D-10 | S3 | Generated sample alert carries no timestamp. | §6.2 |
| D-11 | S3 | ECB URLs emit a double slash (`ecb.europa.eu//press/...`). | URL join |

---

## Appendix A — Pre-purchase checklist

Answer yes to essentially all before committing capital:

- [ ] I can explain this business without jargon
- [ ] I can bound its earnings five-plus years out
- [ ] I understand what customers value and what makes them switch
- [ ] The competitive advantage is causal and evidenced, not a label
- [ ] I can describe specifically how the moat fails
- [ ] Normalized ROIC is attractive
- [ ] **Incremental** ROIC is still attractive
- [ ] Reported earnings reconcile with cash economics
- [ ] I estimated maintenance capex independently of depreciation
- [ ] The balance sheet survives a severe recession **without friendly capital markets**
- [ ] Management has allocated capital rationally, per share, over a decade
- [ ] I have read the proxy and the debt documents
- [ ] I have read at least two competitors' filings
- [ ] I have constructed the strongest bear case, in writing
- [ ] I know what expectations the price already embeds (reverse DCF)
- [ ] Price is materially below conservative value
- [ ] The bear case leaves adequate survival value
- [ ] Position size is small enough that being wrong is survivable
- [ ] Kill criteria are written and machine-checkable
- [ ] I would still buy if the market closed for five years

---

## Appendix B — Sell discipline

**Sell or reduce when:** thesis materially falsified · moat deteriorating on evidence · management integrity in question · leverage creates ruin risk · capital allocation persistently destructive · valuation implies inadequate forward return *and* a clearly superior opportunity exists · concentration unsafe · the analysis was outside your competence.

**Do not sell because:** the stock rose · it hit a round number · a recession is forecast · analysts downgraded · the market is volatile.

The most expensive documented error here is not selling too early — it is **recognising deterioration and acting slowly**. Build the platform to timestamp the gap between "kill criterion tripped" and "you acted," and show it to you.

---

## Appendix C — What the app already gets right

Preserve these when refactoring. They are the hard part and they are done.

1. Server-side proxy — no credential or upstream URL reaches the browser
2. `receivedAt` vs `sourceTimestamp`, with `null` recorded honestly rather than faked
3. Source status objects carrying `checkedAt` and a human-readable message
4. `"mode":"public-feeds"` — a self-describing API
5. Every disclaimer accurate and specific, not boilerplate
6. `Risk unknown` on the unverified-token card — §1.2 already implemented, and the best-designed card in the app
7. No composite score anywhere
8. No Tier 5 sources ingested
9. Explicit labels: `SIMULATED ALERT · NOT CURRENT NEWS`, `Hypothetical example · No live event asserted`, `General topic context · Not article analysis`
10. "Evidence over urgency" in the footer — the correct thesis for the whole product

---

*This document describes how to build a research tool. It is not financial advice and contains no recommendation on any asset. The platform it describes cannot predict markets, detect manipulation, or prevent loss — its purpose is to make your reasoning explicit, monitorable, and scoreable.*
