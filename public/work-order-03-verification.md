# Sentinel Work Order 03 — implementation and verification

17 September 2026. Implemented on the private Sentinel site. Tests use isolated synthetic fixtures unless explicitly stated otherwise. No fixture financial data have been inserted into the production account.

## Requested verification

| # | Requirement | Result and evidence |
|---|---|---|
| 1 | Zero unhandled 503s for one hour | **Not verified.** Retained production logs did not establish the reported 503 cause. GET market/news now read durable storage without upstream requests; refresh uses a separate authenticated POST. Client reads retry three attempts. A production observation hour was not run. Storage/platform failure remains possible. |
| 2 | Forced source failure shows stale and increments failures | **Server path verified with fixtures.** BTC retained 123.45 and its original last-good timestamp across three failures; stale=true, failures 1/2/3, retryAt populated, circuit incident appended. Clearing the flag recovered to a fresh fixture quote in one requested refresh. A decision entry records the test in the isolated test journal. **Populated browser stale-card rendering and a production test-journal entry are not verified.** The flag was never enabled in production. |
| 3 | Resolution and Brier with original prediction unchanged | **Verified with fixtures.** POST resolution, correction via supersedes_id, two retained outcomes, historical outcome query, unchanged original JSON/probability. Brier is computed by the UI from outcome and original probability. No prediction mutation. |
| 4 | FY2023 revenue absent at 2024-06-01 | **Verified for a fixture filed 2024-11-01.** This is not a universal real-company assertion: a real FY2023 report filed before June must be returned. Public eligibility is based on the actual filing date, never period end. |
| 5 | Historical restatement selection | **Verified with fixtures.** Original revenue 100 through the interval before the later filing; 120 after its filing. Both records retained. Recorded-history mode excludes subsequently captured data. |
| 6 | Exact filing trip and deterministic replay | **Verified with fixtures.** Two annual cash-conversion breaches trip at accession 0000000001-24-000001 on its eligibility date, not before. Replay preserves input snapshot. A later correction appends pass with a supersedes link and retains the trip. |
| 7 | Unknown banner, never passing | **Server semantics verified.** Missing metric and missing fiscal year yield unknown; two unknown runs create an operational alert. **Browser checked:** unloaded records show a persistent amber unknown banner. Authenticated, populated state not verified in the preview. |
| 8 | Financial provenance | **Verified with fixture ingestion and response checks.** Figures carry input tag, accession, form, filed date, capture date, raw ID and method. UI offers filing links and original gzipped-response retrieval with SHA-256. **Three real US-company backfills and complete ten-year real coverage have not been verified.** |
| 9 | No captured-record mutations | **Verified by actual SQLite trigger tests.** UPDATE/DELETE fail for raw events, financial facts, predictions, resolutions, criteria and evaluations. New corrections append; operational cache, lease and token-bucket state remain intentionally mutable. |

Automated evidence: `tests/work-order03.test.mjs`, `tests/persistence.test.mjs`, `tests/feeds.test.mjs`, `tests/worker-feeds.test.mjs`. The integration tests use real Worker/D1/R2 emulation with mocked upstream responses. Production resources are provisioned at deployment, not represented as tested live source data.

## Important implementation decisions

