# From research screen to investment adviser: what to build, in order (2026-11-13)

Every item is a hypothesis to test, not a proven edge. Long-term and event-driven work stay separate: different cases, different horizons, different experiments, never pooled results.

## What the current sources can and cannot support

| Source | Have | Cost | Limits |
|---|---|---|---|
| Alpaca market news | Headline, provider summary, ticker tags, timestamps | Free | One provider; tags can be wrong; article text not read |
| SEC EDGAR | Company identity, filing index, annual and quarterly figures (XBRL), filing dates | Free | US filers only; no guidance, no segment detail without reading filings |
| Alpaca IEX prices | Live quote in market hours, daily bars | Free | One exchange; wide or stale quotes off-hours |
| Missing | Analyst consensus, guidance history, sector/industry codes, earnings-call text, full-market prices | Paid, except SIC codes (free from SEC) | — |

## 1. Event-driven ideas (now → 4 weeks)

- **Confirm the event from the company itself (free, highest value).** For an earnings or deal headline, check for an 8-K or 10-Q filed by that company within two days. A match confirms both the company and the event; no match is a warning. This would have caught the ams-OSRAM/AMS mix-up without any text rule.
- **Read the filing, not just the headline.** Pull the reported quarter from the 10-Q the day it is filed, so "revenue up X%" is the new quarter, not last year's.
- **Capacity.** After this PR the queue read is cheap; the limit is 6 assessments in one request. Next: split the hourly run into separate calls (scan, assess, outcomes, experiment) and raise the batch.
- **Validation:** outcomes at 5 and 20 trading days by label, evidence band, price basis and event type, against SPY and against all assessed cases. First 5-day results about 19–20 November; a first honest read needs a few hundred cases.

## 2. Valuation and "what is already in the price" (2–6 weeks, free part)

- **Free now:** price move before and after the report vs SPY (built), P/E against the company's own history from SEC EPS and archived closes, and SIC-code peers from SEC.
- **Needs paid data:** beat/miss versus expectations and guidance changes. Without it Sentinel must keep saying "unknown".
- **Validation:** does a large run-up before the report go with worse 20-day outcomes? Test on stored cases before using it in any rule.

## 3. Long-term structural themes (design first, 4–8 weeks)

- **Lead, not proof.** A WEF agenda, policy bill or agency report becomes a *theme record*: what is changing, the document, its date, and the evidence. The founder adds or approves themes; Sentinel does not invent them.
- **Theme → companies.** Map through SEC filings: companies whose 10-K business description or risk factors mention the theme's terms, with revenue exposure where a segment is reported. Each mapping cites the filing passage.
- **A different case type:** `theme_case`, horizon 1–3 years, reviewed on each annual and quarterly filing, with the founder's kill criteria (already built for followed companies).
- **Validation:** 250-trading-day outcomes vs SPY and vs a sector ETF, a separate experiment ledger, and no claim before a year of record.
- **Missing:** full-text filing search (SEC's is free but rate-limited), sector benchmarks, and a reader for long documents. A model may summarise a filing only with cited passages and no numbers of its own.

## 4. Portfolio fit and concentration (2–4 weeks)

- SIC industry on every case (free), so the idea card can say "you already hold two companies in this industry".
- Run the existing risk check on the experiment's holdings; cap industry concentration as an experiment rule (a new version).
- Real holdings only if the founder enters them by hand; no broker link.

## 5. Tracking and learning (continuous)

- One table: every assessed case, its label, score band, price basis, event type, and 5/20/60/120-day result vs SPY.
- The experiment vs SPY, vs "every case that met the rules", and vs "a random assessed case".
- A rule changes only as a new version, started prospectively, compared side by side. Twenty closed trades is the minimum before saying anything; a few hundred before trusting it.

## Not planned

Real-money execution, broker connection, social-media sentiment, model-generated probabilities or price targets.
