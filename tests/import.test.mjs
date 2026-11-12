import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {createRequire} from 'node:module';
import {schemaFromSnapshot,insertOrder,planImport,rowsFromExport,tableDigest,verifyArchiveObject} from '../scripts/migrate/plan.mjs';
const require=createRequire(import.meta.url);
const {Miniflare}=require(require.resolve('miniflare',{paths:[require.resolve('wrangler/package.json')]}));

const snapshot=JSON.parse(readFileSync('drizzle/meta/'+readdirSync('drizzle/meta').filter(f=>f.endsWith('_snapshot.json')).sort().at(-1),'utf8'));
const schema=schemaFromSnapshot(snapshot);
const migrations=readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort().flatMap(f=>readFileSync(join('drizzle',f),'utf8').split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean));

const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("")}}',compatibilityDate:'2026-05-15',d1Databases:{SOURCE:'source',TARGET:'target'}});
const source=await mf.getD1Database('SOURCE'),target=await mf.getD1Database('TARGET');
for(const db of [source,target])for(const s of migrations)await db.prepare(s).run();

// Two linked rows per table, every column filled, foreign keys pointing at real parents.
const fkOf=t=>Object.fromEntries(Object.values(snapshot.tables[t].foreignKeys??{}).map(fk=>[fk.columnsFrom[0],fk.tableTo]));
const idOf=(t,i)=>t==='source_state'?`src-${i}`:`${t}-${i}`;
for(const t of insertOrder(schema)){
 const cols=snapshot.tables[t].columns,fks=fkOf(t);
 for(const i of [1,2]){
  const row={};
  for(const [c,def] of Object.entries(cols)){
   if(def.primaryKey)row[c]=idOf(t,i);
   else if(fks[c])row[c]=idOf(fks[c],i);
   else if(c==='owner')row[c]='chatgpt-owner-123';
   else row[c]=def.type==='integer'?i:def.type==='real'?i+0.25:`${t}.${c}.${i} it's "quoted" ✓`;
  }
  const names=Object.keys(row);
  await source.prepare(`INSERT INTO "${t}" (${names.map(n=>`"${n}"`).join(',')}) VALUES (${names.map(()=>'?').join(',')})`).bind(...Object.values(row)).run();
 }
}
const exported={};
for(const t of Object.keys(schema))exported[t]=rowsFromExport((await source.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all()));

test('every table is copied exactly and verifies by digest',async()=>{
 const plan=planImport(exported,schema);
 assert.deepEqual(plan.owners,['chatgpt-owner-123']);
 for(const s of plan.statements)await target.prepare(s.sql).bind(...s.params).run();
 for(const s of plan.summary.filter(s=>s.digest)){
  const rows=(await target.prepare(`SELECT * FROM "${s.table}" ORDER BY rowid`).all()).results;
  assert.equal(rows.length,2,s.table);
  assert.equal(tableDigest(rows,schema[s.table].columns),s.digest,s.table);
 }
 assert.equal((await target.prepare('SELECT count(*) n FROM sec_rate').first()).n,0,'operational token bucket is not copied');
});

test('re-running the import is harmless',async()=>{
 const plan=planImport(exported,schema);
 for(const s of plan.statements)await target.prepare(s.sql).bind(...s.params).run();
 const rows=(await target.prepare('SELECT * FROM signal_log').all()).results;
 assert.equal(rows.length,2);
 assert.equal(tableDigest(rows,schema.signal_log.columns),plan.summary.find(s=>s.table==='signal_log').digest);
});

test('imported records are still protected by the immutability triggers',async()=>{
 await assert.rejects(target.prepare("UPDATE signal_log SET body='edited'").run());
 await assert.rejects(target.prepare('DELETE FROM financial_fact').run());
});

test('a changed value is caught by verification',async()=>{
 const rows=structuredClone(exported.fact);rows[0].value=999;
 assert.notEqual(tableDigest(rows,schema.fact.columns),tableDigest(exported.fact,schema.fact.columns));
});

test('bad exports are rejected before anything is written',()=>{
 assert.throws(()=>planImport({...exported,not_a_table:[]},schema),/not a Sentinel table/);
 assert.throws(()=>planImport({...exported,entity:[...exported.entity,exported.entity[0]]},schema),/duplicate primary key/);
 assert.throws(()=>planImport({...exported,entity:[{...exported.entity[0],surprise:1}]},schema),/unknown column/);
 assert.throws(()=>planImport({...exported,entity:[{...exported.entity[0],id:null}]},schema),/missing primary key/);
 assert.throws(()=>rowsFromExport({nope:true}),/Unrecognised export format/);
});

test('R2 originals are checked against their content-addressed key',async()=>{
 const text='{"cik":320193}',key='sec/'+createHash('sha256').update(text).digest('hex')+'.json.gz';
 assert.equal((await verifyArchiveObject(key,gzipSync(text))).ok,true);
 assert.equal((await verifyArchiveObject(key,gzipSync(text+' '))).ok,false);
 assert.equal((await verifyArchiveObject(key,Buffer.from('not gzip'))).ok,false);
 assert.equal((await verifyArchiveObject('other/thing',gzipSync(text))).ok,false);
});

test.after(()=>mf.dispose());
