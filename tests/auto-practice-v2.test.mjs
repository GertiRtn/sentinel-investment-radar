import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const esbuild=require(require.resolve('esbuild',{paths:[require.resolve('wrangler/package.json')]}));
const b=await esbuild.build({entryPoints:['lib/sentinel/auto-practice-v2.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const M=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const {V2_VERSION,V2_POLICY,V2_RULES_TEXT,V2_DISCLAIMER,decide,storedRuleFailure,companyBlock,firstFullSession,openInstant,closeInstant,priceSignal,exitClosed,planPortfolio,exitDue,judge,judgeSample,bootstrapMean,backfillCount,shadowFields,portfolioState,closesBy}=M;

// Weekday session dates (no holidays) from a start date.
const weekdays=(from,n)=>{const out=[];let t=Date.parse(from+'T12:00:00Z');while(out.length<n){const d=new Date(t);if(d.getUTCDay()%6)out.push(d.toISOString().slice(0,10));t+=86400000;}return out;};
const S=weekdays('2026-11-02',80); // Mon 2 Nov 2026 onwards (after the US DST change: 09:30 NY = 14:30Z)
const kase=(over={})=>({caseId:'c1',symbol:'AAA',status:'complete',assessedAt:'2026-11-03T12:00:00.000Z',screenVersion:'research-screen-v2',conclusion:'INVESTIGATE',newsDirection:'positive',newsLabel:'Good news',securityStatus:'candidate_common',securityVersion:'security-identity-v2',matchLevel:'named_in_headline',score:85,priceBasis:'last_close',topics:['Contract or customer win'],headline:'AAA wins contract',cik:'0000000001',...over});
const close=(c=10)=>({close:c,sessionDate:'2026-11-02',rawEventId:'bars-1'});

test('version, rules text and disclaimer carry no advice wording',()=>{
 assert.equal(V2_VERSION,'auto-practice-v2');assert.equal(V2_POLICY.positionCents,100000);assert.equal(V2_POLICY.maxPositions,5);assert.equal(V2_POLICY.holdSessions,20);assert.equal(V2_POLICY.costBpsPerSide,15);assert.equal(V2_POLICY.minCloseDollars,5);
 const text=[...V2_RULES_TEXT,V2_DISCLAIMER].join(' ');assert.ok(!/\b(buy now|sell now|price target|strong buy|you should buy|probability|expected return)\b/i.test(text));
 assert.ok(Object.isFrozen(V2_POLICY));
});

test('entry rules 2–4 read only the stored case; bad, mixed and neutral news never enter',()=>{
 assert.equal(storedRuleFailure(kase()),null);
 for(const d of ['negative','mixed','neutral'])assert.equal(decide(kase({newsDirection:d}),close(),[],S).code,'not_good_news');
 assert.equal(decide(kase({securityVersion:'security-identity-v1'}),close(),[],S).code,'security_unverified');
 assert.equal(decide(kase({securityStatus:'unverified'}),close(),[],S).code,'security_unverified');
 for(const m of ['ticker_only','name_conflict','named_in_summary'])assert.equal(decide(kase({matchLevel:m}),close(),[],S).code,'event_match_unconfirmed');
 // A stored-rule failure is decided without any price or calendar.
 assert.equal(decide(kase({newsDirection:'neutral'}),'pending',[],null).code,'not_good_news');
});

test('rule 5: no close is "no price"; below $5 fails; exactly $5 passes; an unreadable source waits',()=>{
 assert.equal(decide(kase(),null,[],S).code,'no_price');assert.match(decide(kase(),null,[],S).reason,/unknown is never a pass/);
 assert.equal(decide(kase(),close(4.99),[],S).code,'below_min_price');
 assert.equal(decide(kase(),close(5),[],S).outcome,'signal');
 assert.equal(decide(kase(),'pending',[],S),null,'not knowable yet: wait');
 assert.equal(decide(kase(),close(),[],null),null,'no calendar: rule 6 cannot be checked, so wait');
});

test('first full session after recording (New York clock)',()=>{
 assert.equal(openInstant('2026-11-03'),'2026-11-03T14:30:00.000Z');assert.equal(closeInstant('2026-11-03'),'2026-11-03T21:00:00.000Z');assert.equal(openInstant('2026-10-20'),'2026-10-20T13:30:00.000Z','daylight saving');
 assert.equal(firstFullSession('2026-11-03T12:00:00.000Z',S),'2026-11-03','pre-market: the same day');
 assert.equal(firstFullSession('2026-11-03T14:30:00.000Z',S),'2026-11-03','exactly at the open');
 assert.equal(firstFullSession('2026-11-03T15:00:00.000Z',S),'2026-11-04','mid-session: the next day');
 assert.equal(firstFullSession('2026-11-06T22:00:00.000Z',S),'2026-11-09','Friday evening: Monday');
 assert.equal(firstFullSession('2027-06-01T12:00:00.000Z',S),null,'not closed yet');
});

test('rule 6: one open signal per company, then 20 trading days blocked after its exit (SPY calendar only)',()=>{
 const prior=[{caseId:'p',symbol:'AAA',assessedAt:'2026-11-03T12:00:00.000Z'}]; // entry 3 Nov (S[1]), exit S[21]
 const exit=S[21],at=i=>new Date(Date.parse(closeInstant(S[i]))+3600000).toISOString();
 assert.equal(companyBlock('AAA',at(10),prior,S),'company_open');
 assert.equal(companyBlock('AAA',at(21)+'',prior,S),'reentry_blocked','exit session closed: blocked');
 assert.equal(companyBlock('AAA',at(40),prior,S),'reentry_blocked','19 sessions after the exit');
 assert.equal(companyBlock('AAA',at(41),prior,S),null,'20 sessions after the exit');
 assert.equal(companyBlock('BBB',at(10),prior,S),null,'other companies are unaffected');
 assert.equal(companyBlock('AAA','2026-11-03T12:00:00.000Z',prior,S,'p'),null,'a case never blocks itself');
 assert.equal(decide(kase({assessedAt:at(10),caseId:'c2'}),close(),prior,S).code,'company_open');
 assert.ok(exit>S[20]);
});

test('signal ledger pricing: adjusted closes, entry on the first full session, exit 20 sessions later, 15 bp each side, SPY same dates',()=>{
 const stock={},spy={};S.forEach((d,i)=>{stock[d]=100+i;spy[d]=500;});spy[S[21]]=510;
 const p=priceSignal('2026-11-03T12:00:00.000Z',stock,spy);
 assert.equal(p.status,'priced');assert.equal(p.entryDate,S[1]);assert.equal(p.exitDate,S[21]);assert.equal(p.stockEntry,101);assert.equal(p.stockExit,121);
 const gross=121/101-1,after=0.9985*(1+gross)*0.9985-1;
 assert.ok(Math.abs(p.grossReturn-gross)<1e-12);assert.ok(Math.abs(p.afterCostReturn-after)<1e-12);assert.ok(Math.abs(p.spyReturn-0.02)<1e-12);assert.ok(Math.abs(p.excessReturn-(after-0.02))<1e-12);assert.ok(Math.abs(p.excessGrossReturn-(gross-0.02))<1e-12);
 // A missing stock close is never substituted.
 const gap={...stock};delete gap[S[21]];const g=priceSignal('2026-11-03T12:00:00.000Z',gap,spy);assert.equal(g.status,'no_price');assert.match(g.reason,/exit date/);
 // Not enough sessions yet.
 const short={};S.slice(0,15).forEach(d=>short[d]=500);assert.equal(priceSignal('2026-11-03T12:00:00.000Z',stock,short).status,'pending');
 assert.equal(exitClosed('2026-11-03T12:00:00.000Z',S),true);assert.equal(exitClosed('2026-11-03T12:00:00.000Z',S.slice(0,21)),false);
 // Only sessions closed by asOf count.
 const bars={bars:[{t:'2026-11-03T05:00:00Z',c:10},{t:'2026-11-04T05:00:00Z',c:11}]};assert.deepEqual(closesBy(bars,'2026-11-04T20:59:00.000Z'),{'2026-11-03':10});
});

const q=(dollars,at,spreadPct=0.1)=>({priceCents:Math.round(dollars*100),at,rawEventId:'raw-'+dollars,source:'IEX midpoint',spreadPct});
test('portfolio: fills only at a fresh regular-session quote after the case; slots held while waiting; slots full and expiry are logged',()=>{
 const now='2026-11-04T15:00:00.000Z',known=S.filter(d=>closeInstant(d)<=now); // 2 and 3 Nov closed
 const awaiting=[{caseId:'a',symbol:'AAA',assessedAt:'2026-11-03T22:00:00.000Z'},{caseId:'b',symbol:'BBB',assessedAt:'2026-11-03T23:00:00.000Z'}];
 const base={now,cashCents:1_000_000,open:[],awaiting,sessions:known};
 const p=planPortfolio({...base,prices:{AAA:q(100,now),SPY:q(500,now)}});
 assert.deepEqual(p.fills.map(f=>[f.caseId,f.kind]),[['a','open']]);assert.equal(p.fills[0].costCents,150);assert.equal(p.fills[0].quantityMicros,Math.floor(99850*1e6/10000));
 assert.deepEqual(p.waiting.map(w=>w.caseId),['b']);
 const four=Array.from({length:4},(_,i)=>({positionId:'p'+i,caseId:'x'+i,symbol:'H'+i,openedAt:'2026-11-04T14:45:00.000Z',quantityMicros:1e6,spyQuantityMicros:1e6}));
 const full=planPortfolio({...base,open:four,prices:{}});assert.deepEqual(full.waiting.map(w=>w.caseId),['a'],'the waiting signal holds the fifth slot');assert.deepEqual(full.fills.map(f=>[f.caseId,f.code]),[['b','slots_full']]);assert.match(full.fills[0].reason,/slots full/);
 // Off-hours or stale quote: never fills.
 assert.equal(planPortfolio({...base,now:'2026-11-04T22:00:00.000Z',prices:{AAA:q(100,'2026-11-04T21:59:00.000Z'),SPY:q(500,'2026-11-04T21:59:00.000Z')}}).fills.length,0);
 assert.equal(planPortfolio({...base,prices:{AAA:q(100,'2026-11-04T14:40:00.000Z'),SPY:q(500,now)}}).fills.length,0);
 assert.equal(planPortfolio({...base,prices:{AAA:q(100,now,1.5),SPY:q(500,now)}}).fills.length,0);
 // A quote from before the case was recorded never fills it.
 const early=planPortfolio({...base,now:'2026-11-03T15:00:00.000Z',sessions:S.filter(d=>d<'2026-11-03'),awaiting:[{caseId:'e',symbol:'EEE',assessedAt:'2026-11-03T14:59:00.000Z'}],prices:{EEE:q(10,'2026-11-03T14:58:00.000Z'),SPY:q(500,'2026-11-03T14:58:00.000Z')}});
 assert.equal(early.fills.length,0);
 // Within 1 trading day: once the first full session after the case has closed with no fill, it is not taken.
 const late=planPortfolio({...base,now:'2026-11-05T15:00:00.000Z',sessions:S.filter(d=>d<='2026-11-04'),prices:{}});
 assert.deepEqual(late.fills.map(f=>[f.caseId,f.code]),[['a','no_price'],['b','no_price']]);
 // No calendar: nothing expires and nothing closes.
 assert.equal(planPortfolio({...base,sessions:null,prices:{}}).fills.length,0);
});

test('portfolio exit on the 20th trading day after entry, never earlier; late closes are flagged',()=>{
 const opened='2026-11-03T15:00:00.000Z',pos=[{positionId:'p',caseId:'a',symbol:'AAA',openedAt:opened,quantityMicros:9_985_000,spyQuantityMicros:1_997_000}];
 const day20=S[21],day19=S[20],during=d=>new Date(Date.parse(openInstant(d))+3600000).toISOString();
 assert.equal(exitDue(opened,during(day19),S).due,false,'19th session');
 assert.deepEqual(exitDue(opened,during(day20),S),{due:true,late:false,after:19});
 assert.deepEqual(exitDue(opened,during(S[22]),S),{due:true,late:true,after:20});
 const now=during(day20),c=planPortfolio({now,cashCents:900000,open:pos,awaiting:[],sessions:S,prices:{AAA:q(110,now),SPY:q(520,now)}});
 assert.equal(c.closes.length,1);assert.equal(c.closes[0].grossCents,109835);assert.equal(c.closes[0].costCents,165);assert.equal(c.closes[0].late,false);
 assert.equal(planPortfolio({now:during(day19),cashCents:900000,open:pos,awaiting:[],sessions:S,prices:{AAA:q(110,during(day19)),SPY:q(520,during(day19))}}).closes.length,0,'no early exit');
 const st=portfolioState({experimentId:'e',fills:[{kind:'open',caseId:'a',symbol:'AAA',code:'opened',reason:'',amountCents:100000,costCents:150,quantityMicros:9_985_000,spyQuantityMicros:1_997_000,price:q(100,opened),spy:q(500,opened),version:V2_VERSION,experimentId:'e',positionId:'p',at:opened}],closes:[{...c.closes[0],version:V2_VERSION,experimentId:'e',at:now}],live:{}});
 assert.equal(st.closed.length,1);assert.equal(st.cashCents,1_000_000-100000+109670);assert.match(st.note,/Realism check only/);
});

test('judging: collecting, data-quality check at 20, the fixed test at 50, inconclusive runs on to 100',()=>{
 const sig=(n,f)=>Array.from({length:n},(_,i)=>({caseId:'c'+String(i).padStart(3,'0'),symbol:'S'+i,assessedAt:'2026-11-'+String(1+i%28).padStart(2,'0')+'T12:00:00.000Z',exitDate:'2027-x'+String(i).padStart(3,'0'),excessReturn:f(i)}));
 const base={signals:0,noPrice:0,duplicates:0,fills:{opened:0,notTaken:{}},comparisonAverageAt:()=>0};
 assert.equal(judge({...base,priced:sig(19,()=>0.05)}).stage,'collecting');
 const qc=judge({...base,priced:sig(20,()=>0.05)});assert.equal(qc.stage,'quality_check');assert.equal(qc.result,'not_yet');assert.ok(qc.quality);assert.equal(qc.test50,null,'no performance verdict before 50');
 const good=i=>0.03+((i*37)%11-5)/1000;
 const s=judge({...base,priced:sig(50,good)});assert.equal(s.stage,'tested_at_50');assert.equal(s.result,'success');assert.ok(s.test50.interval.lower>0&&s.test50.average>=0.02&&s.test50.median>0);
 assert.equal(judge({...base,priced:sig(50,good),comparisonAverageAt:()=>0.05}).result,'failure','behind the main comparison group');
 assert.equal(judge({...base,priced:sig(50,good),comparisonAverageAt:()=>null}).result,'not_yet','comparison unknown: cannot be a success; waits for 100');
 assert.equal(judge({...base,priced:sig(50,i=>-0.01)}).result,'failure');
 const weak=i=>0.01+((i*37)%11-5)/1000;const w=judge({...base,priced:sig(60,weak)});assert.equal(w.stage,'waiting_for_100');assert.equal(w.test50.result,'inconclusive');
 const w100=judge({...base,priced:sig(100,weak)});assert.equal(w100.stage,'tested_at_100');assert.equal(w100.result,'inconclusive');
 // The test uses exactly the first 50 by exit order: later signals cannot change it.
 const more=sig(70,i=>i<50?good(i):-0.5);assert.equal(judge({...base,priced:more}).test50.average,judge({...base,priced:more.slice(0,50)}).test50.average);
 // Deterministic bootstrap.
 assert.deepEqual(bootstrapMean([1,2,3,4,5]),bootstrapMean([1,2,3,4,5]));const ci=bootstrapMean([0.01,0.02,0.03]);assert.ok(ci.lower>=0.01&&ci.upper<=0.03);
 assert.equal(judgeSample([0.02,0.02],0.02).result,'inconclusive','equal to the comparison: neither beats nor behind');
 assert.match(s.note,/not a buy or sell signal/);
});

test('count of past stored cases, per month, with rule 6 simulated oldest first',()=>{
 const cs=[kase({caseId:'a',assessedAt:'2026-11-03T12:00:00.000Z',researchRules:true}),kase({caseId:'b',assessedAt:'2026-11-05T12:00:00.000Z',researchRules:true}),
  kase({caseId:'c',symbol:'CCC',assessedAt:'2026-11-05T12:00:00.000Z',newsDirection:'neutral',researchRules:true}),kase({caseId:'d',symbol:'DDD',assessedAt:'2026-10-20T12:00:00.000Z',researchRules:false}),
  kase({caseId:'e',symbol:'EEE',assessedAt:'2026-11-06T12:00:00.000Z',researchRules:true}),kase({caseId:'f',symbol:'FFF',assessedAt:'2026-11-06T12:00:00.000Z',researchRules:true}),kase({caseId:'g',symbol:'GGG',assessedAt:'2026-11-06T12:00:00.000Z',researchRules:true})];
 const r=backfillCount(cs,{a:close(),b:close(),e:close(3),f:null},S);
 assert.deepEqual(r.months.map(m=>m.month),['2026-10','2026-11']);
 const nov=r.months[1];assert.equal(nov.assessed,6);assert.equal(nov.researchRules,6);assert.equal(nov.goodNews,5);assert.equal(nov.wouldSignal,1);assert.equal(nov.companyBlocked,1,'b: AAA already open');assert.equal(nov.belowMinPrice,1);assert.equal(nov.noPrice,1);assert.equal(nov.priceNotChecked,1,'g: not checked is shown, never counted as passing');
 assert.equal(r.months[0].researchRules,0);assert.equal(r.total.assessed,7);
});

test('shadow fields are recorded, never decided on',()=>{
 const s=shadowFields(kase({score:72,topics:[]}),'1731');assert.deepEqual([s.scoreBand,s.priceBasis,s.eventType[0],s.sic],['Strong evidence','last_close','unknown','1731']);
 assert.equal(shadowFields(kase({score:null,priceBasis:null}),'').scoreBand,'No evidence score');assert.equal(shadowFields(kase({score:null,priceBasis:null}),'').sic,null);
 assert.equal(decide.length,4,'decide takes no verdict input');
});
