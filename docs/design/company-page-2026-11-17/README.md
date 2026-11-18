# Company page: design port screenshots (2026-11-17)

Real built company page (`pnpm build` then `pnpm start`). Only the API answers are fixtures, made by Sentinel's real pure
functions for a fictional company (`scripts/design/fixtures.mjs`). Reproduce with
`node scripts/design/screenshots.mjs http://127.0.0.1:8787 <outDir>`.

- Full pages at 1440 px and 390 px: `available-*`, `split_since-*`, `nci_over_10-*`.
- "What the price assumes" card in every real state, at both widths (`<state>-<width>-card.png`): available, SEC not
  loaded, SEC read failed, split since share count, possible split, split check not run, share classes, NCI over 10%,
  preferred over 10%, tag unreadable, not reported, checks not run.

Design source: Lovable project "Signal Scout Investment Desk", commit 7b5ec85 (styles.css, CompanyPage.tsx,
DecisionPanels.tsx, CompanyCharts.tsx). Fictional sample data only; not market data.
