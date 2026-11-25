# Company page: "Load share counts" on stale SEC data (2026-11-25)

The real built company page (`pnpm build`, then `pnpm start`), taken at 2× pixel density with
`SCALE=2 node scripts/design/screenshots.mjs http://127.0.0.1:8787 <outDir> checks_not_run sec_not_loaded sec_failed split_since available`.
Only the API answers are fixtures, made by Sentinel's real pure functions for a fictional company (`scripts/design/fixtures.mjs`). They are not market data.

- `checks_not_run-*`: the case found on the live Site (EME). The calculation completes, but the company's SEC data was read before the current parser, so the API returns `canLoadShareCounts: true` with "Checks not run: noncontrolling interests, preferred stock". The card now shows "Load share counts" with one line explaining why. Full page and card at 1440 px and 390 px.
- `sec_not_loaded-*-card`, `sec_failed-*-card`: unchanged behaviour ("Load share counts" / "Try the SEC read again"); the button now sits under the state box instead of inside it.
- `split_since-*`, `available-*-card`: no button. The SEC data is current, so there is nothing to reload.
- Layout: "What the price assumes" and "What acting would change" are in the main column under Financials, as in the Lovable design. That move is PR #46's; it is not on the live Site until #46 is merged and published.
