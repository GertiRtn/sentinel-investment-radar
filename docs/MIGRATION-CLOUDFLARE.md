# Moving Sentinel from ChatGPT Sites to your own Cloudflare account

Written 2026-11-12. Read it top to bottom once before starting. Plan on one to two hours. Nothing in Sites is changed or deleted at any step, so you can stop at any point and fall back to the Sites version by resuming its scheduled task.

## What changes

| | ChatGPT Sites (today) | Your Cloudflare account |
|---|---|---|
| Sign-in | ChatGPT account | Cloudflare Access (one-time email code, or Google etc.), only your email allowed |
| Hourly work | A ChatGPT scheduled task calling `/mcp` | Cron Triggers: discovery every 15 min, watchlist hourly at :07, outcomes hourly at :37 (UTC) |
| Deploys | From the Sites project | `pnpm deploy:cloudflare` (Claude Code can run it) |
| Proof that runs happen | None | A `scheduled_run` record after every cron run |
| Cost | Included in ChatGPT | **Workers Paid, $5/month** (required: the free plan allows 10 ms of CPU per run, and SEC filings need far more). D1 and R2 usage at this size should fall within included allowances; check your first invoice. |

## You will need

- A Cloudflare account on the **Workers Paid** plan
- Node 22 and this repository checked out locally, `pnpm install` done
- About 10 minutes in the ChatGPT Sites project to export the data
- **New** Alpaca market-data keys (the old ones were pasted into a chat; rotate them in the Alpaca dashboard first)

---

## 1. Freeze the Sites copy

Pause the ChatGPT scheduled task that calls Sentinel's `refresh_saved_company_filings` tool. Anything Sites records after the export would not be carried over, so freezing first keeps the copy complete. Do not delete the task or the site.

## 2. Export the Sites data

Ask Codex/ChatGPT, inside the Sentinel Sites project:

> Export the complete Sentinel database for migration. For every table in the D1 database (`collector_run, criterion_alert, criterion_evaluation, derived_metric, entity, entity_watch, fact, filing, financial_fact, kill_criterion, maintenance_estimate, raw_event, research_memo, resolution_record, sec_run, signal_log, signal_resolution, source_state, workspace_revision`), read **all** rows with `SELECT * FROM <table> ORDER BY rowid`, paging until `has_more` is false, and write them unchanged as a JSON array to `<table>.json`. Do not filter, transform, round or summarise any value. Also download every object in the `ARCHIVE` R2 bucket to `r2/<object key>` (keys look like `sec/<hash>.json.gz`), byte for byte. Zip the folder as `sentinel.sentinel-export.zip` and give it to me as a download. Do **not** commit it to GitHub; the repository is public. Report the row count per table and the number of R2 objects.

Unzip it **outside** the repository, or into a folder named `sentinel-export/` (that name is git-ignored).

If R2 objects cannot be exported, continue with the tables only. The importer will list which original SEC captures are missing. Their metadata and the derived figures still import; only "view original filing response" fails for those, until a fresh SEC refresh stores new originals. Keep the Sites project until you're satisfied.

## 3. Check the export (writes nothing)

```bash
node scripts/migrate/import-sites-data.mjs --export ./sentinel-export
```

It prints the row count per table, checks every R2 file against its content hash, and prints the line **"Set the SENTINEL_OWNER_ID secret to exactly: …"**. Keep that value for step 7. It is your ChatGPT user id, and every existing record is filed under it. Using the same id means nothing has to be rewritten (the immutability triggers would refuse anyway).

## 4. Create the Cloudflare resources

```bash
npx wrangler login
npx wrangler d1 create sentinel          # copy the database_id it prints
npx wrangler r2 bucket create sentinel-archive
```

Put the printed `database_id` into `deploy/cloudflare/wrangler.jsonc` (replace the zeros) and commit it on a branch. It is an identifier, not a secret.

## 5. Create the tables and deploy

```bash
pnpm db:migrate:cloudflare               # creates all tables and the 36 immutability triggers
pnpm deploy:cloudflare                   # builds with SENTINEL_TARGET=cloudflare and deploys
```

