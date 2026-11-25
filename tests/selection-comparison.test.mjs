import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const esbuild=require(require.resolve('esbuild',{paths:[require.resolve('wrangler/package.json')]}));
const load=async entry=>{const b=await esbuild.build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm'});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));};
const {selectionComparison,outcomeProblem,MIN_PER_GROUP,meetsIdeaRules,selectIdeas,excessAfterCosts}=await load(`export * from './lib/sentinel/selection-comparison';export {meetsIdeaRules,selectIdeas} from './lib/sentinel/idea-select';export {excessAfterCosts} from './lib/sentinel/research-stats';`);
const BANNED=/\b(undervalued|overvalued|cheap|expensive|upside|target|buy|sell|should)\b/i;

// ALL CASES AND RETURNS IN THIS FILE ARE SYNTHETIC. Nothing here is market data or a statement about real performance.
const NOW='2026-11-25T12:00:00.000Z',D=86400000;
const day=(base,n)=>new Date(Date.parse(base+'T00:00:00Z')+n*D).toISOString().slice(0,10);
const label={version:'news-direction-v1',source:'stored',storedVersion:'news-direction-v1'};
let seq=0;
/** One synthetic case; `kind` sets which group it falls in. */
function kase(kind,over={}){const i=seq++,createdAt=over.createdAt??new Date(Date.parse('2026-01-05T15:00:00Z')+(i%140)*2*D).toISOString();
 const base={id:'c'+i,symbol:'S'+i,createdAt,status:'complete',screenVersion:'research-screen-v2',label};
 const k=kind==='selected'?{conclusion:'INVESTIGATE',matchLevel:'named_in_headline',direction:'positive'}:{conclusion:'MONITOR',matchLevel:'named_in_headline',direction:'neutral'};
 return {...base,...k,...over};}
/** Its outcome: entry the day after the case, `h` daily intervals, stock = SPY + edge. */
function outcome(c,{h=5,edge=0,spy=null,over={}}={}){const entry=day(c.createdAt.slice(0,10),1),dates=Array.from({length:h+1},(_,j)=>day(entry,j)),r=spy??((Number(c.id.slice(1))*7919)%100-50)/1000;
 return {caseId:c.id,symbol:c.symbol,horizonIntervals:h,entryDate:entry,exitDate:dates.at(-1),stockReturn:r+edge,benchmarkReturn:r,matchedDates:dates,benchmark:'SPY',...over};}
function world(nSel,nNot,{edge=0,h=5}={}){const sel=Array.from({length:nSel},()=>kase('selected')),not=Array.from({length:nNot},()=>kase('not'));
 return {cases:[...sel,...not],outcomes:[...sel.map(c=>outcome(c,{h,edge})),...not.map(c=>outcome(c,{h}))],sel,not};}
const strings=o=>{const out=[];const walk=v=>{if(typeof v==='string')out.push(v);else if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')Object.values(v).forEach(walk);};walk(o);return out;};

test('the selection rule is the idea list\'s own rule (synthetic)',()=>{
 assert.equal(meetsIdeaRules({screenVersion:'research-screen-v2',status:'complete',conclusion:'INVESTIGATE',matchLevel:'named_in_headline',direction:'positive'}),true);
 for(const over of [{direction:'neutral'},{matchLevel:'ticker_only'},{conclusion:'WAIT'},{screenVersion:'research-screen-v1'},{status:'unmatched'}])
  assert.equal(meetsIdeaRules({screenVersion:'research-screen-v2',status:'complete',conclusion:'INVESTIGATE',matchLevel:'named_in_headline',direction:'positive',...over}),false,JSON.stringify(over));
 const s=selectIdeas([{id:'a',symbol:'A',createdAt:'2026-11-24T00:00:00.000Z',status:'complete',conclusion:'INVESTIGATE',screenVersion:'research-screen-v2',reason:null,score:50,matchLevel:'named_in_headline',topics:[],priceStatus:null,securityStatus:null,direction:'positive'}],NOW);
 assert.equal(s.picked[0].tier,'meets_rules','idea-select-v2 unchanged by the refactor');
});

test('below 20 usable outcomes in a group: counts only, no averages, no interval, no claim (synthetic)',()=>{
 const w=world(MIN_PER_GROUP-1,40,{edge:0.05}),r=selectionComparison({...w,horizon:5,now:NOW});
 assert.equal(r.status,'counts_only');assert.equal(r.result,null);assert.equal(r.groups.selected.used,19);assert.equal(r.groups.notSelected.used,40);
 assert.deepEqual(r.missing,['Selected: 19 usable outcomes at 5 trading-day intervals; 20 needed.']);
 assert.ok(!/average|median|interval90|share/i.test(JSON.stringify(r.groups)),'no figure hides in the counts');
 assert.match(r.canEstablish,/^Only how many cases/);
});

test('with 20 or more in each group: a planted 3-point edge is found; no edge gives about zero; costs on both legs (synthetic)',()=>{
 const w=world(40,60,{edge:0.03}),r=selectionComparison({...w,horizon:5,now:NOW});
 assert.equal(r.status,'computed',JSON.stringify(r.missing));
 assert.ok(Math.abs(r.result.notSelected.averageExcessAfterCosts)<1e-12,'a stock that matches SPY shows zero excess after the same costs');
 assert.ok(Math.abs(r.result.selected.averageExcessGross-0.03)<1e-12);assert.ok(r.result.selected.averageExcessAfterCosts<0.03&&r.result.selected.averageExcessAfterCosts>0.0299);
 assert.ok(r.result.difference.interval90.lower>0.02&&r.result.difference.interval90.upper<0.04,JSON.stringify(r.result.difference));
 assert.ok(Math.abs(r.result.selected.averageSpyGross-(r.result.selected.averageStockGross-0.03))<1e-12,'SPY on the same windows');
 const z=selectionComparison({...world(40,60,{edge:0}),horizon:5,now:NOW});assert.ok(Math.abs(z.result.difference.averageExcessAfterCosts)<1e-12);
 assert.deepEqual(selectionComparison({...w,horizon:5,now:NOW}),r,'reproducible');
});

test('future information: an entry on or before the case date is rejected, never used (synthetic)',()=>{
 const c=kase('selected'),o=outcome(c);
 assert.equal(outcomeProblem(c,o,5,'2026-11-25'),null);
 const leak={...o,entryDate:c.createdAt.slice(0,10),matchedDates:[c.createdAt.slice(0,10),...o.matchedDates.slice(0,5)],exitDate:o.matchedDates[4]};
 assert.match(outcomeProblem(c,leak,5,'2026-11-25'),/on or before the case date/);
 const r=selectionComparison({cases:[c],outcomes:[leak],horizon:5,now:NOW});assert.equal(r.cases[0].outcome,'rejected');assert.equal(r.groups.selected.used,0);
});

test('invalid or misaligned outcome records are rejected with their reason (synthetic)',()=>{
 const c=kase('not'),o=outcome(c),T='2026-11-25',p=x=>outcomeProblem(c,{...o,...x},5,T);
 assert.match(p({stockReturn:NaN}),/stock return/);assert.match(p({stockReturn:null}),/stock return/);assert.match(p({stockReturn:-1.5}),/stock return/);
 assert.match(p({benchmarkReturn:undefined}),/SPY return/);assert.match(p({benchmark:'QQQ'}),/not SPY/);assert.match(p({symbol:'OTHER'}),/symbol differs/);
 assert.match(p({matchedDates:o.matchedDates.slice(1)}),/exactly 5 trading-day intervals/);assert.match(p({matchedDates:null}),/exactly 5/);
 assert.match(p({matchedDates:[...o.matchedDates.slice(0,5),o.matchedDates[3]]}),/exactly 5/,'dates out of order');
 assert.match(p({exitDate:o.entryDate}),/exit date/);assert.match(p({entryDate:'2026-02-30'}),/entry date/);
 assert.match(outcomeProblem(c,o,5,o.exitDate),/not a completed session/);
 const r=selectionComparison({cases:[c],outcomes:[o,o],horizon:5,now:NOW});assert.equal(r.cases[0].reason,'more than one outcome record for this case and horizon');
});

test('missing outcomes are split into not yet due and due with no record; other horizons are never mixed in (synthetic)',()=>{
 const fresh=kase('selected',{createdAt:'2026-11-23T15:00:00.000Z'}),old=kase('selected',{createdAt:'2026-10-01T15:00:00.000Z'}),done=kase('not');
 const r=selectionComparison({cases:[fresh,old,done],outcomes:[outcome(done),outcome(done,{h:20}),outcome(old,{h:20})],horizon:5,now:NOW});
 assert.equal(r.groups.selected.notYetDue,1);assert.equal(r.groups.selected.dueNoRecord,1);assert.equal(r.groups.notSelected.used,1);assert.equal(r.outcomes.otherHorizon,2);
 assert.throws(()=>selectionComparison({cases:[],outcomes:[],horizon:10,now:NOW}),/horizon/);
});

test('the same company: overlapping windows in one group count once; overlap across groups is reported (synthetic)',()=>{
 const a=kase('selected',{symbol:'DUP',createdAt:'2026-03-02T15:00:00.000Z'}),b=kase('selected',{symbol:'DUP',createdAt:'2026-03-04T15:00:00.000Z'}),c=kase('selected',{symbol:'DUP',createdAt:'2026-03-20T15:00:00.000Z'});
 const n=kase('not',{symbol:'DUP',createdAt:'2026-03-03T15:00:00.000Z'});
 const r=selectionComparison({cases:[a,b,c,n],outcomes:[a,b,c,n].map(x=>outcome(x)),horizon:5,now:NOW});
 assert.deepEqual(r.cases.filter(x=>x.group==='selected').map(x=>x.outcome),['used','overlap_left_out','used']);
 assert.equal(r.groups.selected.overlapLeftOut,1);assert.equal(r.groups.selected.used,2);assert.equal(r.crossGroupOverlaps,1);
});

test('universe: first screen, unmatched tickers and probable wrong companies are counted and left out of both groups (synthetic)',()=>{
 const cs=[kase('selected',{screenVersion:'research-screen-v1'}),kase('selected',{status:'unmatched'}),kase('not',{matchLevel:'name_conflict'}),kase('selected')];
 const r=selectionComparison({cases:cs,outcomes:cs.map(c=>outcome(c)),horizon:5,now:NOW});
 assert.deepEqual(r.universe,{cases:4,olderScreen:1,tickerNotMatched:1,probableWrongCompany:1,compared:1,truncated:false});
 assert.equal(r.outcomes.outsideCompared,3);assert.equal(r.cases.length,1);
});

test('news-direction version: recorded on every compared case; mixed versions are not pooled (synthetic)',()=>{
 const w=world(25,25),computed={version:'news-direction-v1',source:'computed',storedVersion:null};w.cases[0]={...w.cases[0],label:computed};
 const r=selectionComparison({...w,horizon:5,now:NOW});assert.equal(r.status,'computed');
 assert.ok(r.cases.every(c=>c.labelVersion==='news-direction-v1'&&['stored','computed'].includes(c.labelSource)));
 assert.deepEqual(r.groups.selected.labelSource,{computed:1,stored:24});
 w.cases[1]={...w.cases[1],label:{version:'news-direction-v2',source:'stored',storedVersion:'news-direction-v2'}};
 const m=selectionComparison({...w,horizon:5,now:NOW});assert.equal(m.status,'mixed_label_versions');assert.equal(m.result,null);assert.match(m.missing[0],/news-direction-v1: 49, news-direction-v2: 1/);
});

test('wording: no banned word in anything the comparison returns (synthetic)',()=>{
 const outs=[selectionComparison({...world(30,30,{edge:.02}),horizon:5,now:NOW}),selectionComparison({...world(3,3),horizon:20,now:NOW}),selectionComparison({cases:[],outcomes:[],horizon:120,now:NOW})];
 const all=outs.flatMap(strings);assert.ok(all.length>50);assert.deepEqual(all.filter(s=>BANNED.test(s)),[]);
 assert.equal(excessAfterCosts(0.1,0.1),0);
});
