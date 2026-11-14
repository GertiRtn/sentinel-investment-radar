# Pairs trading and joint factor study — founder brief (deferred)

Saved 2026-11-14 at the founder's request for a possible later study. Not started. Shorting is out of scope for now, not permanently excluded. No data export, broker connection or real trades are authorised. Prerequisites before starting: a defined universe with multi-year prices (ideally including delisted companies), a decision on whether short positions are in scope, and a point-in-time peer classification.

---


You are working on Sentinel, Gerti’s investment research platform.

The founder wants Sentinel to go beyond generic market commentary and
discover potentially interesting opportunities early. He has identified
two ideas:

1. Arbitrage Pricing Theory and multi-factor models: study a stock’s
   sensitivity to several common drivers.
2. Statistical arbitrage and pairs trading: study whether the relationship
   between two economically related securities has diverged from its
   historical pattern.

Your task is to investigate how the two can work together, and build the
smallest credible offline research pilot supported by Sentinel’s actual
data.

The goal is a potentially useful research capability and an honest test of
whether it adds value—not an assumed profitable strategy.

Repository:
https://github.com/GertiRtn/sentinel-investment-radar


## 1. Product objective

The intended future experience is for Sentinel to surface a concise,
understandable relative-opportunity case, for example:

“Two related companies have moved unusually far apart compared with their
historical relationship. Here is the size of the divergence, what broader
market exposures may explain, relevant company developments, and what
remains uncertain.”

This is an illustrative user experience, not a claim that divergence will
reverse or that an opportunity is profitable.

The founder ultimately wants Sentinel to help with investment decisions
and potentially provide directional recommendations. This work should
support that long-term goal without presenting unvalidated outputs as
recommendations.


## 2. Inspect the real project first

1. Read AGENTS.md, docs/HANDOFF.md and the latest founder brief.
2. Report the current branch, commit SHA and local changes.
3. Determine whether the repository matches the deployed Site. Do not
   assume GitHub main and the Site contain identical changes.
4. Identify whether there is existing APT, Fama–French, factor-regression,
   pairs-trading or related research work. The founder may have given
   Claude an earlier factor-model prompt; reuse any completed work.
5. Inspect:
   - Archived daily bars and their adjustment conventions.
   - Security identity and available universe.
   - The existing stock-versus-SPY observations.
   - The Practice risk simulation.
   - The fixed automated Practice experiment.
   - Existing research runners, test tooling and data storage.
6. Identify the latest Site’s mobile company-case redesign and preserve it
   if the source being edited includes it.

Before implementing, summarise:
- What already exists.
- The available data and limitations.
- Which questions can be tested credibly.
- The smallest useful pilot you will implement.

If a required source is inaccessible, state the gap instead of guessing.


## 3. Develop the joint logic

Assess this proposed pipeline and improve it where the evidence requires:

A. Pair selection
   Identify economically related securities using information available
   at the selection date. Examine whether sector, business similarity,
   size or liquidity can be supported by available data.

B. Historical relationship
   Estimate a hedge ratio and define a spread from a formation window.
   Compare at least:
   - A simple normalised-price distance approach.
   - A regression-based spread.
   Consider cointegration as a research method only if there is adequate
   data and a sound reason to include it.

C. Unusual divergence
   Measure the current spread relative to its historical distribution.
   Treat z-score thresholds, including ±2, as hypotheses—not universal
   trading signals.

D. Factor exposure
   Estimate the stocks’ and/or paired position’s historical exposure to
   the broad market and, if suitable data is available, additional factors.
   Determine whether the paired position has meaningful residual market or
   sector exposure.

E. News context
   Connect any relevant recorded company developments only when identity,
   dates and source content support the connection.
   Distinguish “occurred around the same time” from proven causation.
   Do not let an LLM invent a reason for a divergence.

F. Forward evaluation
   Test what happens after signals on data not used to select or fit the
   pair. Include trading frictions for both legs.

Explain which parts of this pipeline are:
- Established calculations.
- Hypotheses.
- Assumptions imposed for the pilot.
- Unavailable because of data limitations.


## 4. APT and factor-model distinction

Do not conflate:

- A statistical factor regression.
- APT’s theoretical expected-return relationship.
- Historical regression residuals or “alpha.”
- A forward expected-return forecast.
- A profitable arbitrage.
- An investment recommendation.

A Fama–French regression can be a useful empirical factor model, but it is
not automatically a validated APT forecasting or stock-picking engine.

A pair’s price-regression hedge ratio does not by itself guarantee market,
sector, dollar or factor neutrality. State which type of hedge, if any, the
model actually creates.

Historical residuals, factor exposures and z-scores are not probabilities
of profit. Stops do not guarantee maximum losses.


## 5. Specify a controlled experiment

The central question is:

“Does adding factor information to a simple pairs approach improve the
quality of relative-opportunity research or simulated results, out of
sample and after costs?”

Compare, where data permits:

1. No-trade baseline.
2. A simple market or sector comparison.
3. A pairs approach without factor adjustment.
4. The same pairs approach with a pre-specified factor-exposure filter or
   adjustment.

The comparison must distinguish:
- Better historical explanation.
- Better out-of-sample forecasting.
- Better simulated performance after costs.

