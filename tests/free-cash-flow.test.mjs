import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const esbuild=require(require.resolve('esbuild',{paths:[require.resolve('wrangler/package.json')]}));
const load=async entry=>{const b=await esbuild.build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm'});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));};
const M=await load(`export * from './lib/sentinel/financial';export * from './lib/sentinel/free-cash-flow';export {keyFigures} from './lib/sentinel/company-page';export {impliedExpectations} from './lib/sentinel/implied-expectations';export {cashflowScenarios} from './lib/sentinel/cashflow-scenarios';`);
const {parseFacts,derive,latestShareCount,freeCashFlow,keyFigures,impliedExpectations,cashflowScenarios,TAG_LIST_V1,TAG_LIST_V3,TAG_LIST_V4,TAG_LISTS,CAPEX_TAGS,CAPEX_TAG_LIST,CAPEX_EXCLUDED}=M;

// Fictional companies in SEC companyfacts shape, read through the real parser. Not market data.
const asOf='2026-03-02T15:00:00.000Z';
const row=(y,val)=>({start:y+'-01-01',end:y+'-12-31',val,accn:'0000000001-'+String(y+1).slice(2)+'-000001',fy:y,fp:'FY',form:'10-K',filed:(y+1)+'-02-15'});
function company(capexTag){
 const years=[2023,2024,2025],us={
  Revenues:{units:{USD:years.map(y=>row(y,900e6))}},NetIncomeLoss:{units:{USD:years.map(y=>row(y,50e6))}},
  NetCashProvidedByUsedInOperatingActivities:{units:{USD:years.map((y,i)=>row(y,[110e6,120e6,130e6][i]))}},
  CashAndCashEquivalentsAtCarryingValue:{units:{USD:years.map(y=>({end:y+'-12-31',val:50e6,accn:'0000000001-'+String(y+1).slice(2)+'-000001',fy:y,fp:'FY',form:'10-K',filed:(y+1)+'-02-15'}))}},
  LongTermDebtNoncurrent:{units:{USD:years.map(y=>({end:y+'-12-31',val:100e6,accn:'0000000001-'+String(y+1).slice(2)+'-000001',fy:y,fp:'FY',form:'10-K',filed:(y+1)+'-02-15'}))}}};
 if(capexTag)us[capexTag]={units:{USD:years.map(y=>row(y,30e6))}};
 const dei={EntityCommonStockSharesOutstanding:{units:{shares:[{end:'2026-01-31',val:20_000_000,accn:'0000000001-26-000001',fy:2025,fp:'FY',form:'10-K',filed:'2026-02-15'}]}}};
 return {cik:1,facts:{'us-gaap':us,dei}};
}
const facts=data=>parseFacts(data,'sec:0000000001','raw-1','2026-02-16T00:00:00.000Z');
/** Both surfaces exactly as their routes build them: the company page and the decision workflow both read xbrl-tags-v4. */
function surfaces(data){
 const f=facts(data),figures=derive(f,asOf,undefined,TAG_LIST_V4);
 const key=keyFigures(null,figures,'0000000001').find(r=>r.metric==='fcf');
 const card=impliedExpectations({symbol:'FIX',asOf,sic:'3570',figures,shareFact:latestShareCount(f,asOf),claimFacts:[],sec:{state:'loaded',parserCurrent:true,tagList:TAG_LIST_V4},
  price:{value:50,at:'2026-02-27T21:00:00.000Z',basis:'last_close',source:'IEX daily close 2026-02-27',rawEventId:'bars-1'},split:{state:'none',coverSession:'2026-01-30',priceSession:'2026-02-27',source:'fixture'}});
 return {key,card,shared:freeCashFlow(figures)};
}

test('the shared capex list: one list (capex-tags-v3), only purchases of property, plant and equipment; ambiguous tags left out, not lost',()=>{
 assert.equal(CAPEX_TAG_LIST,'capex-tags-v3');assert.deepEqual([...CAPEX_TAGS],['PaymentsToAcquirePropertyPlantAndEquipment']);
 assert.deepEqual(Object.keys(CAPEX_EXCLUDED).sort(),['PaymentsToAcquireProductiveAssets','PaymentsToExploreAndDevelopOilAndGasProperties']);
 assert.equal(TAG_LISTS[TAG_LIST_V4].capex.join(),CAPEX_TAGS.join(),'xbrl-tags-v4 takes capex from the shared list');
 assert.deepEqual(TAG_LISTS[TAG_LIST_V3].capex,['PaymentsToAcquirePropertyPlantAndEquipment','PaymentsToAcquireProductiveAssets','PaymentsToExploreAndDevelopOilAndGasProperties'],'old lists are unchanged');
 assert.deepEqual(TAG_LISTS[TAG_LIST_V1].capex,['PaymentsToAcquirePropertyPlantAndEquipment']);
 const stored=facts(company('PaymentsToAcquireProductiveAssets'));assert.ok(stored.some(f=>f.metric==='capex'&&f.source_tag==='PaymentsToAcquireProductiveAssets'),'the fact is still stored; the list decides use');
});

test('(a) capex only under a v2-only tag: both surfaces Unknown with the not-tagged note, never zero',()=>{
 for(const tag of ['PaymentsToAcquireProductiveAssets','PaymentsToExploreAndDevelopOilAndGasProperties']){
  const {key,card,shared}=surfaces(company(tag));
  assert.equal(shared.status,'unknown');assert.equal(shared.code,'capex_not_tagged');
  assert.equal(key.value,null,tag);assert.notEqual(key.value,0);assert.match(key.reason,/^Capital spending is not tagged/);assert.equal(key.capexTagList,'capex-tags-v3');
  assert.equal(card.status,'unavailable');assert.equal(card.baseCashFlow,undefined);assert.ok(card.missing.includes('Base cash flow: '+shared.reason),JSON.stringify(card.missing));
  assert.ok(card.history.rows.every(r=>r.value===null&&r.changeNote==='capital spending not tagged'),'the history uses the same rule');
 }
 // Figures derived with an older list (xbrl-tags-v3) can carry such a tag as capex: the shared function still refuses it, and says why.
 const old=derive(facts(company('PaymentsToAcquireProductiveAssets')),asOf,undefined,TAG_LIST_V3),r=freeCashFlow(old);
 assert.equal(r.status,'unknown');assert.match(r.reason,/It is reported as PaymentsToAcquireProductiveAssets, which is not used because its SEC definition also covers software and other intangible assets\./);
 assert.equal(cashflowScenarios(old,asOf).status,'unavailable','case scenarios use the same function');
});

test('(b) capex under the v1 tag (PaymentsToAcquirePropertyPlantAndEquipment, the only capex tag in v1): both surfaces show it',()=>{
 const {key,card,shared}=surfaces(company('PaymentsToAcquirePropertyPlantAndEquipment'));
 assert.equal(shared.status,'reported');assert.equal(shared.value,130e6-30e6);assert.equal(shared.capexTag,'PaymentsToAcquirePropertyPlantAndEquipment');
 assert.equal(key.value,100e6);assert.equal(card.baseCashFlow.value,100e6);
 // v1 has no capex tag that v2 lacks; figures read with v1 (cases) give the same number through the same function.
 assert.equal(freeCashFlow(derive(facts(company('PaymentsToAcquirePropertyPlantAndEquipment')),asOf)).value,100e6);
});

test('(c) no capex tag at all: both surfaces Unknown with the not-tagged note, never zero',()=>{
 const {key,card,shared}=surfaces(company(null));
 assert.equal(shared.code,'capex_not_tagged');assert.equal(key.value,null);assert.match(key.reason,/not tagged.*Free cash flow is unknown, not zero\./);
 assert.equal(card.status,'unavailable');assert.ok(card.missing.some(m=>/^Base cash flow: Capital spending is not tagged/.test(m)));
 assert.ok(!JSON.stringify(key).includes('"value":0'),'no zero substituted');
});

test('(d) the same company gives the same number on both surfaces, with the same provenance',()=>{
 const {key,card,shared}=surfaces(company('PaymentsToAcquirePropertyPlantAndEquipment'));
 assert.equal(key.value,card.baseCashFlow.value);assert.equal(key.value,shared.value);
 assert.equal(key.periodEnd,card.baseCashFlow.periodEnd);assert.equal(key.calculation.accession,card.baseCashFlow.accession);
 assert.deepEqual([key.calculation.cfo,key.calculation.capex],[card.baseCashFlow.cfo,card.baseCashFlow.capex]);
 assert.equal(key.capexTagList,'capex-tags-v3');assert.equal(card.baseCashFlow.capexTagList,'capex-tags-v3');
 assert.equal(key.fcfVersion,'free-cash-flow-v1');assert.equal(card.baseCashFlow.fcfVersion,'free-cash-flow-v1');assert.equal(key.tagList,'xbrl-tags-v4');
 assert.equal(card.history.rows.at(-1).value,key.value,'the card\'s history row for the same year agrees too');
 // A filing mismatch is unknown on both, not a number on one.
 const data=company('PaymentsToAcquirePropertyPlantAndEquipment');data.facts['us-gaap'].PaymentsToAcquirePropertyPlantAndEquipment.units.USD.at(-1).accn='0000000001-26-000099';
 const m=surfaces(data);assert.equal(m.key.value,null);assert.equal(m.card.status,'unavailable');assert.equal(m.shared.code,'not_matched');
});
