// Design-review fixtures (2026-11-17). Offline only: never imported by the Worker and never stored.
// Builds the JSON the company page receives, for a FICTIONAL company, by calling Sentinel's real pure functions
// (company-page builder, implied-expectations, decision-compare). So every screenshot state shows the real reason text.
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const esbuild=require(require.resolve('esbuild',{paths:[require.resolve('wrangler/package.json')]}));
const b=await esbuild.build({stdin:{contents:`export * from './lib/sentinel/company-page';export * from './lib/sentinel/financial';export * from './lib/sentinel/implied-expectations';export {compareDecision} from './lib/sentinel/decision-compare';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm'});
const M=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));

export const SYMBOL='FXR',NAME='Fixture Robotics Inc (fictional)';
const asOf='2026-11-16T15:00:00.000Z';
const sessions=n=>{const o=[];let t=Date.parse('2025-09-01T12:00:00Z');while(o.length<n){const d=new Date(t);if(d.getUTCDay()%6)o.push(d.toISOString().slice(0,10));t+=86400000;}return o;};
const DAYS=sessions(305).filter(d=>d<'2026-11-14');
const wave=(i,a,b)=>a+b*Math.sin(i/17)+i*0.02;
const bars=f=>({bars:DAYS.map((d,i)=>({t:d+'T05:00:00Z',c:Math.round(f(i)*100)/100}))});
const fig=(metric,end,value,acc='0000000999-26-000004')=>({metric,value,period_end:end,inputs:[{form:'10-K',filed:(Number(end.slice(0,4))+1)+'-02-20',accession:acc}]});
const qf=(metric,end,value)=>({metric,value,period_end:end,inputs:[{form:'10-Q',filed:end.slice(0,8)+'28',accession:'0000000999-26-000007'}]});
const kase=(id,over={})=>({id,symbol:SYMBOL,createdAt:'2026-11-10T15:00:00.000Z',conclusion:'MONITOR',decision:{version:'research-screen-v2'},identity:{cik:'0000000999',name:NAME},
 event:{headline:'Fixture Robotics signs supply contract with a logistics customer',publishedAt:'2026-11-10T13:00:00.000Z',source:'Fixture wire',url:'https://example.test/fxr',analysis:{topics:['Contract or customer']}},
 eventMatch:{version:'event-match-v1',level:'named_in_headline',label:'named in headline'},newsDirection:{version:'news-direction-v1',direction:'positive',label:'Good news'},price:{status:'indicative',ratio:24.1,basis:'last_close',priceLabel:'IEX close 2026-11-13',periodEnd:'2025-12-31'},...over});
export function companyPage(){
 const cases=[kase('discovery-case:fxr-1'),kase('discovery-case:fxr-0',{createdAt:'2026-08-02T15:00:00.000Z',event:{headline:'Fixture Robotics reports second-quarter results',publishedAt:'2026-08-02T12:00:00.000Z',source:'Fixture wire',url:'https://example.test/fxr0',analysis:{topics:['Earnings']}},newsDirection:{version:'news-direction-v1',direction:'neutral',label:'Neutral news'}})];
 const figures=[['2021',610],['2022',700],['2023',820],['2024',930],['2025',1040]].flatMap(([y,r],i)=>[fig('revenue',y+'-12-31',r*1e6),fig('net_income',y+'-12-31',[22,-8,31,44,58][i]*1e6),fig('cfo',y+'-12-31',[50,40,72,96,118][i]*1e6),fig('capex',y+'-12-31',[20,24,26,28,30][i]*1e6)]);
 const quarterly=[['2025-03-31',240,9],['2025-06-30',252,12],['2025-09-30',266,14],['2026-03-31',262,13],['2026-06-30',276,15],['2026-09-30',290,null]].flatMap(([e,r,n])=>[qf('revenue',e,r*1e6),...(n===null?[]:[qf('net_income',e,n*1e6)])]);
 return M.buildCompanyPage({symbol:SYMBOL,entity:{name:NAME,cik:'0000000999',sic:'3569'},followed:false,cases,
  latestIdea:{view:{tone:'watch',label:'Close to meeting the research rules',text:'One research rule is not met yet: the P/E is above the screen limit.'},score:{score:68,coverage:90,meaning:'Evidence score: how much stored, sourced evidence supports a closer look, from a published checklist. It is not a probability or a forecast of returns.'},
   summary:{reason:{text:'Revenue grew 10.1% against the same quarter a year earlier (10-Q filed 2026-10-28).'},counter:{text:'Net income for the latest quarter is not reported separately.',unknown:false}},match:{level:'named_in_headline',label:'named in headline'}},
  verifications:{'discovery-case:fxr-1':{state:'supported',label:'backed by a company 8-K'}},figures,quarterly,figuresAsOf:'2026-11-02T00:00:00.000Z',
  bars:{stock:bars(i=>wave(i,48,3)),spy:bars(i=>wave(i,560,12)),fetchedAt:'2026-11-16T10:00:00.000Z'},positions:{manualCents:0,inExperiment:false}});
}

// ---- What the price assumes: every real state -------------------------------------------------
const row=(y,val,over={})=>({start:y+'-01-01',end:y+'-12-31',val,accn:'0000000999-'+String(y+1).slice(2)+'-000004',fy:y,fp:'FY',form:'10-K',filed:(y+1)+'-02-20',...over});
const inst=(y,val)=>({end:y+'-12-31',val,accn:'0000000999-'+String(y+1).slice(2)+'-000004',fy:y,fp:'FY',form:'10-K',filed:(y+1)+'-02-20'});
function facts({nci=null,preferred=0,shares=[['2026-10-23',21_500_000]],nciUnit='USD'}={}){
 const ys=[2021,2022,2023,2024,2025],us={NetCashProvidedByUsedInOperatingActivities:{units:{USD:ys.map((y,i)=>row(y,[50,40,72,96,118][i]*1e6))}},PaymentsToAcquirePropertyPlantAndEquipment:{units:{USD:ys.map((y,i)=>row(y,[20,24,26,28,30][i]*1e6))}},
  LongTermDebtNoncurrent:{units:{USD:[inst(2025,140e6)]}},LongTermDebtCurrent:{units:{USD:[inst(2025,20e6)]}},CashAndCashEquivalentsAtCarryingValue:{units:{USD:[inst(2025,65e6)]}}};
 if(preferred!==null)us.PreferredStockValue={units:{USD:[inst(2025,preferred)]}};
 if(nci!==null)us.MinorityInterest={units:{[nciUnit]:[inst(2025,nci)]}};
 const dei={EntityCommonStockSharesOutstanding:{units:{shares:shares.map(([end,val])=>({end,val,accn:'0000000999-26-000007',fy:2026,fp:'Q3',form:'10-Q',filed:'2026-10-28'}))}}};
 return M.parseFacts({cik:999,facts:{'us-gaap':us,dei}},'sec:0000000999','fixture-raw','2026-11-01T00:00:00.000Z');
}
const price={value:48.62,at:'2026-11-13T21:00:00.000Z',basis:'last_close',source:'IEX daily close 2026-11-13 (one US exchange)',rawEventId:'fixture-bars'};
const none={state:'none',coverSession:'2026-10-23',priceSession:'2026-11-13',source:'Alpaca IEX daily closes, unadjusted and split-adjusted'};
const loaded={state:'loaded',parserCurrent:true,tagList:'xbrl-tags-v3'};
function implied(over={},factOpts={}){
 const f=facts(factOpts),claimFacts=f.filter(x=>['nci','nci_redeemable','preferred','claim_unreadable'].includes(x.metric));
 const r=M.impliedExpectations({symbol:SYMBOL,asOf,sic:'3569',figures:M.derive(f,asOf,undefined,M.TAG_LIST_V3),shareFact:M.latestShareCount(f,asOf),price,sec:loaded,split:none,claimFacts,...over});
 return {...r,company:{name:NAME,cik:'0000000999',sic:'3569'},sources:{secRead:(over.sec??loaded).state,tagList:'xbrl-tags-v3'}};
}
export const IMPLIED_STATES={
 available:()=>implied({},{nci:4e6}),
 sec_not_loaded:()=>implied({sec:{state:'not_loaded'},figures:[],shareFact:null,claimFacts:[]}),
 sec_failed:()=>implied({sec:{state:'failed',error:'SEC returned HTTP 503.'},figures:[],shareFact:null,claimFacts:[]}),
 split_since:()=>implied({split:{state:'split',factor:2,ratio:'2-for-1',coverSession:'2026-10-23',priceSession:'2026-11-13',source:'Alpaca IEX daily closes, unadjusted and split-adjusted'}}),
 possible_split:()=>implied({split:{state:'unclear',factor:1.37,coverSession:'2026-10-23',priceSession:'2026-11-13',source:'Alpaca IEX daily closes, unadjusted and split-adjusted'}}),
 split_not_run:()=>implied({split:{state:'not_run',reason:'unadjusted IEX prices could not be read (The price source returned HTTP 503.)'}}),
 share_classes:()=>implied({otherTickers:['FXR.B']}),
 nci_over_10:()=>implied({},{nci:260e6}),
 preferred_over_10:()=>implied({},{preferred:180e6}),
 tag_unreadable:()=>implied({},{nci:5e6,nciUnit:'EUR'}),
 not_reported:()=>implied({},{preferred:null}),
 checks_not_run:()=>implied({sec:{state:'loaded',parserCurrent:false,tagList:'xbrl-tags-v3'}},{preferred:null}),
};

export function compare(){
 const beta=v=>({beta:v,r2:0.4,days:252,from:'2025-11-14',to:'2026-11-13'});
 const r=M.compareDecision({symbol:SYMBOL,budgetCents:100_000,cashCents:640_000,holdings:[{symbol:'HLDA',valueCents:210_000},{symbol:'HLDB',valueCents:150_000}],betas:{HLDA:beta(1.2),HLDB:beta(0.6),FXR:beta(1.4)}});
 return {...r,preparedAt:'2026-11-16T15:02:11.000Z',practice:{sequence:2,cashCents:640_000,open:[]},marks:{FXR:{close:48.62,sessionDate:'2026-11-13',rawEventId:'fixture-bars'}},spyReference:{close:566.2,sessionDate:'2026-11-13',rawEventId:'fixture-spy'},
  valuation:'Holdings are valued at the last completed IEX daily close (one US exchange), not a live quote.',problems:[]};
}
