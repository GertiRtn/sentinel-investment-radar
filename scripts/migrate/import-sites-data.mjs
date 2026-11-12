#!/usr/bin/env node
// Copy an export of the ChatGPT Sites database (and its R2 archive) into the
// owner's own Cloudflare D1 + R2, then prove the copy is exact.
//
//   node scripts/migrate/import-sites-data.mjs --export ./sentinel-export            # check only (default)
//   node scripts/migrate/import-sites-data.mjs --export ./sentinel-export --execute  # import + verify
//   node scripts/migrate/import-sites-data.mjs --export ./sentinel-export --verify   # verify only
//
// Export folder layout:
//   <table>.json          one file per table: rows as a JSON array (or D1 {results:[...]})
//   r2/sec/<sha256>.json.gz   optional: the ARCHIVE bucket objects, keys as paths
//
// Needs (for --execute / --verify): CLOUDFLARE_API_TOKEN with D1 edit rights,
// CLOUDFLARE_ACCOUNT_ID, and the real database_id in deploy/cloudflare/wrangler.jsonc.
// The export holds personal investment records: keep it out of this public repo.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { schemaFromSnapshot, planImport, rowsFromExport, tableDigest, verifyArchiveObject } from './plan.mjs';

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const value = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const exportDir = value('--export');
const mode = flag('--execute') ? 'execute' : flag('--verify') ? 'verify' : 'check';
if (!exportDir || !existsSync(exportDir)) { console.error('Usage: --export <folder> [--execute | --verify]'); process.exit(2); }

const snapshotFile = readdirSync('drizzle/meta').filter(f => /_snapshot\.json$/.test(f)).sort().at(-1);
const schema = schemaFromSnapshot(JSON.parse(readFileSync(join('drizzle/meta', snapshotFile), 'utf8')));
const wrangler = JSON.parse(readFileSync('deploy/cloudflare/wrangler.jsonc', 'utf8').replace(/^\s*\/\/.*$/gm, ''));
const d1 = wrangler.d1_databases.find(d => d.binding === 'DB');
const bucket = wrangler.r2_buckets.find(b => b.binding === 'ARCHIVE').bucket_name;

// ---- read and validate the export -------------------------------------------------
const exported = {};
for (const f of readdirSync(exportDir).filter(f => f.endsWith('.json'))) {
  exported[f.replace(/\.json$/, '')] = rowsFromExport(JSON.parse(readFileSync(join(exportDir, f), 'utf8')));
}
let plan;
try { plan = planImport(exported, schema); } catch (e) { console.error(e.message); process.exit(1); }

console.log(`Schema: ${snapshotFile}. Target D1: ${d1.database_name} (${d1.database_id}). Mode: ${mode}.\n`);
console.table(plan.summary.map(s => ({ table: s.table, rows: s.rows, note: s.note ?? '' })));
console.log(`\nOwner ids found in the export: ${plan.owners.length ? plan.owners.join(', ') : '(none)'}`);
if (plan.owners.length === 1) console.log(`→ Set the SENTINEL_OWNER_ID secret to exactly: ${plan.owners[0]}`);
if (plan.owners.length > 1) console.log('→ More than one owner id. Use the one that holds your research; the others stay readable only to themselves.');

// ---- R2 archive objects --------------------------------------------------------------
const r2Dir = join(exportDir, 'r2');
const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const objects = existsSync(r2Dir) ? walk(r2Dir).map(p => ({ path: p, key: relative(r2Dir, p).split(sep).join('/') })) : [];
const referenced = new Set((exported.raw_event ?? []).filter(r => String(r.source).startsWith('sec:')).map(r => { try { return JSON.parse(r.payload).objectKey; } catch { return null; } }).filter(Boolean));
const bad = [];
for (const o of objects) { const r = await verifyArchiveObject(o.key, readFileSync(o.path)); if (!r.ok) bad.push(`${o.key}: ${r.reason}`); }
const present = new Set(objects.map(o => o.key));
const missing = [...referenced].filter(k => !present.has(k));
console.log(`\nR2 archive: ${objects.length} object(s) in export, ${referenced.size} referenced by raw_event, ${missing.length} referenced but missing, ${bad.length} failing their content hash.`);
if (missing.length) console.log('  Missing originals keep their metadata, but "view original" will report them unavailable until they are copied.');
if (bad.length) { console.error('  Refusing to continue; these objects do not match their content hash:\n  - ' + bad.join('\n  - ')); process.exit(1); }

if (mode === 'check') { console.log('\nCheck passed. Nothing was written. Re-run with --execute to import.'); process.exit(0); }

// ---- D1 REST API ---------------------------------------------------------------------
const token = process.env.CLOUDFLARE_API_TOKEN, account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !account) { console.error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required.'); process.exit(2); }
if (/^0{8}-/.test(d1.database_id)) { console.error('deploy/cloudflare/wrangler.jsonc still has the placeholder database_id.'); process.exit(2); }
const endpoint = `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${d1.database_id}/query`;
async function query(sql, params = []) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sql, params }) });
    const body = await res.json().catch(() => null);
    if (res.ok && body?.success) return body.result[0].results;
    if ((res.status === 429 || res.status >= 500) && attempt < 5) { await new Promise(r => setTimeout(r, 1000 * 2 ** attempt)); continue; }
    throw new Error(`D1 query failed (HTTP ${res.status}): ${JSON.stringify(body?.errors ?? body)}`);
  }
}

if (mode === 'execute') {
  const tables = await query("SELECT name FROM sqlite_master WHERE type='table'");
  if (!tables.some(t => t.name === 'signal_log')) { console.error('Target D1 has no Sentinel tables. Run `pnpm db:migrate:cloudflare` first.'); process.exit(1); }
  let done = 0;
  for (const s of plan.statements) {
    await query(s.sql, s.params);
    if (++done % 100 === 0 || done === plan.statements.length) process.stdout.write(`\r  inserted ${done}/${plan.statements.length} rows`);
  }
  console.log();
  for (const o of objects) {
    const r = spawnSync('npx', ['wrangler', 'r2', 'object', 'put', `${bucket}/${o.key}`, `--file=${o.path}`, '--content-type=application/gzip', '--remote'], { stdio: 'inherit' });
    if (r.status !== 0) { console.error(`R2 upload failed for ${o.key}; re-run to resume (existing rows and objects are skipped).`); process.exit(1); }
  }
}

// ---- verify: per-table content digest of the target equals the export --------------
console.log('\nVerifying the target against the export...');
let failures = 0;
for (const s of plan.summary.filter(s => s.digest)) {
  const { columns } = schema[s.table], rows = [], page = s.table === 'raw_event' ? 25 : 500;
  for (let offset = 0; ; offset += page) {
    const batch = await query(`SELECT ${columns.map(c => `"${c}"`).join(',')} FROM "${s.table}" ORDER BY rowid LIMIT ? OFFSET ?`, [page, offset]);
    rows.push(...batch); if (batch.length < page) break;
  }
  const same = rows.length === s.rows && tableDigest(rows, columns) === s.digest;
  if (!same) failures++;
  console.log(`  ${same ? 'OK  ' : 'DIFF'} ${s.table}: export ${s.rows}, target ${rows.length}`);
}
console.log(failures ? `\n${failures} table(s) differ. Do not switch over; nothing has been deleted, re-run or investigate.` : '\nEvery imported table matches the export exactly.');
process.exit(failures ? 1 : 0);
