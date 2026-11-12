import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const esbuild=require(require.resolve('esbuild',{paths:[require.resolve('wrangler/package.json')]}));
const b=await esbuild.build({stdin:{contents:"export {evaluate,Predicate,QUARTERLY_METRICS} from './lib/sentinel/criteria';export {derive,quarterlyFigures} from './lib/sentinel/financial';export {thesisStatus,isQuarterlyOnly} from './lib/sentinel/thesis-monitor';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'cf-stub',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'cf',namespace:'cf'}));b.onLoad({filter:/.*/,namespace:'cf'},()=>({contents:'export const env={};',loader:'js'}));}}]});
const M=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));

let n=0;const fact=(metric,value,start,end,filed,tag='Revenues')=>({id:'f'+(n++),entity_id:'sec:1',metric,source_tag:tag,value,unit:'USD',period_start:start,period_end:end,fiscal_year:null,fiscal_period:null,form:'10-Q',known_from:filed+'T23:59:59.999Z',filed,accession:'0000000001-26-'+String(n).padStart(6,'0'),raw_event_id:'raw',recorded_at:filed+'T23:59:59.999Z'});
const q=(metric,v,y,qn,tag)=>{const s=[null,['01-01','03-31'],['04-01','06-30'],['07-01','09-30']][qn];return fact(metric,v,`${y}-${s[0]}`,`${y}-${s[1]}`,`${y}-${['','05-10','08-10','11-10'][qn]}`,tag);};
const rows=[
 {...fact('revenue',1000,'2025-01-01','2025-12-31','2026-02-20'),form:'10-K'},
 q('revenue',100,2025,1),q('revenue',110,2025,2),q('revenue',120,2025,3),
 q('revenue',105,2026,1),q('revenue',100,2026,2),q('revenue',115,2026,3),
 q('cfo',-5,2026,2,'NetCashProvidedByUsedInOperatingActivities'),q('cfo',-8,2026,3,'NetCashProvidedByUsedInOperatingActivities'),
];
const AS_OF='2026-11-12T00:00:00.000Z';
const run=(pred,asOf=AS_OF,data=rows)=>M.evaluate(M.Predicate.parse(pred),M.derive(data,asOf),[],asOf,M.quarterlyFigures(data,asOf));

test('year-on-year quarterly condition: two consecutive reported quarters below the same quarter last year trips',()=>{
 const r=run({all:[{metric:'revenue',op:'<',value:0,period:'quarter',basis:'yoy_pct',consecutive_periods:2}]});
 assert.equal(r.result,'trip',r.reason);assert.equal(r.checks[0].streak,2);
 assert.match(r.reason,/revenue \(quarter to 2026-09-30\): -4\.2% vs same quarter a year earlier < 0; 2 of 2 consecutive reported quarters/);
 assert.ok(Math.abs(r.checks[0].measured[1]-(100/110-1)*100)<1e-9);
 assert.equal(run({all:[{metric:'revenue',op:'<',value:0,period:'quarter',basis:'yoy_pct',consecutive_periods:3}]}).result,'pass','Q1 2026 grew, so a 3-quarter streak does not hold');
});

test('level basis: cash burn in consecutive quarters',()=>{
 const r=run({all:[{metric:'cfo',op:'<',value:0,period:'quarter',consecutive_periods:2}]});
 assert.equal(r.result,'trip');assert.deepEqual(r.checks[0].measured,[-8,-5]);
});

test('the unreported fiscal Q4 does not break a streak; any other missing quarter makes it unknown',()=>{
 const early=run({all:[{metric:'revenue',op:'<',value:200,period:'quarter',consecutive_periods:2}]},'2026-06-01T00:00:00.000Z');
 assert.equal(early.result,'trip',early.reason);assert.deepEqual(early.checks[0].values.map(v=>v.period_end),['2026-03-31','2025-09-30']);
 const gap=rows.filter(f=>!(f.metric==='revenue'&&f.period_end==='2026-06-30'));
 const r=run({all:[{metric:'revenue',op:'<',value:200,period:'quarter',consecutive_periods:2}]},AS_OF,gap);
 assert.equal(r.result,'unknown');assert.match(r.reason,/missing quarter between 2026-03-31 and 2026-09-30/);
});

test('only data filed by the evaluation time is used',()=>{
 const r=run({all:[{metric:'revenue',op:'<',value:0,period:'quarter',basis:'yoy_pct'}]},'2026-10-01T00:00:00.000Z');
 assert.equal(r.checks[0].values[0].period_end,'2026-06-30','Q3 2026 was filed in November and is not yet known');
});

test('unsupported quarterly metrics, missing comparisons and annual yoy stay unknown — never a pass',()=>{
 for(const pred of [{metric:'cash_conversion',op:'<',value:1,period:'quarter'},{metric:'net_debt',op:'>',value:0,period:'quarter'},{metric:'cfo',op:'<',value:0,period:'quarter',basis:'yoy_pct'},{metric:'revenue',op:'<',value:0,basis:'yoy_pct'}]){
  const r=run({all:[pred]});assert.equal(r.result,'unknown',JSON.stringify(pred));
 }
 assert.ok(M.QUARTERLY_METRICS.includes('revenue')&&!M.QUARTERLY_METRICS.includes('roic'));
});

test('annual criteria keep their exact original meaning',()=>{
 const pred={all:[{metric:'revenue',op:'<',value:5000}]};
 const withQ=M.evaluate(M.Predicate.parse(pred),M.derive(rows,AS_OF),[],AS_OF,M.quarterlyFigures(rows,AS_OF));
 const without=M.evaluate(M.Predicate.parse(pred),M.derive(rows,AS_OF),[],AS_OF);
 assert.deepEqual(withQ,without);assert.match(without.reason,/consecutive annual fiscal periods/);
 assert.deepEqual(M.Predicate.parse(pred),{all:[{...pred.all[0],consecutive_periods:1}]},'no period or basis field is added to annual predicates (consecutive_periods defaulted before too)');
});

const crit=(predicate,result,reason='r')=>({id:Math.random()+'',predicate:JSON.stringify(predicate),latest:{result,reason,evaluatedAt:AS_OF,snapshot:{checks:[{streak:0}]}}});
const Q={all:[{metric:'revenue',op:'<',value:0,period:'quarter',basis:'yoy_pct',consecutive_periods:2}]},Y={all:[{metric:'revenue',op:'<',value:0}]};
test('Following: a quarterly trip is an early warning (Weakening); an annual trip is Broken',()=>{
 const thesis={text:'Growth continues.',recordedAt:AS_OF};
 assert.equal(M.thesisStatus({thesis,criteria:[crit(Q,'trip','q tripped'),crit(Y,'pass')]}).status,'Weakening');
 assert.match(M.thesisStatus({thesis,criteria:[crit(Q,'trip','q tripped')]}).why,/^Quarterly early warning: q tripped/);
 assert.equal(M.thesisStatus({thesis,criteria:[crit(Q,'trip'),crit(Y,'trip')]}).status,'Broken');
 const mixed=M.thesisStatus({thesis,criteria:[crit(Q,'trip','q tripped'),crit(Y,'unknown','no data')]});assert.equal(mixed.status,"Can't check");assert.match(mixed.why,/no data.*quarterly early warning tripped: q tripped/);
 assert.equal(M.isQuarterlyOnly(JSON.stringify({any:[{event:'late_filing'}]})),false);
 assert.equal(M.isQuarterlyOnly('not json'),false);
});