- SEC transport uses a mandatory identifying User-Agent with configured SEC_CONTACT_EMAIL, or the signed-in account email. Values stay server-side; the UI explains the identification. No API key is required. The shared SQL token bucket has capacity one and refills at two requests/second, below the SEC ceiling. HTTP 403/429 pause requests; no identity rotation or evasive fallback.
- SEC originals are gzipped in R2, addressed by original-content SHA-256; D1 holds immutable capture metadata and object pointers. Ticker maps and SEC responses cache for 24 hours. Archives referenced by submissions are traversed for the last twelve years.
- Two distinct clocks: `filed`/`known_from` describes reconstructed public availability; `recorded_at` and successful ingest markers describe what Sentinel actually captured. The UI defaults to explicitly labelled reconstructed history. Filed dates are only day precision: eligibility uses end of that UTC date, conservatively preventing intraday look-ahead. This can delay eligibility of today's filings until the following day; it is not a real-time filing alert service.
- Financial identity includes source tag, unit and period start as well as entity, period end and accession. The work order's narrower uniqueness constraint would merge different durations or tags. All supported observations are kept. Only coherent annual durations and USD US-GAAP facts feed current calculations. Quarterly/YTD, IFRS and extension-tag reconstruction are not silently approximated.
- Pretax-income examples split a single long tag name over a plus sign; these are complete tag names, not a sum of two amounts. Debt components are summed only when both are available. Cost-of-revenue tags were added for gross margin.
- Effective tax rates with nonpositive pretax income or rates outside [0,1], nonpositive denominators and mismatched duration periods become unavailable. ROIC and incremental ROIC explicitly remain estimates under the 2%-of-revenue cash convention. EBITDA is labelled an operating-income-plus-depreciation proxy.
- Maintenance capex is a separate dated human estimate with a required method. Owner earnings remains unavailable until a complete reconciliation is available; depreciation is never substituted. This is an open limitation, not an implemented owner-earnings valuation.
- Ticker and CIK resolution are supported; ambiguous ticker matches return candidates. ISIN resolution is **not connected**. Unmatched identifiers and unsupported jurisdictions return explicit coverage messages without fabricating a company. SEC registrants outside the US may have CIKs; nationality alone does not determine coverage.
- Minimal immutable thesis memos anchor criteria. Position status is user-declared at memo creation; there is no portfolio reconciliation. Every criterion replacement requires justification, even if no position was declared. Successor rows reference predecessors; no superseded_by update occurs.
- Predicates use a single all/any group and typed comparisons, never evaluated code. Periods mean **annual fiscal periods**. A missing/irregular year breaks the streak. Any unknown child conservatively makes the group unknown, which is stricter than short-circuit three-valued logic and is explained in the UI.
- Auditor change uses 8-K Item 4.01. NT 10-K/Q indicates a late-filing notice, not a determination of legal noncompliance. Material weakness cannot be established by an 8-K item code alone, so it remains unknown. Absence of an event in incomplete metadata remains unknown.
- Evaluation snapshots preserve deterministic replay; the same criterion/as-of reuses its first evidence snapshot. A different as-of is needed to examine subsequently acquired evidence. Trips and subsequent passes remain visible. Alerts are stored in-app only and contain research evidence, not trade instructions.
- Resolution POST accepts a request UUID for safe retries, resolution_source_url and supersedes_id. Historical joins return the resolution eligible at the cutoff. Legacy immutable resolutions are still read. Legacy PUT resolution is removed; clients should reload to use POST.

## Remaining acceptance work

1. In the authenticated production account, add three companies in Company files and inspect actual coverage. AAPL, MSFT and LMT are useful test identifiers, not recommendations. No ten-year completeness is promised before inspecting each issuer's tags.
2. Run a timed, one-hour production observation with source failures and storage-read status separately recorded. Do not treat the short tests as this observation.
3. In an isolated authenticated test deployment, exercise the forced-failure flag and inspect the populated stale badge, age, unknown criterion banner and correction UI. Record the actual observation in that environment's journal. Do not inject fixtures into real research.
4. Complete an ISIN resolver, additional taxonomies/currencies, quarterly reconstruction and a complete owner-earnings reconciliation if required in a subsequent scope.

Explicit non-goals preserved: scheduled/background collectors, external notifications, decision-gate enforcement, equity/gold prices, additional breaking-news sources, generated forecasts, exposure mapping and composite scores.

## Primary technical references

- SEC API documentation: https://www.sec.gov/search-filings/edgar-application-programming-interfaces
- SEC developer access guidance: https://www.sec.gov/about/developer-resources
- SEC Form 8-K: https://www.sec.gov/files/form8-k.pdf
