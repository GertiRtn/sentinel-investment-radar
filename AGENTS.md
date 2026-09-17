# AGENTS.md — read this before changing anything

Sentinel is a personal investment **research** platform. Its value is that its own record can be trusted. Every rule below exists to protect that, and each one has been verified working in the code as of 2026-09-17.

**If you are starting a session: read this file and `docs/HANDOFF.md`, then state back what you understand the current state to be, before writing code.**

---

## Invariants — breaking one is a regression, regardless of what it enables

1. **Nothing is mutated.** No UPDATE, no DELETE on captured data, facts, journal entries, resolutions, criteria or evaluations. Change is expressed by appending a superseding record. This is enforced by **36 SQL triggers** (`RAISE(ABORT, ...)`) in `drizzle/`. Do not remove or weaken a trigger. If a migration needs one dropped, stop and ask.

2. **`known_from` governs every read.** Any query must be answerable as of a past timestamp using only records where `known_from <= T`. For SEC facts, `known_from` is the **filing date**, never the period end (`e.filed + 'T23:59:59.999Z'` in `lib/sentinel/financial.ts`). Changing this to the period end introduces look-ahead bias into every historical query and will not announce itself.

3. **Unevaluable is not passing.** A check that cannot run returns `unknown`. It never returns `pass`, never renders green, never renders blank. In `evaluate()`, any `unknown` child forces the whole result to `unknown`. Keep it that way.

4. **No value reaches the UI without provenance** — source, source timestamp (or explicit null), ingest timestamp, staleness, and confidence.

5. **No model-generated numbers.** No probability, forecast, score or estimate produced by a language model reaches the UI. Probabilities are the user's own, recorded before the outcome, scored with Brier after. Extraction from a source must cite the span; uncited claims are dropped, not caveated.

6. **No composite scores.** Separate assessments only. A single number hides which input is weak.

7. **Alerts inform, never instruct.** No "buy", "sell", "opportunity" or price target in any alert body.

8. **Credentials stay server-side.** No key in a client bundle, in `localStorage`, or in any user-visible field. `.env` stays gitignored; `.env.example` carries empty values.

9. **Tier 5 sources are not ingested** — no social media, price commentary or TV. The information hierarchy is: filings and official releases (Tier 1) → company communications → ecosystem → interpretation → narrative (Tier 5, excluded).

---

## Verified working — do not rebuild

- Server-side persistence on Cloudflare D1; writes go through `POST /api/*`, not `localStorage`
- Immutability enforced by SQL triggers, not application discipline
- Point-in-time queries, with two distinct clocks in `companyFile()`: `public` (what was publicly knowable then) vs `recorded` (what Sentinel actually held then). These answer different questions — keep both.
- Raw captures gzipped to R2 with SHA-256 content-hash dedup
- SEC: URL allowlist, `redirect:'manual'`, atomic token bucket deliberately below SEC's 10/s ceiling, `User-Agent` with contact required
- Restatement handling in `selectFacts`: latest `known_from`, then tag priority, then accession
- Resolution as append (`resolution_record`), with chain-key uniqueness and a required reference to the latest resolution
- `supersede_reason` is NOT NULL on `kill_criterion` — the edit discipline is schema-enforced
- `owner_earnings` and `maintenance_capex` are hard-wired unavailable until a human supplies a dated estimate and its triangulation method. Depreciation is not a substitute.
- 23 tests passing (`tests/*.mjs`, Miniflare + real D1 + migrations)

---

## Out of scope — do not build without being asked

Background scheduling and external delivery · decision gates and cooling-off enforcement · portfolio limits · equity or gold price feeds (needs a paid provider) · breaking-news sources beyond ECB/Fed (needs a licensed feed, out of budget) · event→company exposure mapping · anything in the Tier 5 list.

---

## Running the tests

`pnpm install` then `node --test tests/`.

Note: `pnpm-workspace.yaml` currently lacks a `packages:` field, which makes `pnpm install` fail. Add:

```yaml
packages:
  - '.'
```

Never run `pnpm install` with `--config.minimumReleaseAge=0`. That override bypasses the seven-day quarantine on newly published packages, which exists to avoid pulling a freshly compromised release, and it rewrites ~570 lines of the lockfile.

---

## Session discipline

- Commit with clear messages. Never force-push.
- Append to `docs/HANDOFF.md` at the end of every session. Never rewrite an earlier entry.
- If you could not verify something, say so. An unverified item reported as passing is worse than a failure reported honestly — that is the entire premise of this system.
