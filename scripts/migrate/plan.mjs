// Pure planning and verification for moving Sentinel data from the ChatGPT
// Sites database into the owner's own D1. No network, no Worker imports, so
// the same code is exercised by tests/import.test.mjs.
//
// Principle: records are copied exactly. No value is rewritten, no row is
// dropped silently, and the result is verified by per-table content digests.
import { createHash } from 'node:crypto';

/** Operational state that is rebuilt automatically and must not be copied. */
export const SKIPPED_TABLES = new Set(['sec_rate']);

/** Tables, columns and foreign keys from a drizzle snapshot JSON. */
export function schemaFromSnapshot(snapshot) {
  const tables = {};
  for (const [name, t] of Object.entries(snapshot.tables)) {
    const columns = Object.keys(t.columns);
    const pk = columns.filter(c => t.columns[c].primaryKey);
    const deps = [...new Set(Object.values(t.foreignKeys ?? {}).map(fk => fk.tableTo).filter(x => x !== name))];
    tables[name] = { columns, pk: pk.length ? pk : null, deps };
  }
  return tables;
}

/** Parent tables before children, so foreign keys hold on every insert. */
export function insertOrder(schema) {
  const order = [], seen = new Set(), visiting = new Set();
  const visit = name => {
    if (seen.has(name)) return;
    if (visiting.has(name)) throw new Error(`Foreign-key cycle at ${name}`);
    visiting.add(name);
    for (const dep of schema[name].deps) if (schema[dep]) visit(dep);
    visiting.delete(name); seen.add(name); order.push(name);
  };
  for (const name of Object.keys(schema).sort()) visit(name);
  return order;
}

/** Accepts a plain row array, D1's `{results:[...]}`, or wrangler's `[{results:[...]}]`. */
export function rowsFromExport(value) {
  if (Array.isArray(value) && value.every(r => r && typeof r === 'object' && !Array.isArray(r) && !('results' in r))) return value;
  if (Array.isArray(value) && value.length === 1 && Array.isArray(value[0]?.results)) return value[0].results;
  if (value && Array.isArray(value.results)) return value.results;
  throw new Error('Unrecognised export format: expected an array of rows or a D1 {results:[...]} object');
}

/**
 * Validate an export against the schema and build the insert statements.
 * `exported` maps table name -> row array. Returns a plan or throws with every
 * problem listed, so nothing is half-imported because of a bad file.
 */
export function planImport(exported, schema) {
  const problems = [], statements = [], summary = [];
  for (const name of Object.keys(exported)) {
    if (!schema[name]) problems.push(`"${name}" is not a Sentinel table`);
  }
  const owners = new Set();
  for (const name of insertOrder(schema)) {
    const rows = exported[name];
    if (rows === undefined) { summary.push({ table: name, rows: 0, note: SKIPPED_TABLES.has(name) ? 'skipped (operational)' : 'not in export' }); continue; }
    if (SKIPPED_TABLES.has(name)) { summary.push({ table: name, rows: 0, note: `skipped (operational, ${rows.length} rows ignored)` }); continue; }
    const { columns, pk } = schema[name];
    const keys = new Set();
    rows.forEach((row, i) => {
      const unknown = Object.keys(row).filter(c => !columns.includes(c));
      if (unknown.length) problems.push(`${name} row ${i}: unknown column(s) ${unknown.join(', ')}`);
      for (const [c, v] of Object.entries(row)) {
        if (v !== null && !['string', 'number', 'boolean'].includes(typeof v)) problems.push(`${name} row ${i}: column ${c} has an unsupported value type`);
      }
      if (pk) {
        const key = JSON.stringify(pk.map(c => row[c]));
        if (pk.some(c => row[c] === undefined || row[c] === null)) problems.push(`${name} row ${i}: missing primary key`);
        else if (keys.has(key)) problems.push(`${name} row ${i}: duplicate primary key ${key}`);
        keys.add(key);
      }
      if (typeof row.owner === 'string') owners.add(row.owner);
      const cols = columns.filter(c => c in row);
      statements.push({
        table: name,
        sql: `INSERT OR IGNORE INTO "${name}" (${cols.map(c => `"${c}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
        params: cols.map(c => (typeof row[c] === 'boolean' ? Number(row[c]) : row[c])),
      });
    });
    summary.push({ table: name, rows: rows.length, digest: tableDigest(rows, columns) });
  }
  if (problems.length) {
    const e = new Error(`Export failed validation (${problems.length} problem(s)):\n- ` + problems.slice(0, 50).join('\n- '));
    e.problems = problems; throw e;
  }
  return { statements, summary, owners: [...owners].sort() };
}

/**
 * Order-independent digest of a table's content. Columns missing from a row
 * count as null, matching what SELECT * returns after import.
 */
export function tableDigest(rows, columns) {
  const lines = rows.map(r => JSON.stringify(columns.map(c => (r[c] === undefined ? null : typeof r[c] === 'boolean' ? Number(r[c]) : r[c])))).sort();
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

/** R2 archive objects are named sec/<sha256 of the original>.json.gz: check that before upload. */
export async function verifyArchiveObject(key, gzippedBytes) {
  const m = /^sec\/([0-9a-f]{64})\.json\.gz$/.exec(key);
  if (!m) return { ok: false, reason: 'not a content-addressed SEC archive key' };
  const { gunzipSync } = await import('node:zlib');
  let original;
  try { original = gunzipSync(gzippedBytes); } catch { return { ok: false, reason: 'not valid gzip' }; }
  const digest = createHash('sha256').update(original).digest('hex');
  return digest === m[1] ? { ok: true } : { ok: false, reason: `content hash ${digest} does not match the key` };
}
