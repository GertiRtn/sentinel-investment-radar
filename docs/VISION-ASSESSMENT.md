# Sentinel: where it stands against the "investment adviser" vision (2026-11-13)

Written for the founder. Based on reading `main` at 021a518, the docs, a read-only look at the live Site on 2026-11-13 at about 12:30 UTC, and the test suite (152/152 before this work, 170/170 after).

## The vision in one line

Sentinel finds companies you did not ask about, tells you why one is worth a look, what could go wrong and how it fits your portfolio, and proves over time whether its ideas beat simply holding SPY.

## What works today

| Step | What exists | State on the live Site |
|---|---|---|
| Discovery | Alpaca market news, up to 250 headlines an hour, beyond the watchlist | Running. 2,097 topic-matched reports queued and growing |
| Assessment | Up to 6 cases an hour: SEC identity and figures, security check, price, three research rules, evidence score | Running. 200 recent cases |
| Case and evidence | Case sheet with "What changed?", evidence checklist, sources and dates | Published |
| Research team | Bull / bear / editor reading of one case | Rules template only. The AI model is off and has never run on real data |
| Outcomes | Every assessed case, including rejected ones, measured against SPY at 5 / 20 / 60 / 120 trading days | Zero records so far. The first are due around 19–20 November |
| Practice | $10,000 virtual portfolio you trade by hand, SPY benchmark, risk check | Published. No trades yet |

## What stops it behaving like an adviser

1. **It has never yet said "look at this one".** In two days and 200 cases, none met the research rules. Two causes were found:
   - The security-name check rejected ordinary NYSE shares (fixed in #25, published).
   - **New finding:** the P/E needed a live quote under five minutes old with a narrow spread. Outside US market hours the provider returns the stale closing quote with a huge spread (Tesla showed $374.96 bid / $413.75 ask at 05:25 UTC). So every case assessed off-hours, which is about three quarters of the week, ended as "not enough data". All 75 cases on the current screen were stuck this way. **Fixed in this PR** by using the last daily close when no live quote is usable.
2. **It cannot keep up.** About 250 headlines arrive per hour and 6 are assessed. The queue grew from 1,621 to 2,097 overnight. Most ideas are never looked at, and those that are may be days old.
3. **A ticker tag is not a company.** The provider tagged an ams-OSRAM report "AMS", which in the US is American Shared Hospital Services. Sentinel created a case for the wrong company and scored it 50/100. The screen did hold it back (company not named in the headline), but nothing told you it was probably the wrong company. **Fixed in this PR**: an explicit event-company match, a warning on Discover, and such cases are listed last.
4. **It has no opinion on upside or expectations.** There is no analyst consensus, guidance history or valuation model. Sentinel can say "evidence is strong and nothing obvious is wrong". It cannot say "this could be worth 30% more", and should not until there is a validated method.
5. **It has no track record.** Outcomes need time. Until a few hundred cases have 20-day results, nobody knows whether "meets research rules" or a high evidence score means anything.
6. **Only event-driven ideas exist.** Nothing reads long-term themes (reports, policy, WEF agendas). That needs new sources and a different kind of case.
7. **It does not know your real portfolio.** Fit is judged against virtual Practice positions only, and there is no sector data.

## What must be true before automated virtual decisions are credible

- Identity: the company is named in the headline, not just tagged (done here as a gate).
- Prices: every fill uses a recorded, fresh, narrow quote; no fill when the market is closed (done here).
- No look-back: only cases assessed after the experiment starts (done here).
- Costs and a fair benchmark: both the stock and the SPY comparison pay the same simulated costs (done here).
- Every decision recorded once, including skips, and never edited (done here).
- A comparison group: outcomes for all assessed cases already exist by design; they need time to fill.
- Enough closed trades: the panel says "too few to say anything" below 20.
- Still open: capacity (item 2), production verification of the outcome-load fix, and a database index (below).

## What depends on data Sentinel does not have

| Wanted | Blocked by |
|---|---|
| "Beat or missed expectations", "already priced in" | No timestamped consensus or guidance data (paid) |
| Upside, fair value, position sizing | No validated valuation or probability method; needs outcome history first |
| Long-term theme ideas | No theme sources ingested; needs a design for theme → company mapping |
| Sentiment | Social sources are excluded by rule (invariant 9); nothing reliable and free |
| Fit with your real holdings, sector exposure | No broker link (by decision) and no sector data |
| Full market coverage | One news provider on a free tier; one exchange (IEX) for prices |

## Operational risks found

- **Database growth (most urgent).** Almost every query filters `signal_log` by owner and kind, but the only general index is (owner, time). Each query therefore walks every row the owner has, and about 6,000 rows are added a day. This is the likely root of the "database overloaded" reports and it gets worse daily. A one-line index, `CREATE INDEX signal_owner_kind_time ON signal_log(owner, kind, created_at)`, should fix most of it. It is not in this PR because a failed production migration could block publishing; it should be its own small PR, applied and watched.
- **Outcome-load fix (#24) is still unverified in production.** No case is old enough yet.
- **The hourly run does everything in one request** (filings, news, discovery, assessment, outcomes, marks, and now the experiment step when switched on). It is already reported as partial at times.
- **Practice shows "unknown" value when the market is closed**, for the same wide-quote reason. Not fixed here.

## Built in this session

1. **Idea card** at the top of every case: Sentinel's view in one line, how sure it is, why now, what supports it, what could be wrong, what it does not know, and fit with your Practice portfolio. Rules only, no AI text, no invented numbers.
2. **Event-company match** (`event-match-v1`) and **last-close price basis** (`price-basis-v2`), the two reliability fixes above.
3. **Automated Practice experiment** (`auto-practice-v1`), working end to end with virtual money: you start it, Sentinel opens and closes positions by published rules, records every choice and skip, and compares with SPY after costs. Off until you click Start.

## Roadmap, in order

1. **Index and capacity.** Add the index. Then raise assessment throughput: split the hourly run into separate calls, drop reports older than a few days from the queue, and assess more than 6 per run.
2. **Let the record build (2–6 weeks).** Start the experiment. Watch outcomes arrive. Check the outcome-load fix on the first due cases.
3. **Judge the rules by results.** Outcomes by screen label, evidence band and price basis; the experiment against SPY and against a "random assessed case" baseline. Only then change a rule, as a new version.
4. **Better "why".** Switch on the Research team for about 30 cases and label them. Read the actual filing (8-K, earnings release) rather than only the headline.
5. **Exits and risk in the experiment.** Kill criteria as exits, the existing risk check on the experiment's holdings, block bootstrap.
6. **Long-term themes.** A second kind of case that starts from a theme document, with its own horizon and its own experiment, kept separate from event-driven results.
7. **Expectations and valuation.** Needs a paid data decision.
8. **Real money.** A separate, later decision, only after the virtual record justifies it. Nothing here connects to a broker.