A better regression fit alone is not evidence of a better investment
strategy.

Before looking at holdout results, define:

- Candidate universe and pair-selection method.
- Formation, validation and untouched test periods, or a documented
  walk-forward process.
- Hedge-ratio and factor-estimation windows.
- Spread and z-score definitions.
- When each signal becomes available.
- Entry, exit, maximum holding period and risk-control assumptions.
- Position sizing, gross/net exposure and P&L for both legs.
- Factor model and how factor information affects the comparison.
- Data exclusions and treatment of missing observations.

Use ±2 entry and exit at zero only as an initial hypothesis if appropriate.
Do not tune thresholds on the untouched test sample.

Avoid choosing pairs using information from the full test period.


## 6. Data and point-in-time requirements

Verify existing stock data for:

- Security identity, ticker changes and share classes.
- Adjusted versus unadjusted prices and total-return suitability.
- Dividends, splits and corporate actions.
- Delistings and survivorship bias.
- Exchange coverage, currency and trading calendars.
- Missing, stale or invalid prices.

Investigate suitable market and factor data, including the Kenneth French
Data Library if appropriate. Check its official documentation for units,
frequency, risk-free-rate convention, history revisions, availability and
permitted use.

For each dataset, record source, retrieval time, coverage, version or hash,
adjustment basis and any known historical revision issue.

Do not claim a strict point-in-time backtest if the data cannot support
one. Separate:
- Strict point-in-time data.
- Retrospective revised data.
- Synthetic fixtures.

If the required data is unavailable or incompatible, implement the
calculations and simulation on synthetic fixtures, with an explicit
data-gap report. Do not present synthetic profits as market evidence.


## 7. Realistic simulated execution

For each simulated pair:

- Calculate positions and P&L for both legs.
- Include fees, spread and slippage for entry and exit.
- Model short borrow costs, availability, financing and dividend
  obligations where applicable.
- If real borrow data is missing, use labelled hypothetical assumptions
  and do not claim the short was executable.
- Use a signal only after its inputs become available; do not execute at
  a closing price that was needed to generate the signal.
- Handle overlapping trades, unfinished positions and exit conditions.
- Distinguish stock-level results from portfolio-level results.
- Report the amount and denominator used for return calculations.

Run cost-sensitivity scenarios rather than relying on one optimistic cost.


## 8. Output and evaluation

For each eligible pair, report:

- The economic reason for pairing them.
- Data sources, periods and eligibility.
- Hedge ratio and how it was estimated.
- Current or historical spread and z-score for the relevant date.
- Historical factor exposures and their uncertainty, where supportable.
- Whether a relevant news item exists, its source and timestamp.
- The strongest reason the relationship may have changed.
- What remains unknown.

For the pilot, report:

- Number of pairs considered, excluded and selected.
- Selection criteria and excluded-data reasons.
- Number of trades and holding periods.
- Gross and net performance, turnover and assumed costs.
- Exposure, drawdown, stopped trades and unclosed positions.
- Performance by time period, including a separate untouched test.
- Comparison with each baseline.
- Model uncertainty, overlapping observations and multiple-testing risk.
- Whether apparent improvements are economically meaningful after costs.

Do not claim profitability, a durable edge or a causal news explanation
from a small or biased sample.


## 9. Sentinel UX concept

Propose a compact “Relative opportunities” card for a future interface:

- The two companies and why they are comparable.
- The measured divergence and its historical context.
- Broad-factor exposure, only if reliably estimated.
- One sourced relevant development, if available.
- The most important counterpoint and unknown.
- A link to inspect the method, data and sources.

Use plain English, not a wall of finance terminology. Show examples with
clearly marked placeholders or synthetic data. Do not add a simulated
expected return, probability, buy/short instruction or price target to
the live interface.

Do not make the visual redesign the main engineering task; coordinate it
later with the planned Lovable design work.


## 10. Tests and project boundaries

Include meaningful tests for:

- Independently checked spread, hedge-ratio and z-score examples.
- Factor regression and percentage/decimal/frequency conversions.
- Missing dates, zero variance, collinear factors and insufficient data.
- No look-ahead in pair selection, factors or execution.
- Both legs’ P&L, fees, borrow and dividend assumptions.
- Splits, missing bars, ticker changes and invalid price data.
- Structural breaks and non-converging positions.
- Unavailable and incomplete-data states.
- No mutation of existing cases, rankings or Practice records.

Run the appropriate tests and report their actual results.

Do not:
- Place real trades or connect a broker.
- Change the running automated Practice experiment or its policy.
- Change existing research decisions, rankings or evidence-score weights.
- Purchase a data subscription.
- Weaken append-only, point-in-time, security or owner-isolation rules.
- Merge or deploy automatically.

Work in a reviewable branch or pull request.


## 11. Final report

Provide:

1. The actual source version and existing related work.
2. What was built, tested and what remains a concept.
3. The precise joint logic and formulas.
4. Data sources, coverage and limitations.
5. Baselines, simulated costs and evaluation periods.
6. Results, clearly labelled synthetic or historical.
7. Whether factor information improved anything out of sample.
8. Tests and any production or browser checks actually performed.
9. A plain-English recommendation for the next experiment.
10. What would still be needed before this could inform a directional
    recommendation or a separate virtual trading experiment.