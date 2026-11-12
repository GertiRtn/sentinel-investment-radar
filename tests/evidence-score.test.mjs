import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const esbuild=require(require.resolve('esbuild',{paths:[require.resolve('wrangler/package.json')]}));
const load=async f=>{const b=await esbuild.build({entryPoints:[f],bundle:true,write:false,platform:'node',format:'esm'});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));};
const S=await load('lib/sentinel/evidence-score.ts');
const M=await load('lib/sentinel/morning-brief.ts');

const AS_OF='2026-11-12T18:00:00.000Z';
const ev=(label,value,changePercent=null)=>({label,value,changePercent,periodEnd:'2025-12-31',accession:'0000000000-26-000001'});
const brief=(o={})=>({stale:false,evidence:[ev('Revenue',o.rev??1e9,o.revChg??8),ev('Net income',o.ni??1e8),ev('Operating cash flow',o.cfo??2e8)]});
const price=r=>({status:'indicative',ratio:r,periodEnd:'2025-12-31'});
const qrev=chg=>({latestEnd:'2026-09-30',latestValue:110,priorEnd:'2025-09-30',priorValue:100,changePercent:chg,accession:'0000000000-26-000002',filed:'2026-10-30',rawEventId:'r'});
const full=o=>S.evidenceScore({topics:['Earnings or financial results'],relevance:{level:'direct_candidate'},price:price(18),brief:brief(),quarterlyRevenue:qrev(10),asOf:AS_OF,...o});

test('weights add up to 100 and a case passing every check scores 100',()=>{
 const r=full({});
 assert.equal(r.checks.reduce((s,c)=>s+c.points,0),100);
 assert.equal(r.score,100);assert.equal(r.band,'Strong evidence');assert.equal(r.coverage,100);
 assert.match(r.meaning,/not a probability/);
});

test('failed checks lower the score and say why, with their source',()=>{
 const r=full({price:price(52.8),quarterlyRevenue:qrev(-4),brief:brief({ni:-5e7})});
 assert.equal(r.score,100-15-15-10);
 const e3=r.checks.find(c=>c.id==='E3'),e4=r.checks.find(c=>c.id==='E4');
 assert.equal(e3.state,'fail');assert.equal(e3.detail,'P/E 52.8');
 assert.equal(e4.state,'fail');assert.match(e4.detail,/^-4\.0% vs same quarter/);assert.match(e4.source,/SEC filing/);
 assert.equal(r.band,'Mixed evidence');
});

test('unknown is never passing: unknown checks score 0 and are marked unknown',()=>{
 const r=full({quarterlyRevenue:null,price:{status:'unavailable',reason:'wide spread'}});
 for(const id of ['E3','E4'])assert.equal(r.checks.find(c=>c.id===id).state,'unknown');
 assert.equal(r.score,70);assert.equal(r.coverage,70);
});

test('too little known evidence gives no score at all',()=>{
 const r=S.evidenceScore({topics:['Earnings or financial results'],relevance:{level:'direct_candidate'},price:price(18),brief:{evidence:[]},asOf:AS_OF});
 assert.equal(r.status,'insufficient');assert.equal(r.score,null);assert.equal(r.band,null);assert.equal(r.coverage,45);
});

test('old annual figures count as unknown, not as evidence',()=>{
 const old={stale:false,evidence:[{...ev('Revenue',1e9,10),periodEnd:'2023-12-31'}]};
 assert.equal(full({brief:old}).checks.find(c=>c.id==='E5').state,'unknown');
});

test('quarterly YoY uses the same quarter a year earlier, same tag, known by the assessment time',()=>{
 const f=(end,value,tag='Revenues',known='2026-10-30T23:59:59.999Z')=>({metric:'revenue',value,unit:'USD',period_end:end,known_from:known,confidence:'reported',method:'r',reason:'',inputs:[{source_tag:tag,accession:'0000000000-26-00000'+end.slice(5,7),filed:known.slice(0,10),raw_event_id:'raw'}]});
 const q=[f('2026-09-30',120),f('2026-06-30',115,'Revenues','2026-07-30T23:59:59.999Z'),f('2025-09-30',100,'Revenues','2025-10-30T23:59:59.999Z'),f('2025-06-30',100,'Revenues','2025-07-30T23:59:59.999Z')];
 const r=S.quarterlyRevenueYoY(q,AS_OF);
 assert.equal(r.latestEnd,'2026-09-30');assert.equal(r.priorEnd,'2025-09-30');assert.equal(Math.round(r.changePercent),20);
 assert.equal(S.quarterlyRevenueYoY([f('2026-09-30',120),f('2025-09-30',100,'SalesRevenueNet')],AS_OF),null,'different tag is not comparable');
 assert.equal(S.quarterlyRevenueYoY(q,'2026-10-01T00:00:00.000Z').latestEnd,'2026-06-30','not yet filed at assessment time');
});

test('bands',()=>{
 assert.equal(S.scoreBand(70),'Strong evidence');assert.equal(S.scoreBand(69),'Mixed evidence');assert.equal(S.scoreBand(40),'Mixed evidence');assert.equal(S.scoreBand(39),'Weak evidence');assert.equal(S.scoreBand(null),null);
});

test('stored score is used as recorded; older cases are recomputed from stored fields',()=>{
 const stored=full({});assert.equal(S.caseEvidenceScore({evidenceScore:stored}),stored);
 const old=S.caseEvidenceScore({createdAt:AS_OF,event:{analysis:{topics:['Earnings or financial results']}},identity:{relevance:{level:'direct_candidate'}},price:price(18),brief:brief()});
 assert.equal(old.checks.find(c=>c.id==='E4').state,'unknown');assert.equal(old.score,85);
});

test('morning brief ranks strong cases by evidence score and names it in the bottom line',()=>{
 const NOW=AS_OF,h=x=>new Date(Date.parse(NOW)-x*3600000).toISOString();
 const k=(sym,score)=>({id:'c-'+sym,symbol:sym,createdAt:h(2),conclusion:'INVESTIGATE',decision:{version:'research-screen-v2'},rules:[],event:{headline:sym+' news',publishedAt:sym==='LOW'?h(1):h(5),analysis:{topics:[]}},evidenceScore:{...full({}),score,band:S.scoreBand(score)}});
 const r=M.buildMorningBrief({now:NOW,cases:[k('LOW',55),k('HIGH',90)],watch:[],lastScan:{at:h(1),completed:true,pages:1},pendingCount:0,lastOutcomeAt:null,outcomeCounts:{},shadow:{enabled:false,readings:0}});
 assert.deepEqual(r.takes.map(t=>t.symbol),['HIGH','LOW']);
 assert.equal(r.takes[0].evidence.score,90);
 assert.match(r.bottomLine,/led by HIGH \(evidence 90\/100\)/);
});
