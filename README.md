# Sentinel Investment Radar

Sentinel is a private investment-research workspace for evidence-first company analysis. It combines durable research notes, SEC filing ingestion, point-in-time financial history, prediction calibration, and immutable thesis-breaking criteria.

The application is a research system, not a broker or automated trading engine. It does not execute trades, promise returns, or convert incomplete evidence into recommendations.

## Current capabilities

- Server-synced watchlists, notes, and revision history
- Immutable research journal and prediction-resolution corrections
- SEC ticker/CIK resolution and company filing ingestion
- Traceable annual financial figures with filing, tag, accession, and capture provenance
- Point-in-time public-history and recorded-history views
- Three-state thesis checks: `pass`, `trip`, and `unknown`
- Durable source captures, stale-value handling, retries, and circuit-breaker records
- Private ChatGPT-owned workspace authentication

## Stack

- React 19 and Vinext
- Cloudflare Workers
- Cloudflare D1 and R2
- Drizzle migrations
- TypeScript and Zod
- Node test runner with Miniflare integration tests

## Local development

Requirements: Node.js `>=22.13.0` and pnpm `11.25.0`.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Useful commands:

```bash
pnpm build
pnpm db:generate
node --test tests/*.test.mjs
```

Local identity and Cloudflare bindings depend on the selected Sites execution profile. Runtime secrets belong in local or hosted environment settings and must never be committed.

## Data integrity principles

- Captured facts and research records are append-only.
- Historical queries use only information eligible at their selected cutoff.
- Missing evidence is shown as unavailable or unknown, never as zero or pass.
- Derived figures retain their inputs and calculation method.
- Corrections append a superseding record; earlier records remain visible.

## Important limitations

Background scheduling, external notifications, equity/gold pricing, broker synchronization, trade execution, and decision-gate enforcement are not active. SEC coverage is limited to supported filing metadata and USD US-GAAP tags. Review `docs/work-order-03-verification.md` for the latest acceptance evidence and unresolved checks.

## Security

Do not commit broker credentials, API keys, account exports, or personal investment records. The repository contains application source and tests only; production D1/R2 data remain outside GitHub.

## Status

Active private prototype. The deployed website remains owner-only.
