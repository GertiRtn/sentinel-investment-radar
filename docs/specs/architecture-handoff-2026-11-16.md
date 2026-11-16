# Architecture handoff for Claude Code (2026-11-16)

Context: the decision workflow (`docs/HANDOFF.md`, 2026-11-16) answers four separate questions per case: business quality, market expectations, investment opportunity, portfolio suitability. The four items below extend it. Invariants referred to: 5 (no model-generated numbers), 6 (no composite score as a forecast), 7 (no buy/sell wording, alerts inform). None may change without the founder's explicit approval.

## 1. Broader fundamental screening (beyond news)
- **Boundary:** new pure `lib/sentinel/fundamental-screen.ts` (rules over stored facts) plus an offline or scheduled loader. It produces *candidates for assessment*, exactly as discovery does; it never writes cases directly and never bypasses the screen.
- **Reuse:** `financial.ts` (`parseFacts`, `derive`, share count), `implied-expectations.ts`, `discover-rank.ts` for presentation, `discovery_candidate` as the hand-off record.
- **Data:** SEC **frames** lists about 6,200 filers per tag and year in one request, but has no filing date (verified 2026-11-16), so use it only to choose which companies to ingest; values must come from `companyfacts`. Budget: 3.6 MB per company, so ingest tens per day, not thousands, or move bulk storage out of D1.
- **Approval needed:** none if the output is a labelled research queue. Invariant 6 if any ordering is shown as more than routing.
- **Acceptance:** for a fixture of 20 companies, the screen's list is reproducible as of a past date using only facts with `known_from` ≤ that date; a company whose figures were later restated is selected on the original figures.

## 2. Tested outperformance predictions
- **Boundary:** offline only (`scripts/research/`), until a gate passes. The Worker gets a number only through a new, versioned, read-only record written by an approved export.
- **Reuse:** `scripts/research/harness.mjs` (split, costs, baselines, frozen test), auto-practice-v2's judging rule as the prospective second gate.
- **Data:** historical prices including delisted symbols and a point-in-time universe (both missing: `docs/specs/prediction-feasibility-2026-11-16.md`).
- **Approval needed:** invariants 5 and 6 for *any* predictive number in the UI, and 7 for any wording built on it. Suggested gate before asking: frozen rule, untouched test set, interval lower bound above zero after costs and above the baseline, then a prospective period of at least 50 closed signals.
- **Acceptance:** the harness report for the frozen rule is byte-reproducible from archived inputs, and the UI shows nothing when the gate record is absent.

## 3. Portfolio-aware recommendations
- **Boundary:** two separate outputs that are never merged: **research priority** (evidence about the business and the event) and **allocation suitability** (what a position does to *this* portfolio). New pure `lib/sentinel/suitability.ts` on top of `decision-compare.ts`.
- **Terms (routing labels, not advice):** Research Priority · Candidate for Allocation · Monitor · Insufficient Evidence. "Candidate for Allocation" requires: research priority, implied expectations computed, mandate checks kept, and scenarios available. Anything unknown is Insufficient Evidence.
- **Reuse:** `decision-compare.ts` (already reads an optional `practice_mandate` record: reserve %, maximum position %), `practice-risk.ts`, `investment-case.ts`, `idea-card.ts` portfolio fit.
- **Data:** an append-only `practice_mandate` record and a small form to set it (not built); sector overlap needs point-in-time industry codes (missing).
- **Approval needed:** invariant 7 for the label "Candidate for Allocation" appearing in any alert or case body; invariant 6 if labels are ever ranked.
- **Acceptance:** the same case shows a different suitability under two fixture portfolios while its research priority is identical; removing the mandate turns every suitability into "no mandate set", never into a pass.

## 4. Supervised automation ladder
| Step | What Sentinel does | Preconditions |
|---|---|---|
| 1. Research only (today) | Finds, assesses, records, measures | — |
| 2. Suggestions | Proposes a virtual position with the three-way comparison attached | Mandate set; prediction gate (item 2) or auto-practice-v2 success; founder approval of invariant 7 wording |
| 3. User-approved execution | Prepares an order; the user confirms each one | A separate, controlled execution service with its own credentials and limits; authentication replaced (today's trusts platform headers); audit log; kill switch |
| 4. Bounded automation | Acts inside hard limits without per-order approval | A full prospective record at step 3; per-day and per-position limits enforced outside the app; founder decision |
- **Boundary:** the app never holds broker credentials. Execution is another service that accepts signed, bounded instructions.
- **Reuse:** `decision_snapshot` as the record a suggestion or order must point to; auto-practice ledgers' conditional-append pattern.
- **Acceptance (step 2):** every suggestion carries a snapshot id, can be reopened unchanged, and is reviewed by the three separate questions; a suggestion without a computed comparison cannot be created. Real trading stays out of scope.
