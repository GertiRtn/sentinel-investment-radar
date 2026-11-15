# Sentinel: auto-practice-v2: final rules for build (2026-11-15, rev 2)

Status: agreed with the founder in discussion, ready for Claude Code to build. Always write "auto-practice-v2" in full. It is unrelated to investment-case spec v2/v3.x.

## 1. Purpose
Start the prospective track-record clock now, on data Sentinel already has. A cleaner, news-direction-filtered version of auto-practice-v1. It runs in parallel with v1 and never edits it. v1 keeps its rules (including bad-news cases) and serves as a comparison group.

## 2. Entry rules (all must be true, at assessment time)
1. Screen-v2 says "Meets research rules".
2. News direction = good. Bad, mixed and neutral never enter.
3. Ordinary share (same test as v1).
4. Company named in the headline (same test as v1).
5. Latest IEX close >= $5. No close available means skip and log "no price" (unknown is never a pass).
6. One open position per company. No re-entry for 20 trading days after an exit.

Not used for entry: the investment-case verdict (founder decision: verdicts are not fed into experiments). The $300M market-value floor is also not used, because Sentinel has no official share count yet.

## 2a. Shadow fields (recorded on every v2 signal, never used to enter)
- Investment-case verdict, with its spec version. It may be computed after the fact, as known at assessment time: use only the records Sentinel held at that case's assessment time (the prototype already works this way). It is point-in-time, append-only, and never feeds entry. If the records at that time are not enough to compute it, store "not reconstructable", never a guess.
- Run this as a follow-up job over v2 signals that have no verdict yet (not only on click), so the shadow data is complete enough to be evidence for v3.
- Score band, price basis, event type, SIC code if available.

Purpose: if "research priority" signals later beat the rest, that is the evidence for auto-practice-v3.

## 3. Position size and limits (virtual portfolio)
- $1,000 per position, max 5 open, as v1.
- Signals that arrive when 5 are open are still recorded in the signal ledger (section 5), marked "not taken: slots full".

## 4. Entry, exit, costs
- Entry: first regular-session price after the case is recorded. If none within 1 trading day, skip and log.
- Exit: 20 trading days after entry, the same checkpoint as the outcome table. No early exits and no discretionary exits.
- Costs: 15 bp each way, as v1.
- Two price bases, kept separate:
  - Signal ledger: dividend-adjusted closes. Entry = adjusted close of the first full session after recording. Exit = adjusted close 20 sessions later. SPY uses the same dates, adjusted. All judgement uses this.
  - Virtual portfolio: live-quote fills, as v1. A realism check only. Do not judge from it, because dividends distort live-quote prices.

## 5. Two ledgers
1. Signal ledger (uncapped): every case meeting section 2, whether or not a slot was free. Each signal: entry/exit dates, adjusted returns gross and after cost, SPY return, excess return.
2. Virtual portfolio (capped): the 5-slot $1,000 version.

## 6. Compared against (at the same 20-day mark, same dates)
- Main comparison: assessed cases that met research rules but were NOT good news (bad, mixed, neutral). This group contains none of v2's own signals, so it tests whether the good-news filter adds value.
- Secondary figures (shown, not used for the success test): SPY; assessed cases that met research rules, all directions (contains v2's own signals; context only); auto-practice-v1 positions in the same period; every assessed case, as the "random assessed case" baseline.

## 7. Judging (set now, not changeable later)
- At 20 closed signals: a data-quality check only (fills, missing prices, duplicates). No verdict on performance.
- At 50 closed signals: compute the average and median 20-day excess return vs SPY after costs, with a 90% bootstrap interval for the average.
  - Success: interval lower bound above 0, average >= +2%, median above 0, and average beats the main comparison group ("met research rules, not good news").
  - Failure: average <= 0, or average behind the main comparison group.
  - Otherwise: inconclusive. Keep running to 100 signals, then apply the same test.
- Even on success this is still not buy/sell wording. That stays locked until a later prospective validation the founder approves.
- Why 50: 20-day excess returns typically swing +/-8-10%. With few signals, +2% cannot be told from luck.

## 8. Cannot change inside this version
Any change to sections 2-4 or 7 means auto-practice-v3, started prospectively and compared side by side. Candidate v3 changes already identified:
- Add the $300M floor once the official share count is collected.
- Require investment-case verdict "research priority" (only if the shadow data supports it).

## 9. Build notes for Claude Code
- Append-only; every signal carries the rule version auto-practice-v2.
- Point-in-time: record what was known at assessment time.
- Unknown is never treated as passing.
- Add a count query: how many past stored cases would have met section 2, per month. Report it before launch; it sets the real expected pace.
- Add the shadow verdict field and the follow-up computation job (section 2a).
- Credentials stay on the server. No broker connection. No real trades.

## 10. PR order
1. PR 1: auto-practice-v2 as specified above, plus the past-cases count report before launch.
2. PR 2: debt fields and single-quarter cash flow. Expect this to create a new investment-case version; it does not affect auto-practice-v2 because the verdict is shadow-only and point-in-time.

## 11. Roadmap order (agreed)
1. Debt fields and single-quarter cash flow (PR 2).
2. Official share count (unlocks the $300M floor for v3).
3. Price opportunity: P/E against the company's own history, tested on stored cases before any rule uses it.
4. Dividends last. They matter once the founder is choosing what to hold for income; cheap to add later.
