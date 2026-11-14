import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const esbuild=require(require.resolve('esbuild',{paths:[require.resolve('wrangler/package.json')]}));
const b=await esbuild.build({entryPoints:['lib/sentinel/company-page.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {buildCompanyPage,statusLabel,keyFigures,financials,priceBlock,filingUrl}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));

// Fixtures only (fictional company). Not market data.
const fact=(metric,end,value,acc='0000000101-26-000001')=>({metric,value,period_end:end,inputs:[{form:'10-K',filed:end.slice(0,4)+'-12-01',accession:acc}]});
const sessions=n=>{const o=[];let t=Date.parse('2025-06-02T12:00:00Z');while(o.length<n){const d=new Date(t);if(d.getUTCDay()%6)o.push(d.toISOString().slice(0,10));t+=86400000;}return o;};
const DAYS=sessions(280),bars=(f)=>({bars:DAYS.map((d,i)=>({t:d+'T12:00:00Z',c:f(i)}))});
const kase=(id,over={})=>({id,symbol:'ACME',createdAt:'2026-03-01T15:00:00.000Z',conclusion:'MONITOR',decision:{version:'research-screen-v2'},identity:{cik:'0000000101',name:'Acme Robotics Inc'},
 event:{headline:'Acme Robotics signs supply deal',publishedAt:'2026-03-01T13:00:00.000Z',source:'Fixture wire',url:'https://example.test/a',analysis:{topics:['Contract or customer']}},...over});

test('stored screen values get the user-facing labels; stored values are not changed',()=>{
 assert.equal(statusLabel({conclusion:'INVESTIGATE',decision:{version:'research-screen-v2'}}),'Meets research rules');
 assert.equal(statusLabel({conclusion:'MONITOR',decision:{version:'research-screen-v2'}}),'Watch: a rule is not met');
 assert.equal(statusLabel({conclusion:'WAIT',decision:{version:'research-screen-v2'}}),'Waiting for data');
 assert.equal(statusLabel({conclusion:'INVESTIGATE'}),'Older screen: no judgment','v1 INVESTIGATE is never shown as meeting the rules');
 const k=kase('c1',{conclusion:'INVESTIGATE'});statusLabel(k);assert.equal(k.conclusion,'INVESTIGATE');
});

test('key figures: reported values with period and source; like-for-like change only; FCF calculated and labelled; P/E from the case',()=>{
 const figs=[fact('revenue','2024-12-31',100e6),fact('revenue','2025-12-31',110e6),fact('net_income','2024-12-31',-5e6),fact('net_income','2025-12-31',8e6),fact('cfo','2025-12-31',30e6),fact('capex','2025-12-31',42e6)];
 const rows=keyFigures(kase('c1',{price:{status:'indicative',ratio:24.1,basis:'last_close',priceLabel:'$48.12',periodEnd:'2025-12-31'}}),figs,'0000000101');
 const by=Object.fromEntries(rows.map(r=>[r.metric,r]));
 assert.equal(by.revenue.value,110e6);assert.ok(Math.abs(by.revenue.changePct-10)<1e-9);assert.match(by.revenue.source.url,/^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/101\/000000010126000001\/$/);
 assert.equal(by.net_income.value,8e6);assert.equal(by.net_income.changePct,null,'a negative base gives no percentage change');assert.match(by.net_income.changeNote,/non-positive base/);
 assert.equal(by.fcf.value,-12e6,'negative free cash flow is kept');assert.match(by.fcf.help,/Calculated by Sentinel/);
 assert.equal(by.pe.value,24.1);assert.match(by.pe.changeNote,/^Price: Last close \(\$48\.12\)/);
 const mid=keyFigures(kase('c2',{price:{status:'indicative',ratio:23.3,basis:'live_midpoint',priceLabel:'IEX midpoint'}}),[],null).find(r=>r.metric==='pe');assert.ok(!/IEX midpoint \(IEX midpoint\)/.test(mid.changeNote),'no repeated label');
 const none=Object.fromEntries(keyFigures(null,[],null).map(r=>[r.metric,r]));for(const m of ['pe','revenue','net_income','cfo','fcf']){assert.equal(none[m].value,null);assert.ok(none[m].reason,m+' says why it is unknown');}
 const gap=keyFigures(null,[fact('revenue','2023-12-31',90e6),fact('revenue','2025-12-31',110e6)],null).find(r=>r.metric==='revenue');assert.equal(gap.changePct,null,'two years apart is not a yearly change');
 assert.equal(filingUrl('101','bad'),null);
});

test('financials: missing values stay null, margins only with a positive revenue, a skipped quarter shows as a gap',()=>{
 const f=financials([fact('revenue','2024-12-31',100e6),fact('net_income','2024-12-31',-5e6),fact('revenue','2025-12-31',110e6)],
  [fact('revenue','2025-03-31',25e6),fact('revenue','2025-06-30',27e6),fact('revenue','2025-09-30',28e6),fact('revenue','2026-03-31',30e6),fact('net_income','2026-03-31',2e6)],'0000000101');
 assert.deepEqual(f.annual.map(r=>[r.period,r.netIncome,r.margin===null?null:Math.round(r.margin)]),[['FY 2024',-5e6,-5],['FY 2025',null,null]]);
 assert.deepEqual(f.quarterly.map(r=>r.gap?'gap':r.period),['Q to 2025-03','Q to 2025-06','Q to 2025-09','gap','Q to 2026-03']);
 assert.ok(f.source.url);assert.match(f.note,/fourth quarter/);
});

test('price: last close with basis and staleness, ranges against SPY on the same dates, event markers after publication, unavailable without bars',()=>{
 const p=priceBlock(bars(i=>100+i*0.1),bars(()=>400),'2027-01-01T00:00:00Z',[{caseId:'c1',publishedAt:DAYS[200]+'T15:00:00Z',headline:'h'}]);
 assert.equal(p.status,'ok');assert.equal(p.last.date,DAYS.at(-1));assert.match(p.last.basis,/Last completed IEX daily close/);assert.equal(p.last.stale,false);
 const r=p.ranges['1M'];assert.equal(r.sessions,21);assert.ok(Math.abs(r.stockPct-((100+279*0.1)/(100+258*0.1)-1)*100)<1e-9);assert.equal(r.spyPct,0);
 assert.equal(p.ranges['1Y'].partial,false);assert.equal(p.markers[0].date,DAYS[200],'published before the close: marked on that day');
 const stale=priceBlock({bars:bars(i=>100).bars.slice(0,270)},bars(()=>400),'2027-01-01T00:00:00Z',[]);assert.equal(stale.last.stale,true);assert.equal(stale.last.staleSessions,10);
 assert.equal(priceBlock(null,null,null,[]).status,'unavailable');assert.equal(priceBlock({bars:[]},bars(()=>1),'2027-01-01T00:00:00Z',[]).status,'unavailable');
});

test('page: one company, several events, each with its own match and verification; assessment from the latest case; no case → no assessment',()=>{
 const cases=[kase('old',{createdAt:'2026-01-01T15:00:00.000Z',conclusion:'INVESTIGATE',event:{headline:'Analyst lifts Acme Robotics target',publishedAt:'2026-01-01T13:00:00.000Z',analysis:{topics:['Analyst opinion']}}}),
  kase('new',{event:{headline:'ams-OSRAM AG sells unit',publishedAt:'2026-03-01T13:00:00.000Z',analysis:{topics:['Merger or acquisition']}},symbol:'AMS',identity:{cik:'0000744825',name:'AMERICAN SHARED HOSPITAL SERVICES'}})];
 const page=buildCompanyPage({symbol:'AMS',entity:null,followed:false,cases,latestIdea:{view:{tone:'doubt',label:'Probably not about this company',text:'x'},score:{score:null,coverage:40},summary:{reason:null,reasonNote:'Not offered as an idea: probably a different company.',counter:null},match:{level:'name_conflict'}},
  verifications:{old:{state:'not_company_event',label:'Analyst opinion: not a company event'}},figures:[],quarterly:[],figuresAsOf:null,bars:{stock:null,spy:null,fetchedAt:null,error:'Market data is not connected.'},positions:{manualCents:0,inExperiment:false}});
 assert.deepEqual(page.events.map(e=>e.caseId),['new','old'],'latest first');
 assert.equal(page.events[0].match.level,'name_conflict');assert.equal(page.events[1].analystOpinion,true);assert.equal(page.events[0].verification.state,'not_checked');assert.equal(page.events[1].verification.state,'not_company_event');
 assert.equal(page.events[1].status,'Meets research rules');assert.equal(page.assessment.caseId,'new');assert.equal(page.assessment.promoted,false);assert.equal(page.assessment.earlierEvents,1);assert.equal(page.assessment.reason,null);
 assert.equal(page.price.status,'unavailable');assert.equal(page.price.reason,'Market data is not connected.');assert.equal(page.directionalView.available,false);
 const empty=buildCompanyPage({symbol:'ACME',entity:{name:'Acme Robotics Inc',cik:'0000000101',sic:'3569'},followed:true,cases:[],latestIdea:null,verifications:{},figures:[],quarterly:[],figuresAsOf:null,bars:{stock:null,spy:null,fetchedAt:null},positions:{manualCents:null,inExperiment:null}});
 assert.equal(empty.assessment,null);assert.match(empty.assessmentNote,/no research case/);assert.equal(empty.company.industryCode,'3569');
 const text=JSON.stringify(page)+JSON.stringify(empty);assert.ok(!/\b(buy|sell|price target|probabilit|expected return)\b/i.test(text),'no advice wording');
});
