import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const esbuild=require(require.resolve('esbuild',{paths:[require.resolve('wrangler/package.json')]}));
const b=await esbuild.build({stdin:{contents:"export * from './lib/sentinel/case-context';export {buildEvidencePack} from './lib/sentinel/evidence-pack';export {derive,quarterlyFigures} from './lib/sentinel/financial';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm'});
const M=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));

let n=0;const fact=(metric,tag,value,start,end,filed,form='10-K',unit='USD')=>({id:'f'+(++n),entity_id:'sec:9',metric,source_tag:tag,value,unit,period_start:start,period_end:end,fiscal_year:null,fiscal_period:null,form,known_from:filed+'T23:59:59.999Z',filed,accession:'0000000009-26-'+String(n).padStart(6,'0'),raw_event_id:'raw',recorded_at:filed+'T23:59:59.999Z'});
const rows=[
 fact('revenue','Revenues',800,'2024-01-01','2024-12-31','2025-02-20'),fact('revenue','Revenues',1000,'2025-01-01','2025-12-31','2026-02-20'),
 fact('revenue','Revenues',900,'2025-01-01','2025-12-31','2026-08-01','10-K/A'), // restatement, later
 fact('net_income','NetIncomeLoss',-30,'2024-01-01','2024-12-31','2025-02-20'),fact('net_income','NetIncomeLoss',-50,'2025-01-01','2025-12-31','2026-02-20'),
 fact('cfo','NetCashProvidedByUsedInOperatingActivities',40,'2024-01-01','2024-12-31','2025-02-20'),fact('cfo','OtherCfoTag',-20,'2025-01-01','2025-12-31','2026-02-20'),
 fact('revenue','Revenues',250,'2025-01-01','2025-03-31','2025-04-30','10-Q'),fact('revenue','Revenues',300,'2026-01-01','2026-03-31','2026-04-30','10-Q'),
];
const kase=(o={})=>({symbol:'NINE',createdAt:'2026-05-15T15:00:00.000Z',identity:{name:'Nine Corp',cik:'0000000009',relevance:{level:'direct_candidate',reason:'named'}},event:{headline:'Nine Corp reports results',providerSummary:'Revenue rose.',url:'https://news.example/9',source:'Fixture',publishedAt:'2026-05-15T14:00:00.000Z',firstObservedAt:'2026-05-15T14:02:00.000Z'},price:{status:'unavailable',reason:'EPS negative'},brief:{},...o});
const ctxAt=(asOf,k=kase())=>{const p=M.buildEvidencePack({caseId:'c',kase:{...k,createdAt:asOf},figures:M.derive(rows,asOf,asOf),quarterlyFigures:M.quarterlyFigures(rows,asOf,asOf),asOf,recordedBy:asOf});return M.whatChanged(p,{...k,createdAt:asOf});};
const ctx=ctxAt('2026-05-15T15:00:00.000Z');
const row=(label)=>[...ctx.business,...ctx.position].find(r=>r.label===label);

test('business changes compare valid periods with sources, and only data known at the case time',()=>{
 const rev=row('Revenue (year)');assert.equal(rev.latest.value,1000,'original filing, not the later restatement');assert.equal(rev.prior.value,800);assert.equal(rev.changePct,25);assert.equal(rev.comparison,'prior year');
 assert.ok(rev.latest.source.url.includes('sec.gov'));assert.equal(rev.latest.sourceTime,'2026-02-20');assert.equal(rev.kind,'fact');
 const q=row('Revenue (quarter)');assert.equal(q.changePct,20);assert.equal(q.comparison,'same quarter a year earlier');assert.equal(q.prior.period.end,'2025-03-31');
 assert.equal(ctxAt('2026-09-01T00:00:00.000Z').business.find(r=>r.label==='Revenue (year)').latest.value,900,'the restatement appears only after it was filed');
});

test('invalid comparisons show no change and say why',()=>{
 const ni=row('Net income (year)');assert.equal(ni.changePct,null);assert.match(ni.note,/zero or negative/);
 const cfo=row('Operating cash flow (year)');assert.equal(cfo.changePct,null);assert.match(cfo.note,/Different reporting tags/);
 assert.equal(row('Operating income (year)'),undefined,'no data, no row');
});

test('event, company match, rule readings, valuation and expectations are labelled honestly',()=>{
 assert.equal(ctx.event.kind,'reported_claim');assert.equal(ctx.event.publishedAt,'2026-05-15T14:00:00.000Z');assert.equal(ctx.event.firstObservedAt,'2026-05-15T14:02:00.000Z');
 assert.ok(ctx.risks.some(r=>/Net loss/.test(r.text)&&r.kind==='interpretation'));
 assert.ok(ctx.supports.some(s=>/quarter revenue \$300 vs \$250/.test(s.text)));
 assert.equal(ctx.valuation.pe,null);assert.match(ctx.valuation.peUnavailable,/EPS negative/);
 assert.equal(ctx.valuation.expectations.status,'unknown');
 const unclear=ctxAt('2026-05-15T15:00:00.000Z',kase({identity:{name:'Nine Corp',cik:'0000000009',relevance:{level:'review',reason:'not named'}}}));
 assert.ok(unclear.risks.some(r=>/may concern someone else/.test(r.text)));
 const text=JSON.stringify(ctx);assert.doesNotMatch(text,/\b(buy|sell|price target|undervalued|overlooked|caused)\b/i);
 assert.ok(ctx.missing.some(m=>/intrinsic value/.test(m)));
});

// ---- price context: bars stamped at New York midnight, as Alpaca returns daily bars
const sessions=[];for(let d=new Date('2026-03-02T12:00:00Z');sessions.length<60;d=new Date(d.getTime()+86400000)){const w=d.getUTCDay();if(w&&w<6)sessions.push(d.toISOString().slice(0,10));}
const nyMidnight=(date)=>{const dst=date>='2026-03-08'&&date<'2026-11-01';return `${date}T0${dst?4:5}:00:00Z`;};
const series=(f)=>({bars:sessions.map((d,i)=>({t:nyMidnight(d),c:f(i)}))});
const eventDay=sessions[30];
const base={symbol:'NINE',source:'Alpaca IEX daily bars',adjustment:'all',rawIds:['a','b']};

test('price context: 20 sessions before the event end at the last close before publication; after is flagged as later information',()=>{
 const pub=`${eventDay}T14:00:00.000Z`,caseAt=`${eventDay}T15:00:00.000Z`,fetchedAt='2026-06-30T00:00:00.000Z';
 const r=M.priceContext({...base,stock:series(i=>100+i),spy:series(()=>400),publishedAt:pub,caseAt,fetchedAt});
 assert.equal(r.status,'ok');assert.equal(r.lastCloseBeforeEvent,sessions[29],'published mid-session: the last close before is the previous day');
 assert.equal(r.before.from,sessions[9]);assert.equal(r.before.to,sessions[29]);assert.equal(r.before.sessions,20);assert.equal(r.before.knownAtCaseTime,true);
 assert.ok(Math.abs(r.before.stockPct-((129/109-1)*100))<1e-9);assert.equal(r.before.spyPct,0);
 assert.equal(r.after.knownAtCaseTime,false);assert.equal(r.after.sessions,20);assert.equal(r.after.to,sessions[49]);
 const afterClose=M.priceContext({...base,stock:series(i=>100+i),spy:series(()=>400),publishedAt:`${eventDay}T21:30:00.000Z`,caseAt:`${eventDay}T22:00:00.000Z`,fetchedAt});
 assert.equal(afterClose.lastCloseBeforeEvent,eventDay,'published after the close: that day’s close is before the event');
});

test('price context never uses an unfinished session or invents data',()=>{
 const pub=`${eventDay}T14:00:00.000Z`;
 const fetchedMidSession=`${sessions[35]}T17:00:00.000Z`;
 const r=M.priceContext({...base,stock:series(i=>100+i),spy:series(()=>400),publishedAt:pub,caseAt:pub,fetchedAt:fetchedMidSession});
 assert.equal(r.after.to,sessions[34],'the session still trading at fetch time is excluded');assert.match(r.after.note,/Only 5 completed/);
 assert.equal(M.priceContext({...base,stock:series(i=>100+i),spy:series(()=>400),publishedAt:null,caseAt:pub,fetchedAt:fetchedMidSession}).status,'unavailable');
 assert.equal(M.priceContext({...base,stock:{bars:[]},spy:series(()=>400),publishedAt:pub,caseAt:pub,fetchedAt:fetchedMidSession}).status,'unavailable');
 const early=M.priceContext({...base,stock:series(i=>100+i),spy:series(()=>400),publishedAt:`${sessions[5]}T14:00:00.000Z`,caseAt:pub,fetchedAt:fetchedMidSession});
 assert.equal(early.before,null);assert.match(early.reason,/Fewer than 20 matching sessions/);
 const gappy=M.priceContext({...base,stock:series(i=>100+i),spy:{bars:series(()=>400).bars.filter((_,i)=>i%2)},publishedAt:pub,caseAt:pub,fetchedAt:'2026-06-30T00:00:00.000Z'});
 assert.ok(gappy.before===null||gappy.before.sessions===20,'only dates present for both the stock and SPY are used');
 assert.ok(r.caveats.some(c=>/does not show the event caused it/.test(c)));
});

test('New York close handles daylight saving',()=>{
 assert.equal(M.closeInstant('2026-01-15'),'2026-01-15T21:00:00.000Z');assert.equal(M.closeInstant('2026-07-15'),'2026-07-15T20:00:00.000Z');
});

test('"Meets research rules" is a display label only: stored conclusions, v1/v2 split and outcome groups keep their meaning',async()=>{
 const sb=await esbuild.build({entryPoints:['lib/sentinel/screen-label.ts'],bundle:true,write:false,platform:'node',format:'esm'});
 const L=await import('data:text/javascript;base64,'+Buffer.from(sb.outputFiles[0].text).toString('base64'));
 const v2={conclusion:'INVESTIGATE',decision:{version:'research-screen-v2'}},v1={conclusion:'INVESTIGATE',decision:{version:'research-screen-v1'}};
 assert.equal(L.screenLabel(v2),'Meets research rules');assert.equal(L.screenLabel(v1),'Data ready (v1 label)','v1 is never shown as meeting the v2 rules');
 assert.equal(L.friendlyLabel('INVESTIGATE'),'Meets research rules');assert.equal(L.friendlyLabel('INVESTIGATE (research-screen-v1)'),'INVESTIGATE (research-screen-v1)');
 assert.equal(v2.conclusion,'INVESTIGATE','the stored value is untouched');
 const labels=['INVESTIGATE','MONITOR','WAIT'].map(c=>L.screenLabel({conclusion:c,decision:{version:'research-screen-v2'}}));assert.equal(new Set(labels).size,3,'outcome groups stay distinct');
});
