import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const esbuild=require(require.resolve('esbuild',{paths:[require.resolve('wrangler/package.json')]}));
const load=async f=>{const b=await esbuild.build({entryPoints:[f],bundle:true,write:false,platform:'node',format:'esm'});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));};
const R=await load('lib/sentinel/discover-rank.ts'),T=await load('lib/sentinel/thesis-monitor.ts'),S=await load('lib/sentinel/evidence-score.ts');
const NOW='2026-11-12T18:00:00.000Z',h=x=>new Date(Date.parse(NOW)-x*3600000).toISOString();
const score=n=>({version:'evidence-score-v1',status:n===null?'insufficient':'scored',score:n,band:S.scoreBand(n),coverage:n===null?30:100,checks:[{id:'E1',label:'Material event',points:15,state:'pass',detail:'',source:null},{id:'E4',label:'Latest quarter: revenue growing',points:15,state:'fail',detail:'',source:null}],meaning:''});
const kase=(id,sym,n,o={})=>({id,symbol:sym,createdAt:o.at??h(2),conclusion:o.label??'MONITOR',decision:{version:'research-screen-v2'},event:{headline:sym+' '+id,publishedAt:o.pub??h(3)},evidenceScore:score(n)});

test('discover ranks one row per symbol by evidence score, merges duplicates, unscored last',()=>{
 const r=R.rankCases([kase('a1','AAA',55),kase('a2','AAA',80,{pub:h(30)}),kase('b','BBB',90),kase('c','CCC',null,{pub:h(1)}),kase('d','DDD',80,{label:'INVESTIGATE'}),kase('old','OLD',100,{at:h(24*8)})],NOW);
 assert.deepEqual(r.rows.map(x=>x.symbol),['BBB','DDD','AAA','CCC'],'score desc, tie broken by stronger label, unscored last, older than 7 days dropped');
 const a=r.rows.find(x=>x.symbol==='AAA');assert.equal(a.score,80,'best-evidenced report represents the symbol');assert.equal(a.otherReports,1);
 assert.match(a.whyRanked,/^Passes Material event; fails Latest quarter: revenue growing\.$/);
 assert.match(r.rows.at(-1).whyRanked,/Not enough data to score/);
});

const crit=(result,streak=0,reason='r')=>({id:'c'+Math.random(),predicate:'{}',latest:result?{result,reason,evaluatedAt:NOW,snapshot:{checks:[{streak}]}}:null});
const thesis={text:'Cash conversion stays above 0.8.',recordedAt:h(100)};
test('thesis status comes only from kill criteria; unknown is never holding',()=>{
 assert.equal(T.thesisStatus({thesis:null,criteria:[]}).status,'No thesis');
 assert.equal(T.thesisStatus({thesis,criteria:[]}).status,'No thesis');
 assert.equal(T.thesisStatus({thesis,criteria:[crit('pass'),crit('trip',2,'Cash conversion below 0.7 for 2 years.')]}).status,'Broken');
 assert.equal(T.thesisStatus({thesis,criteria:[crit('pass'),crit('unknown')]}).status,"Can't check");
 assert.equal(T.thesisStatus({thesis,criteria:[crit('pass'),crit(null)]}).status,"Can't check");
 assert.equal(T.thesisStatus({thesis,criteria:[crit('pass',1)]}).status,'Weakening');
 assert.equal(T.thesisStatus({thesis,criteria:[crit('pass'),crit('pass')]}).status,'Holding');
});

test('following puts broken and changed first and stays quiet when nothing changed',()=>{
 const f=(name,criteria,changes=[])=>({entityId:name,name,ticker:null,thesis,criteria,changes});
 const r=T.buildFollowing([f('Calm',[crit('pass')]),f('Busy',[crit('pass')],[{kind:'filing',at:'2026-11-10',text:'New 10-Q'},{kind:'news',at:h(24*9),text:'old news'}]),f('Bad',[crit('trip')])],NOW);
 assert.deepEqual(r.rows.map(x=>x.name),['Bad','Busy','Calm']);
 assert.equal(r.rows[1].changes.length,1,'older than a week is dropped');assert.equal(r.rows[2].changed,false);
 assert.equal(r.summary,'1 thesis is broken. This week: changes at Busy.');
 assert.equal(T.buildFollowing([f('Calm',[crit('pass')])],NOW).summary,'Nothing changed this week.');
});
