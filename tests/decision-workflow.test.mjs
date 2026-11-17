import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const esbuild=require(require.resolve('esbuild',{paths:[require.resolve('wrangler/package.json')]}));
const load=async entry=>{const b=await esbuild.build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm'});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));};
const M=await load(`export * from './lib/sentinel/financial';export * from './lib/sentinel/implied-expectations';export * from './lib/sentinel/decision-compare';export * as snap from './lib/sentinel/decision-snapshot';export {DCF_ASSUMPTIONS,cashflowScenarios} from './lib/sentinel/cashflow-scenarios';`);
const {parseFacts,derive,quarterlyFigures,latestShareCount,impliedExpectations,presentValue,solveGrowth,cashFlowHistory,compareDecision,betaFromCloses,snap,DCF_ASSUMPTIONS,cashflowScenarios}=M;
const BANNED=/\b(undervalued|overvalued|cheap|expensive|upside|target|buy|sell|should)\b/i;

// ---- fixtures: an SEC companyfacts payload ------------------------------------------------------
const row=(year,val,over={})=>({start:year+'-01-01',end:year+'-12-31',val,accn:'0000000001-'+String(year+1).slice(2)+'-000001',fy:year,fp:'FY',form:'10-K',filed:(year+1)+'-02-15',...over});
const inst=(year,val,over={})=>{const r=row(year,val,over);delete r.start;return r;};
function company({cfo=[90,100,110,120,130],capex=[30,30,30,30,30],debtNC=100,debtC=20,cash=50,shares=[[2025,'2026-01-31',23_047_714]],mult=1e6,capexOver={}}={}){
 const years=[2021,2022,2023,2024,2025],us={
  NetCashProvidedByUsedInOperatingActivities:{units:{USD:years.map((y,i)=>row(y,cfo[i]*mult))}},
  PaymentsToAcquirePropertyPlantAndEquipment:{units:{USD:years.map((y,i)=>row(y,capex[i]*mult,y===2025?capexOver:{}))}},
  CashAndCashEquivalentsAtCarryingValue:{units:{USD:years.map(y=>inst(y,cash*mult))}}};
 if(debtNC!==null){us.LongTermDebtNoncurrent={units:{USD:years.map(y=>inst(y,debtNC*mult))}};us.LongTermDebtCurrent={units:{USD:years.map(y=>inst(y,debtC*mult))}};}
 const dei={EntityCommonStockSharesOutstanding:{units:{shares:shares.map(([y,end,val])=>({end,val,accn:'0000000001-'+String(y+1).slice(2)+'-000001',fy:y,fp:'FY',form:'10-K',filed:(y+1)+'-02-15'}))}}};
 return {cik:1,facts:{'us-gaap':us,dei}};
}
const asOf='2026-03-02T15:00:00.000Z';
const build=(data,over={})=>{const facts=parseFacts(data,'sec:0000000001','raw-1','2026-02-16T00:00:00.000Z');return {symbol:'FIX',asOf,sic:'3570',figures:derive(facts,asOf),shareFact:latestShareCount(facts,asOf),price:{value:50,at:'2026-02-27T21:00:00.000Z',basis:'last_close',source:'IEX daily close 2026-02-27',rawEventId:'bars-1'},split:{state:'none',coverSession:'2026-01-30',priceSession:'2026-02-27',source:'fixture'},...over};};

test('3A: cover-page share count is parsed from dei with the filing date as known_from; investment figures are unchanged',()=>{
 const data=company({shares:[[2024,'2025-01-31',22_000_000],[2025,'2026-01-31',23_047_714]]}),facts=parseFacts(data,'sec:0000000001','raw-1','2026-02-16T00:00:00.000Z');
 const s=facts.filter(f=>f.metric==='shares_outstanding');assert.equal(s.length,2);
 const latest=latestShareCount(facts,asOf);assert.equal(latest.value,23_047_714);assert.equal(latest.period_end,'2026-01-31','the cover-page date is kept');assert.equal(latest.known_from,'2026-02-15T23:59:59.999Z','known from the filing date, not the cover date');assert.equal(latest.period_start,'');assert.equal(latest.unit,'shares');assert.equal(latest.source_tag,'EntityCommonStockSharesOutstanding');
 assert.equal(latestShareCount(facts,'2026-02-14T00:00:00.000Z').value,22_000_000,'before the filing, only the earlier count is known');
 assert.equal(latestShareCount(facts,'2025-01-01T00:00:00.000Z'),null);
 const noDei={cik:1,facts:{'us-gaap':data.facts['us-gaap']}};
 assert.deepEqual(derive(facts,asOf),derive(parseFacts(noDei,'sec:0000000001','raw-1','2026-02-16T00:00:00.000Z'),asOf),'derive (and so investment-case-v1) does not see the new metric');
 assert.equal(new Set(facts.map(f=>f.id)).size,facts.length,'ids stay unique');
});

test('3A: several share counts in one filing or on one date are never summed: multi-class marker',()=>{
 const data=company({shares:[[2025,'2026-01-31',300_000_000],[2025,'2026-01-31',45_000_000]]}),facts=parseFacts(data,'sec:0000000001','raw-1','2026-02-16T00:00:00.000Z');
 assert.equal(facts.filter(f=>f.metric==='shares_outstanding').length,0);
 const m=facts.filter(f=>f.metric==='shares_outstanding_multiclass');assert.equal(m.length,1);assert.equal(m[0].value,2);assert.equal(m[0].unit,'classes');
 const r=impliedExpectations(build(data));assert.equal(r.status,'unavailable');assert.match(r.missing.join(' '),/Unavailable: share classes/);assert.match(r.missing.join(' '),/not summed/);
 // A later single-class filing after an earlier multi-class one: the latest filing decides.
 const mixed=company({shares:[[2024,'2025-01-31',300_000_000],[2024,'2025-01-31',45_000_000],[2025,'2026-01-31',23_047_714]]});assert.equal(impliedExpectations(build(mixed)).status,'computed');
 // Invalid rows are dropped.
 const bad=company({shares:[[2025,'2026-01-31',0]]});assert.equal(latestShareCount(parseFacts(bad,'e','r','x'),asOf),null);
});

test('3B: hand-calculated fixture. Price $50 × 23,047,714 shares; cash flow $100M; the price assumes 5.00% growth; re-pricing returns the market value',()=>{
 // Hand calculation at 12% discount, 2% terminal growth, 5 years, growth 5%:
 //   years 1-5: 100 × Σ (1.05/1.12)^t = 413.7053;  terminal: 100 × 1.05^5 × 1.02 / 0.10 / 1.12^5 = 738.6804;  total 1,152.3857 ($M)
 assert.ok(Math.abs(presentValue(100,0.05,0.12,0.02,5)-1152.3857116699)<1e-6);
 assert.deepEqual(DCF_ASSUMPTIONS,{discount:.12,terminalGrowth:.02,years:5});
 const input=build(company()),r=impliedExpectations(input);
 assert.equal(r.status,'computed',JSON.stringify(r.missing));
 assert.equal(r.marketValue.value,50*23_047_714);assert.equal(r.baseCashFlow.value,100e6);assert.equal(r.baseCashFlow.cfo,130e6);assert.equal(r.baseCashFlow.capex,30e6);
 assert.equal(r.implied.status,'solved');assert.equal(r.implied.growthPct,5,'to two decimals');
 assert.ok(Math.abs(r.implied.repricedValue/r.marketValue.value-1)<0.001,'re-pricing at the solved growth returns the market value within 0.1%');
 // Provenance on both inputs.
 assert.equal(r.marketValue.price.rawEventId,'bars-1');assert.equal(r.marketValue.price.basis,'last_close');assert.equal(r.marketValue.shares.coverDate,'2026-01-31');assert.equal(r.marketValue.shares.accession,'0000000001-26-000001');assert.equal(r.marketValue.shares.stale,false);assert.equal(r.baseCashFlow.accession,'0000000001-26-000001');
 // Same base as the existing scenarios.
 assert.equal(cashflowScenarios(input.figures,asOf).baseCashFlow,r.baseCashFlow.value);
 // Sensitivity: 3 × 3, higher discount rate means more growth is assumed; the middle cell is the main result.
 assert.equal(r.sensitivity.cells.length,9);const cell=(d,t)=>r.sensitivity.cells.find(c=>c.discount===d&&c.terminalGrowth===t);
 assert.ok(Math.abs(cell(.12,.02).growth-r.implied.growth)<1e-12);assert.ok(cell(.14,.02).growth>cell(.12,.02).growth&&cell(.12,.02).growth>cell(.10,.02).growth);assert.ok(cell(.12,.01).growth>cell(.12,.03).growth);
 // Equity basis, net debt as context only, caveats never shown as clear.
 assert.equal(r.basis.id,'equity');assert.equal(r.netDebtContext.value,70e6);assert.match(r.netDebtContext.note,/Not subtracted/);assert.equal(r.leverage.state,'ok');
 assert.deepEqual(r.caveats.filter(c=>c.state==='not_checked').map(c=>c.id),[]);assert.deepEqual(['nci_checked','preferred_checked'].map(id=>r.caveats.find(c=>c.id===id).text),['Noncontrolling interests: not reported in the company\u2019s filings for 2025-12-31.','Preferred stock: not reported in the company\u2019s filings for 2025-12-31.']);assert.ok(r.caveats.some(c=>c.id==='sbc')&&r.caveats.some(c=>c.id==='borrowing'));
 assert.equal(r.opportunity.status,'not_established');
 // History beside it: the company's own reported cash flow, never a forecast.
 assert.deepEqual(r.history.rows.map(h=>h.value/1e6),[60,70,80,90,100]);assert.ok(Math.abs(r.history.rows[4].changePct-100/90*100+100)<1e-9);assert.equal(r.history.rows[0].changePct,null);assert.match(r.history.note,/Not a forecast/);
 assert.ok(!BANNED.test(JSON.stringify(r)),'banned words absent');
});

test('3B: outside the range is said, not a number',()=>{
 assert.equal(solveGrowth(1e12,100,.12,.02,5).status,'outside_range');assert.equal(solveGrowth(1e12,100,.12,.02,5).side,'above');assert.equal(solveGrowth(1,100,.12,.02,5).side,'below');
 const r=impliedExpectations(build(company(),{price:{value:5000,at:'2026-02-27T21:00:00.000Z',basis:'last_close',source:'x',rawEventId:'b'}}));
 assert.equal(r.status,'computed');assert.equal(r.implied.status,'outside_range');assert.equal(r.implied.growth,undefined);assert.match(r.implied.text,/^Outside range/);assert.ok(!BANNED.test(JSON.stringify(r)));
 const low=impliedExpectations(build(company(),{price:{value:1,at:'2026-02-27T21:00:00.000Z',basis:'last_close',source:'x',rawEventId:'b'}}));assert.equal(low.implied.side,'below');
});

test('3B: every unavailable case gives its exact reason and no number',()=>{
 const una=(input,re)=>{const r=impliedExpectations(input);assert.equal(r.status,'unavailable');assert.match(r.missing.join(' | '),re);assert.equal(r.implied,undefined);assert.equal(r.marketValue,undefined);assert.ok(!BANNED.test(JSON.stringify(r)));return r;};
 una(build(company(),{sic:'6021'}),/Financial company \(SIC 6021\)/);
 una(build(company({cfo:[90,100,110,120,20]})),/Base cash flow: .*positive cash-flow scenario/);
 una(build(company({shares:[]})),/Official share count: the company.s filings report no cover-page count/);
 una(build(company(),{price:null}),/Price: no timestamped IEX price/);
 una(build(company(),{price:{value:50,at:'2026-02-20T21:00:00.000Z',basis:'last_close',source:'x',rawEventId:'b'}}),/Stale price/);
 // Basis mismatch: capex comes from a different filing than operating cash flow.
 una(build(company({capexOver:{accn:'0000000001-26-000999'}})),/do not share a verified period, currency and filing/);
 // Period mismatch: capex covers a different period.
 una(build(company({capexOver:{start:'2025-04-01'}})),/Base cash flow/);
 // Highly leveraged: debt 600 vs operating cash flow 130 = 4.6×.
 const lev=una(build(company({debtNC:580,debtC:20})),/Leverage too high for the equity basis: Debt is 4\.6× operating cash flow/);assert.equal(lev.leverage.state,'too_high');
 // Stale annual period.
 const old=build(company());old.asOf='2027-09-01T00:00:00.000Z';old.price.at='2027-08-30T21:00:00.000Z';una(old,/more than 550 days old/);
 // Several inputs missing at once are all listed.
 const many=una(build(company({shares:[]}),{price:null,sic:'6021'}),/Financial company/);assert.equal(many.missing.length,3);
});

test('3B: untagged debt is "not checked", never passing silently; unknown SIC and an old share count are shown',()=>{
 const r=impliedExpectations(build(company({debtNC:null}),{sic:null}));
 assert.equal(r.status,'computed');assert.equal(r.leverage.state,'not_checked');assert.match(r.caveats.find(c=>c.id==='leverage').text,/not checked/);assert.equal(r.netDebtContext.value,null);
 assert.match(r.caveats.find(c=>c.id==='company_type').text,/not checked/);
 const stale=impliedExpectations(build(company({shares:[[2025,'2025-06-30',23_047_714]]})));assert.equal(stale.marketValue.shares.stale,true);assert.match(stale.caveats.find(c=>c.id==='share_count_age').text,/245 days old/);
 const h=cashFlowHistory(build(company({cfo:[20,100,110,120,130]})).figures,asOf);assert.equal(h[0].value,-10e6);assert.equal(h[1].changePct,null);assert.match(h[1].changeNote,/zero or negative/);
});

// ---- 3C ----------------------------------------------------------------------------------------
test('3C: fictional portfolio ($10,000; 2 positions) — keep, add the stock, add SPY, verified by hand',()=>{
 // Fictional: cash $6,000; AAA $2,500 (beta 1.5); BBB $1,500 (beta 0.5); candidate NEW (beta 2.0); budget $1,000.
 const b=beta=>({beta,r2:.5,days:252,from:'2025-01-02',to:'2026-01-02'});
 const r=compareDecision({symbol:'NEW',budgetCents:100_000,cashCents:600_000,holdings:[{symbol:'AAA',valueCents:250_000},{symbol:'BBB',valueCents:150_000}],betas:{AAA:b(1.5),BBB:b(.5),NEW:b(2)}});
 assert.equal(r.start.totalCents,1_000_000);const [keep,stock,spy]=r.options;
 // Keep: nothing changes.
 assert.equal(keep.cashAfterCents,600_000);assert.deepEqual([keep.costs.entryCents,keep.costs.exitCents],[0,0]);assert.equal(keep.stockWeightPct,0);
 // SPY −10%: AAA −15% = −$375, BBB −5% = −$75 → $9,550 (−4.5%).
 assert.deepEqual(keep.scenarios.map(s=>s.valueCents),[955_000,1_000_000,1_045_000]);assert.equal(keep.scenarios[0].changePct,-4.5);
 // Add NEW: entry cost 15 bp of $1,000 = $1.50; invested $998.50; exit estimate 15 bp of $998.50 = $1.50 (rounded up from 149.775c).
 assert.equal(stock.cashAfterCents,500_000);assert.equal(stock.costs.entryCents,150);assert.equal(stock.investedCents,99_850);assert.equal(stock.costs.exitCents,150);assert.equal(stock.totalAfterCents,999_850);
 assert.ok(Math.abs(stock.stockWeightPct-99_850/999_850*100)<1e-9);
 // SPY −10%: NEW −20% of $998.50 = −$199.70 → 5,000 + 2,125 + 1,425 + 798.80 = $9,348.80; change vs the start −$651.20.
 assert.equal(stock.scenarios[0].valueCents,934_880);assert.equal(stock.scenarios[0].changeCents,-65_120);assert.equal(stock.scenarios[1].changeCents,-150,'flat market: only the entry cost');assert.equal(stock.scenarios[2].valueCents,1_064_820);
 // Add SPY: beta 1 by definition → −$99.85 → $9,448.65.
 assert.equal(spy.scenarios[0].valueCents,944_865);assert.equal(spy.stockWeightPct,0);assert.equal(spy.costs.entryCents,150);
 // Same scenarios for every option, labelled as approximations; no mandate invented.
 for(const o of r.options)assert.deepEqual(o.scenarios.map(s=>s.spyMove),[-.1,0,.1]);
 assert.match(r.scenarioLabel,/approximations.*company-specific events, liquidity shocks or concentration risk/);assert.equal(keep.mandate.status,'none');assert.match(keep.mandate.text,/No mandate set/);
 assert.equal(r.es95.status,'not_computed');assert.ok(!BANNED.test(JSON.stringify(r)));
 assert.deepEqual(r,compareDecision({symbol:'NEW',budgetCents:100_000,cashCents:600_000,holdings:[{symbol:'AAA',valueCents:250_000},{symbol:'BBB',valueCents:150_000}],betas:{AAA:b(1.5),BBB:b(.5),NEW:b(2)}}),'deterministic');
});

test('3C: a beta is never assumed; missing price or cash makes that option unavailable; a configured mandate is checked',()=>{
 const b=beta=>({beta,r2:.5,days:252,from:'a',to:'b'}),base={symbol:'NEW',budgetCents:100_000,cashCents:600_000,holdings:[{symbol:'AAA',valueCents:250_000}],betas:{AAA:b(1)}};
 const r=compareDecision(base);assert.equal(r.options[0].scenarios[0].status,'computed');assert.equal(r.options[1].scenarios[0].status,'unavailable');assert.match(r.options[1].scenarios[0].reason,/Not enough price history to measure a beta for NEW/);assert.equal(r.options[2].scenarios[0].status,'computed','SPY needs no measured beta');
 assert.equal(r.options[1].cashAfterCents,500_000,'cash, costs and weight still shown');
 const unpriced=compareDecision({...base,holdings:[{symbol:'AAA',valueCents:null}]});assert.equal(unpriced.start.totalCents,null);assert.ok(unpriced.options.every(o=>o.scenarios.every(s=>s.status==='unavailable')));assert.equal(unpriced.options[1].stockWeightPct,null);
 const poor=compareDecision({...base,cashCents:50_000,betas:{AAA:b(1),NEW:b(1)}});assert.equal(poor.options[0].status,'computed');assert.equal(poor.options[1].status,'unavailable');assert.match(poor.options[1].reason,/Not enough practice cash/);
 const m=compareDecision({...base,betas:{AAA:b(1),NEW:b(1)},mandate:{reservePct:60,maxPositionPct:20}});assert.equal(m.options[0].mandate.reserveOk,true);assert.equal(m.options[0].mandate.positionOk,false);assert.equal(m.options[1].mandate.reserveOk,false);
 assert.throws(()=>compareDecision({...base,budgetCents:50}));
 // Beta from closes: known slope recovered; too little history is null.
 const spy=new Map(),stock=new Map();let s=100,k=50;for(let i=0;i<200;i++){const d=new Date(Date.UTC(2025,0,1)+i*86400000).toISOString().slice(0,10),r=((i*37)%11-5)/1000;s*=1+r;k*=1+1.5*r;spy.set(d,s);stock.set(d,k);}
 const fit=betaFromCloses(stock,spy);assert.ok(Math.abs(fit.beta-1.5)<1e-9);assert.equal(fit.days,199);
 assert.equal(betaFromCloses(new Map([...stock].slice(0,100)),spy),null);assert.equal(betaFromCloses(null,spy),null);
});

// ---- 3D ----------------------------------------------------------------------------------------
test('3D: three separate review results; "not yet" and "unavailable" are answers; a stock can rise while the thesis fails',()=>{
 const q=(end,val,filed,metric='Revenues')=>({start:end.slice(0,5)+String(Number(end.slice(5,7))-2).padStart(2,'0')+'-01',end,val,accn:'0000000001-'+filed.slice(2,4)+'-0000'+end.slice(5,7),fy:2026,fp:'Q',form:'10-Q',filed});
 const data=company();data.facts['us-gaap'].Revenues={units:{USD:[q('2025-03-31',100,'2025-05-01'),q('2025-06-30',110,'2025-08-01'),q('2025-09-30',120,'2025-11-01'),q('2026-03-31',90,'2026-05-01')]}};
 const facts=parseFacts(data,'sec:0000000001','raw-1','x'),savedAt='2026-03-02T15:00:00.000Z';
 const figs=at=>({annual:derive(facts,at),quarterly:quarterlyFigures(facts,at)});
 const cp=snap.checkpointFor('quarterly_revenue_yoy',savedAt,figs(savedAt).annual,figs(savedAt).quarterly);
 assert.equal(cp.condition,'Next filing: reported quarterly revenue at or above the same quarter a year earlier.');assert.equal(cp.dueBy,'2026-06-10');assert.equal(cp.baseline.latestQuarterEnd,'2025-09-30');
 const s={id:'snap-1',savedAt,budgetCents:100_000,price:{sessionDate:'2026-02-27'},checkpoint:cp};
 const stock={'2026-02-27':50,'2026-03-02':51,'2026-05-15':60},spy={'2026-02-27':500,'2026-03-02':505,'2026-05-15':510};
 // Before any later session and any later filing.
 const early=snap.reviewSnapshot({snapshot:s,now:'2026-03-02T16:00:00.000Z',...figs('2026-03-02T16:00:00.000Z'),stock:{'2026-02-27':50},spy:{'2026-02-27':500}});
 assert.deepEqual([early.business.status,early.investment.status,early.alternatives.status],['not_yet','not_yet','not_yet']);assert.match(early.business.text,/^Not yet/);
 // After the next filing: revenue 90 vs 100 a year earlier → not met, while the stock rose 20%.
 const later=snap.reviewSnapshot({snapshot:s,now:'2026-05-16T00:00:00.000Z',...figs('2026-05-16T00:00:00.000Z'),stock,spy});
 assert.equal(later.business.status,'not_met');assert.deepEqual([later.business.evidence.value,later.business.evidence.compared.value],[90,100]);
 const net=0.9985*1.2*0.9985-1,spyNet=0.9985*1.02*0.9985-1;
 assert.equal(later.investment.status,'computed');assert.ok(Math.abs(later.investment.netReturn-net)<1e-12);assert.equal(later.investment.resultCents,Math.round(100_000*net));assert.equal(later.investment.exitDate,'2026-05-15');
 assert.ok(Math.abs(later.alternatives.stockMinusSpy-(net-spyNet))<1e-12);assert.equal(later.alternatives.keep.resultCents,0);assert.ok(Math.abs(later.alternatives.spy.netReturn-spyNet)<1e-12);
 assert.equal(later.business.question,'Did the business expectation materialize?');assert.equal(later.investment.question,'Did the investment perform?');assert.equal(later.alternatives.question,'Did it do better than the alternatives after costs?');
 assert.equal(later.result,undefined,'no merged right/wrong');assert.ok(!BANNED.test(JSON.stringify(later)));
 // Unavailable variants.
 assert.equal(snap.reviewSnapshot({snapshot:s,now:'2026-05-16T00:00:00.000Z',annual:null,quarterly:null,stock:null,spy:null}).business.status,'unavailable');
 assert.equal(snap.performance('2026-02-27',100_000,{'2026-03-02':51},{'2026-02-27':500,'2026-03-02':505}).investment.status,'unavailable');
 assert.equal(snap.performance(null,100_000,stock,spy).investment.status,'unavailable');
 // Year-earlier quarter not reported as a discrete quarter → unavailable, not a guess.
 const d2=company();d2.facts['us-gaap'].Revenues={units:{USD:[q('2025-09-30',120,'2025-11-01'),q('2026-03-31',90,'2026-05-01')]}};const f2=parseFacts(d2,'sec:0000000001','r','x');
 const cp2=snap.checkpointFor('quarterly_revenue_yoy',savedAt,derive(f2,savedAt),quarterlyFigures(f2,savedAt));
 assert.equal(snap.evaluateCheckpoint(cp2,savedAt,'2026-05-16T00:00:00.000Z',derive(f2,'2026-05-16T00:00:00.000Z'),quarterlyFigures(f2,'2026-05-16T00:00:00.000Z')).status,'unavailable');
 // Annual template: not yet until a later annual period is filed.
 const cp3=snap.checkpointFor('annual_cash_flow_positive',savedAt,figs(savedAt).annual,figs(savedAt).quarterly);assert.equal(cp3.baseline.latestAnnualEnd,'2025-12-31');
 assert.equal(snap.evaluateCheckpoint(cp3,savedAt,'2026-05-16T00:00:00.000Z',figs('2026-05-16T00:00:00.000Z').annual,figs('2026-05-16T00:00:00.000Z').quarterly).status,'not_yet');
 assert.equal(snap.isCheckpoint('quarterly_revenue_yoy'),true);assert.equal(snap.isCheckpoint('made up'),false);
});

// ---- 3F ----------------------------------------------------------------------------------------
test('3F: funnel counts reconcile on a fixture; rejected reasons are counted separately; a mismatch is displayed, not hidden',async()=>{
 const {funnelCounts}=await load(`export * from './lib/sentinel/discovery-funnel';`);
 const now='2026-11-16T12:00:00.000Z',ago=h=>new Date(Date.parse(now)-h*3600000).toISOString();
 const candidates=[
  {id:'a',createdAt:ago(2),priority:'topic match',symbols:['AAA','BBB']},   // AAA assessed (meets rules, good); BBB pending
  {id:'b',createdAt:ago(5),priority:'topic match',symbols:['CCC']},         // cooling down
  {id:'c',createdAt:ago(100),priority:'topic match',symbols:['DDD','EEE']}, // DDD aged out; EEE assessed (wrong company, bad news)
  {id:'d',createdAt:ago(3),priority:'unclassified',symbols:['FFF','GGG']},  // not eligible
  {id:'e',createdAt:ago(30),priority:'topic match',symbols:['HHH']},        // assessed: watch, neutral
  {id:'f',createdAt:ago(200),priority:'topic match',symbols:['OLD']},       // outside the 7-day window
  {id:'g',createdAt:ago(4),priority:'unclassified',symbols:[]},             // a report with no symbol
 ];
 const cases=[{candidateId:'a',symbol:'AAA',conclusion:'INVESTIGATE',direction:'positive',matchLevel:'named_in_headline'},{candidateId:'c',symbol:'EEE',conclusion:'WAIT',direction:'negative',matchLevel:'name_conflict'},{candidateId:'e',symbol:'HHH',conclusion:'MONITOR',direction:'neutral',matchLevel:'ticker_only'}];
 const attempts=[{candidateId:'b',symbol:'CCC',createdAt:ago(1)},{candidateId:'a',symbol:'BBB',createdAt:ago(7)}]; // BBB's failure is older than 6 h: pending again
 const run=h=>funnelCounts({now,windowHours:h,queueWindowHours:96,capacityPerRun:6,candidates,cases,attempts});
 const w=run(168);
 assert.deepEqual([w.found.reports,w.found.pairs],[6,8]);assert.deepEqual([w.eligible.reports,w.eligible.pairs],[4,6]);assert.deepEqual([w.notEligible.reports,w.notEligible.pairs],[2,2]);
 assert.equal(w.assessed.pairs,3);assert.deepEqual(w.assessed.byConclusion,{meetsRules:1,watch:1,notEnoughData:1});assert.deepEqual(w.assessed.byNewsDirection,{good:1,neutral:1,mixed:0,bad:1});
 assert.deepEqual([w.pending.pairs,w.coolingDown.pairs,w.agedOut.pairs],[1,1,1]);assert.deepEqual({...w.rejected,definition:undefined},{notEligible:2,wrongCompany:1,badOrMixedNews:1,definition:undefined});
 assert.equal(w.deduplicated.count,null);assert.match(w.deduplicated.text,/^Not recorded/);assert.match(w.capacity.text,/up to 6 pairs per run/);
 assert.equal(w.reconciliation.ok,true);assert.ok(w.reconciliation.checks.every(c=>c.left===c.right));
 assert.equal(w.found.pairs,w.eligible.pairs+w.notEligible.pairs);assert.equal(w.eligible.pairs,w.assessed.pairs+w.pending.pairs+w.coolingDown.pairs+w.agedOut.pairs);
 const d=run(24);assert.deepEqual([d.found.reports,d.eligible.pairs,d.assessed.pairs,d.pending.pairs,d.coolingDown.pairs,d.agedOut.pairs],[4,3,1,1,1,0]);assert.equal(d.reconciliation.ok,true);
 assert.equal(run(96).reconciliation.ok,true);
 // An unknown news direction breaks one identity, and the difference is reported.
 const odd=funnelCounts({now,windowHours:168,queueWindowHours:96,capacityPerRun:6,candidates,cases:[...cases.slice(0,2),{...cases[2],direction:undefined}],attempts});
 assert.equal(odd.reconciliation.ok,false);const bad=odd.reconciliation.checks.filter(c=>!c.ok);assert.equal(bad.length,1);assert.match(bad[0].name,/good \+ neutral/);assert.equal(bad[0].difference,1,'the discrepancy is reported with its size');
});

test('3D: the on-screen comparison is checked against the saved one, figure by figure, and never replaces it',()=>{
 const b=beta=>({beta,r2:.5,days:252,from:'a',to:'b'}),base={symbol:'NEW',budgetCents:100_000,cashCents:600_000,holdings:[{symbol:'AAA',valueCents:250_000}],betas:{AAA:b(1),NEW:b(2)}};
 const shown={...compareDecision(base),preparedAt:'2026-11-16T10:00:00.000Z'},saved={...compareDecision({...base,cashCents:550_000}),preparedAt:'2026-11-16T10:05:00.000Z'};
 assert.equal(snap.compareShownToSaved(shown,shown).status,'matches');
 const c=snap.compareShownToSaved(shown,saved);assert.equal(c.status,'differs');assert.equal(c.shownPreparedAt,'2026-11-16T10:00:00.000Z');
 assert.deepEqual(c.differences.find(d=>d.option==='Keep the portfolio'&&d.field==='cash after'),{option:'Keep the portfolio',field:'cash after',shown:600_000,saved:550_000});
 assert.ok(c.differences.some(d=>d.option==='all'&&d.field==='starting portfolio'));assert.ok(c.differences.some(d=>d.field==='if SPY moves -10%'));
 // Weight compared to 0.1 point; an option that became unavailable is a difference in status.
 const w=x=>({...shown,options:shown.options.map(o=>o.id==='stock'?{...o,stockWeightPct:x}:o)});assert.equal(snap.compareShownToSaved(w(10.51),w(10.54)).status,'matches');assert.equal(snap.compareShownToSaved(w(10.51),w(10.56)).status,'differs');
 const poor=snap.compareShownToSaved(shown,compareDecision({...base,cashCents:50_000}));assert.ok(poor.differences.some(d=>d.option==='Add NEW'&&d.field==='status'&&d.saved==='unavailable'));
 assert.equal(snap.compareShownToSaved(null,saved).status,'not_checked');assert.equal(snap.compareShownToSaved({options:'x'},saved).status,'not_checked');
 for(const x of [c,poor])assert.ok(!BANNED.test(JSON.stringify(x)));
});

// ---- review fixes batch 1 (2026-11-16) -------------------------------------------------------
const F=await load(`export * from './lib/sentinel/financial';export * from './lib/sentinel/implied-expectations';export {createSaveGuard} from './lib/sentinel/save-guard';export * as snap from './lib/sentinel/decision-snapshot';export {compareDecision} from './lib/sentinel/decision-compare';`);

test('tag list v2 is opt-in: v1 figures are unchanged by v2-only facts; v2 reads EMCOR- and FANG-style capex and the new debt tags, and says which list it used',()=>{
 // EMCOR-style: capex only as PaymentsToAcquireProductiveAssets. FANG-style: acquisitions as PaymentsToAcquireOilAndGasProperty, drilling as PaymentsToExploreAndDevelop…; debt as DebtCurrent + LongTermDebt.
 const data=company({debtNC:null});const us=data.facts['us-gaap'];
 us.PaymentsToAcquireProductiveAssets=us.PaymentsToAcquirePropertyPlantAndEquipment;delete us.PaymentsToAcquirePropertyPlantAndEquipment;
 us.DebtCurrent={units:{USD:[inst(2025,20e6)]}};us.LongTermDebt={units:{USD:[inst(2025,100e6)]}};us.ShortTermBorrowings={units:{USD:[inst(2025,5e6)]}};
 const facts=F.parseFacts(data,'sec:0000000001','raw-1','2026-02-16T00:00:00.000Z');
 assert.ok(facts.some(f=>f.metric==='capex'&&f.source_tag==='PaymentsToAcquireProductiveAssets'),'stored for every list');
 const v1=F.derive(facts,asOf),v2=F.derive(facts,asOf,undefined,F.TAG_LIST_V2),at=(fs,m)=>fs.find(f=>f.metric===m&&f.period_end==='2025-12-31');
 assert.equal(at(v1,'capex').value,null,'v1 does not see the new tag');assert.equal(at(v1,'total_debt').value,null);assert.equal(at(v1,'capex').tagList,'xbrl-tags-v1');
 const noNew=F.parseFacts(company({debtNC:null}),'sec:0000000001','raw-1','2026-02-16T00:00:00.000Z').filter(f=>f.source_tag!=='PaymentsToAcquirePropertyPlantAndEquipment');
 assert.deepEqual(F.derive(noNew,asOf).map(f=>[f.metric,f.period_end,f.value]),v1.map(f=>[f.metric,f.period_end,f.value]),'v1 output identical with or without the v2-only facts');
 assert.equal(at(v2,'capex').value,30e6);assert.equal(at(v2,'capex').method,'reported:PaymentsToAcquireProductiveAssets');assert.equal(at(v2,'capex').tagList,'xbrl-tags-v2');
 assert.equal(at(v2,'total_debt').value,100e6,'components incomplete (no noncurrent), so the combined LongTermDebt is used, not DebtCurrent alone');
 const comb=company({debtNC:null});comb.facts['us-gaap'].LongTermDebt={units:{USD:[inst(2025,100e6)]}};const v2b=F.derive(F.parseFacts(comb,'e','r','x'),asOf,undefined,F.TAG_LIST_V2);
 assert.equal(at(v2b,'total_debt').value,100e6);assert.equal(at(v2b,'total_debt').method,'reported-combined-debt-v1');
 assert.equal(at(v2,'short_term_borrowings').value,5e6);assert.equal(at(v1,'short_term_borrowings'),undefined);
 // FANG-style: the acquisitions tag is never capex; the development tag is.
 const fang=company();const fu=fang.facts['us-gaap'];fu.PaymentsToAcquireOilAndGasProperty={units:{USD:[row(2025,59e6)]}};fu.PaymentsToExploreAndDevelopOilAndGasProperties={units:{USD:[row(2025,35e6)]}};delete fu.PaymentsToAcquirePropertyPlantAndEquipment;
 const fv2=F.derive(F.parseFacts(fang,'e','r','x'),asOf,undefined,F.TAG_LIST_V2);assert.equal(at(fv2,'capex').value,35e6);assert.equal(at(fv2,'capex').method,'reported:PaymentsToExploreAndDevelopOilAndGasProperties');
 assert.ok(!F.parseFacts(fang,'e','r','x').some(f=>f.source_tag==='PaymentsToAcquireOilAndGasProperty'));
 // Quarterly figures follow the same rule.
 const q=company();q.facts['us-gaap'].PaymentsToAcquireProductiveAssets={units:{USD:[{start:'2026-01-01',end:'2026-03-31',val:7,accn:'0000000001-26-000002',fy:2026,fp:'Q1',form:'10-Q',filed:'2026-04-30'}]}};
 const qf=F.parseFacts(q,'e','r','x');assert.equal(F.quarterlyFigures(qf,'2026-06-01T00:00:00Z').filter(f=>f.metric==='capex').length,0);assert.equal(F.quarterlyFigures(qf,'2026-06-01T00:00:00Z',undefined,F.TAG_LIST_V2).filter(f=>f.metric==='capex').length,1);
 assert.throws(()=>F.derive(facts,asOf,undefined,'xbrl-tags-v9'),/Unknown tag list/);
});

test('SEC read states are separate: not loaded, read failed (message kept), loaded before share counts were read, filings report none',()=>{
 const base=build(company({shares:[]}));
 const nl=F.impliedExpectations({...base,sec:{state:'not_loaded'}});assert.equal(nl.status,'unavailable');assert.deepEqual(nl.missing,['SEC data not loaded yet: no successful SEC read is stored for this company.']);assert.equal(nl.canLoadShareCounts,false);
 const fl=F.impliedExpectations({...base,sec:{state:'failed',error:'SEC returned HTTP 503.'}});assert.equal(fl.missing[0],'SEC read failed: SEC returned HTTP 503. This is a read error, not missing data; stored records are kept. Try again later.');assert.equal(fl.missing.length,1,'no knock-on reasons from data that was never read');assert.deepEqual(fl.sec,{state:'failed',error:'SEC returned HTTP 503.'});
 const old=F.impliedExpectations({...base,sec:{state:'loaded',parserCurrent:false,tagList:'xbrl-tags-v2'}});assert.match(old.missing[0],/^Share count not loaded yet: this company.s SEC data was stored before Sentinel read cover-page share counts\. It loads at the next SEC refresh, or with .Load share counts. below\.$/);assert.equal(old.canLoadShareCounts,true);
 const none=F.impliedExpectations({...base,sec:{state:'loaded',parserCurrent:true,tagList:'xbrl-tags-v2'}});assert.match(none.missing[0],/^Official share count: the company.s filings report no cover-page count/);assert.equal(none.canLoadShareCounts,false);
 const cfOld=F.impliedExpectations({...build(company({cfo:[90,100,110,120,20]})),sec:{state:'loaded',parserCurrent:false,tagList:'xbrl-tags-v2'}});assert.match(cfOld.missing.join(' '),/stored before the wider tag list \(xbrl-tags-v2\)/);
 assert.equal(F.IMPLIED_VERSION,'implied-expectations-v3');
 for(const x of [nl,fl,old,none,cfOld])assert.ok(!BANNED.test(JSON.stringify(x)));
});

test('ADR: a share count from a 20-F or 40-F makes the result unavailable: ADR ratio not stored',()=>{
 for(const form of ['20-F','40-F','20-F/A']){
  const d=company();d.facts.dei.EntityCommonStockSharesOutstanding.units.shares[0].form=form;
  const r=F.impliedExpectations(build(d));assert.equal(r.status,'unavailable');assert.equal(r.implied,undefined);
  assert.equal(r.missing[0],`Unavailable: ADR ratio not stored. The share count comes from a ${form}, which counts the company’s ordinary shares; how many of them one US-listed share represents is not stored, so the market value cannot be worked out.`);
 }
 assert.equal(F.impliedExpectations(build(company())).status,'computed','10-K count is fine');
});

test('checks not run are listed in one visible line',()=>{
 assert.equal(F.impliedExpectations(build(company())).notRun.text,null,'nothing reported is "not reported", not a check that was not run');
 assert.equal(F.impliedExpectations({...build(company()),sec:{state:'loaded',parserCurrent:false,tagList:'xbrl-tags-v3'}}).notRun.text,'Checks not run: noncontrolling interests, preferred stock.','read before the parser: not run');
 const r=F.impliedExpectations(build(company({debtNC:null}),{sic:null}));assert.equal(r.notRun.text,'Checks not run: company type (no industry code), debt (not tagged).');assert.deepEqual(r.notRun.ids,['company_type','leverage']);
 assert.ok(!BANNED.test(r.notRun.text));
});

test('checkpoint: overdue after the due date with no qualifying filing, and it says which filing it waits for',()=>{
 const data=company(),facts=F.parseFacts(data,'sec:0000000001','raw-1','x'),savedAt='2026-03-02T15:00:00.000Z';
 const cp=F.snap.checkpointFor('quarterly_revenue_yoy',savedAt,F.derive(facts,savedAt),F.quarterlyFigures(facts,savedAt));
 const before=F.snap.evaluateCheckpoint(cp,savedAt,'2026-06-10T12:00:00.000Z',F.derive(facts,savedAt),F.quarterlyFigures(facts,savedAt));
 assert.equal(cp.dueBy,'2026-06-10');assert.equal(before.status,'not_yet','on the due date itself: not yet');
 assert.equal(before.text,'Not yet: no filing made after this snapshot reports a later period. Waiting for: a 10-Q filed after 2026-03-02 reporting a quarter that ends after the latest quarter on file. A fourth quarter reported only in a 10-K does not count: it is not a separate three-month figure.');
 const late=F.snap.evaluateCheckpoint(cp,savedAt,'2026-06-11T00:00:01.000Z',F.derive(facts,savedAt),F.quarterlyFigures(facts,savedAt));
 assert.equal(late.status,'overdue');assert.match(late.text,/^Overdue: no qualifying filing by the due date \(2026-06-10\)\. Waiting for: a 10-Q filed after 2026-03-02/);assert.equal(late.waitingFor,before.waitingFor);
 const an=F.snap.checkpointFor('annual_cash_flow_positive',savedAt,F.derive(facts,savedAt),[]);
 assert.equal(F.snap.evaluateCheckpoint(an,savedAt,'2026-07-01T00:00:00.000Z',F.derive(facts,savedAt),[]).text,'Overdue: no qualifying filing by the due date (2026-06-10). Waiting for: a 10-K filed after 2026-03-02 reporting a fiscal year that ends after 2025-12-31.');
 assert.equal(F.snap.reviewSnapshot({snapshot:{savedAt,budgetCents:1,price:{sessionDate:null},checkpoint:an},now:'2026-07-01T00:00:00.000Z',annual:F.derive(facts,savedAt),quarterly:[],stock:null,spy:null}).business.status,'overdue');
 assert.match(F.snap.reviewSnapshot({snapshot:{savedAt,budgetCents:1,price:{sessionDate:null},checkpoint:an},now:'2026-07-01T00:00:00.000Z',secError:'SEC read failed: HTTP 503.',annual:null,quarterly:null,stock:null,spy:null}).business.text,/^Unavailable: SEC read failed: HTTP 503\./);
 for(const x of [before,late])assert.ok(!BANNED.test(x.text));
});

test('save guard: one request id per comparison; a click while saving is ignored; a new comparison gets a new id',()=>{
 let n=0;const g=F.createSaveGuard(()=>'id-'+(++n)),c1={a:1},c2={a:1};
 assert.equal(g.idFor(c1),'id-1');assert.equal(g.idFor(c1),'id-1','double click: same id');
 assert.equal(g.begin(),true);assert.equal(g.begin(),false,'second click while the first save runs is ignored');assert.equal(g.busy,true);g.end();assert.equal(g.begin(),true);g.end();
 assert.equal(g.idFor(c2),'id-2','a new comparison, even with equal content, is a new decision');
});

test('holdings over the price limit are labelled "not priced: over the limit", never valued',()=>{
 const b=beta=>({beta,r2:.5,days:252,from:'a',to:'b'});
 const r=F.compareDecision({symbol:'NEW',budgetCents:100_000,cashCents:600_000,holdings:[{symbol:'AAA',valueCents:250_000},{symbol:'ZZZ',valueCents:null,reason:'not priced: over the limit of 20 companies per comparison'}],betas:{AAA:b(1),NEW:b(1)}});
 assert.equal(r.start.totalCents,null);assert.deepEqual(r.start.holdings.find(h=>h.symbol==='ZZZ'),{symbol:'ZZZ',valueCents:null,status:'not priced: over the limit of 20 companies per comparison'});
 assert.equal(r.options[0].scenarios[0].reason,'No current price for ZZZ (not priced: over the limit of 20 companies per comparison).');
});