Wrangler prints the address, `https://sentinel.<your-subdomain>.workers.dev`. Until step 7 is done, the app refuses **every** request. That is deliberate: it fails closed rather than open.

## 6. Turn on Cloudflare Access

In the Cloudflare dashboard, go to Workers & Pages → `sentinel` → **Access** tab → **Protect this Worker behind Access** → **All traffic**. For the policy, allow **only your email address**. Save.

Then open Zero Trust → Access → Applications → the application just created, and copy two values:

- **Team domain**: e.g. `yourteam.cloudflareaccess.com`
- **Application Audience (AUD) tag**: a long hex string

## 7. Set the secrets

Each command prompts for the value; nothing goes into the repo. (`--config` tells wrangler which Worker the secret belongs to.)

```bash
C=deploy/cloudflare/wrangler.jsonc
npx wrangler secret put CF_ACCESS_TEAM_DOMAIN --config $C   # from step 6
npx wrangler secret put CF_ACCESS_AUD --config $C           # from step 6
npx wrangler secret put SENTINEL_OWNER_EMAIL --config $C    # the email you allowed in step 6
npx wrangler secret put SENTINEL_OWNER_ID --config $C       # the value printed in step 3
npx wrangler secret put ALPACA_DATA_KEY_ID --config $C      # the NEW key
npx wrangler secret put ALPACA_DATA_SECRET --config $C      # the NEW secret
npx wrangler secret put SEC_CONTACT_EMAIL --config $C       # optional; defaults to SENTINEL_OWNER_EMAIL
```

## 8. Import and verify

Create an API token at dash.cloudflare.com → My Profile → API Tokens, with **Account → D1 → Edit** permission. Then:

```bash
export CLOUDFLARE_API_TOKEN=...   CLOUDFLARE_ACCOUNT_ID=...
node scripts/migrate/import-sites-data.mjs --export ./sentinel-export --execute
```

It inserts every row in dependency order, uploads the R2 originals, then re-reads every table and compares a content digest with the export. **Continue only if it ends with "Every imported table matches the export exactly."** It is safe to re-run if interrupted. Delete the API token afterwards.

## 9. Smoke test

1. Open the workers.dev address. Cloudflare asks you to sign in, and then your existing watchlist and journal appear.
2. Open it in a private window and try a different email. Access refuses it.
3. After 15–20 minutes, check that the scheduler ran:

```bash
npx wrangler d1 execute sentinel --remote --config deploy/cloudflare/wrangler.jsonc --command \
  "SELECT created_at, json_extract(body,'$.cron') cron, json_extract(body,'$.status') status FROM signal_log WHERE kind='scheduled_run' ORDER BY created_at DESC LIMIT 10"
```

Each row is one cron run. `partial` or `failed` rows say which stage failed and why, in `body`.

## 10. Finish

- Leave the ChatGPT scheduled task paused. Keep the Sites project read-only for at least 30 days as a fallback and archive.
- Append the result (row counts, digest check, first scheduled runs) to `docs/HANDOFF.md`.

## If something goes wrong

- **Every page says "Sign in to access your research"** after signing in through Access: a secret from step 7 is missing or wrong. The Worker logs say "Cloudflare Access is not fully configured" when one is missing (`npx wrangler tail`).
- **The import reports DIFF**: do not switch over. Nothing was deleted anywhere; re-run, or bring the output to a Claude Code session.
- **Roll back**: resume the ChatGPT scheduled task. Sites was never modified.

## How the security works (for reviewers)

- `app/auth.ts`: with `SENTINEL_HOST=cloudflare`, only a Cloudflare Access JWT whose signature, issuer, audience and expiry verify against your team's published keys (`lib/sentinel/access-jwt.ts`) and whose email matches `SENTINEL_OWNER_EMAIL` is accepted. ChatGPT `oai-authenticated-*` headers are ignored on this host. Any missing setting refuses everyone.
- The Worker checks the token itself, so a request that somehow bypasses Access is still refused.
- `preview_urls` is off, so there is no second, unprotected address.
