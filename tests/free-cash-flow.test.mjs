import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const esbuild=require(require.resolve('esbuild',{paths:[require.resolve('wrangler/package.json')]}));
const load=async entry=>{const b=await esbuild.build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm'});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));};
const M=await load(`export * from './lib/sentinel/financial';export * from './lib/sentinel/free-cash-flow';export {keyFigures} from './lib/sentinel/company-page';export {impliedExpectations} from './lib/sentinel/implied-expectations';export {cashflowScenarios} from './lib/sentinel/cashflow-scenarios';`);
const {parseFacts,derive,latestShareCount,freeCashFlow,keyFigures,impliedExpectations,cashflowScenarios,TAG_LIST_V1,TAG_LIST_V3,TAG_LIST_V4,TAG_LIST_V5,TAG_LISTS,CAPEX_TAGS,CAPEX_TAG_LIST,CAPEX_TAG_LISTS}=M;

// Fictional companies in SEC companyfacts shape, read through the real parser. Not market data.
const asOf='2026-03-02T15:00:00.000Z';
const row=(y,val)=>({start:y+'-01-01',end:y+'-12-31',val,accn:'0000000001-'+String(y+1).slice(2)+'-000001',fy:y,fp:'FY',form:'10-K',filed:(y+1)+'-02-15'});
function company(capexTag){
 const years=[2023,2024,2025],us={
  Revenues:{units:{USD:years.map(y=>row(y,900e6))}},NetIncomeLoss:{units:{USD:years.map(y=>row(y,50e6))}},
  NetCashProvidedByUsedInOperatingActivities:{units:{USD:years.map((y,i)=>row(y,[110e6,120e6,130e6][i]))}},
  CashAndCashEquivalentsAtCarryingValue:{units:{USD:years.map(y=>({end:y+'-12-31',val:50e6,accn:'0000000001-'+String(y+1).slice(2)+'-000001',fy:y,fp:'FY',form:'10-K',filed:(y+1)+'-02-15'}))}},
  LongTermDebtNoncurrent:{units:{USD:years.map(y=>({end:y+'-12-31',val:100e6,accn:'0000000001-'+String(y+1).slice(2)+'-000001',fy:y,fp:'FY',form:'10-K',filed:(y+1)+'-02-15'}))}}};
 const capex=typeof capexTag==='string'?{[capexTag]:30e6}:capexTag??{};for(const [tag,val] of Object.entries(capex))us[tag]={units:{USD:years.map(y=>row(y,val))}};
 const dei={EntityCommonStockSharesOutstanding:{units:{shares:[{end:'2026-01-31',val:20_000_000,accn:'0000000001-26-000001',fy:2025,fp:'FY',form:'10-K',filed:'2026-02-15'}]}}};
 return {cik:1,facts:{'us-gaap':us,dei}};
}
const facts=data=>parseFacts(data,'sec:0000000001','raw-1','2026-02-16T00:00:00.000Z');
/** Both surfaces exactly as their routes build them: the company page and the decision workflow both read xbrl-tags-v5. */
function surfaces(data){
 const f=facts(data),figures=derive(f,asOf,undefined,TAG_LIST_V5);
 const key=keyFigures(null,figures,'0000000001').find(r=>r.metric==='fcf');
 const card=impliedExpectations({symbol:'FIX',asOf,sic:'3570',figures,shareFact:latestShareCount(f,asOf),claimFacts:[],sec:{state:'loaded',parserCurrent:true,tagList:TAG_LIST_V5},
  price:{value:50,at:'2026-02-27T21:00:00.000Z',basis:'last_close',source:'IEX daily close 2026-02-27',rawEventId:'bars-1'},split:{state:'none',coverSession:'2026-01-30',priceSession:'2026-02-27',source:'fixture'}});
 return {key,card,shared:freeCashFlow(figures)};
}

const PPE='PaymentsToAcquirePropertyPlantAndEquipment',PA='PaymentsToAcquireProductiveAssets',OG='PaymentsToExploreAndDevelopOilAndGasProperties';

test('capex-tags-v4: three tags in priority order; v3 and earlier lists unchanged; readers use xbrl-tags-v5',()=>{
 assert.equal(CAPEX_TAG_LIST,'capex-tags-v4');assert.deepEqual([...CAPEX_TAGS],[PPE,PA,OG]);
 assert.deepEqual([...CAPEX_TAG_LISTS['capex-tags-v3']],[PPE],'the v3 list stays as it was, for the labels on stored records');
 assert.deepEqual(TAG_LISTS[TAG_LIST_V5].capex,[PPE,PA,OG]);assert.deepEqual(TAG_LISTS[TAG_LIST_V4].capex,[PPE]);assert.deepEqual(TAG_LISTS[TAG_LIST_V3].capex,[PPE,PA,OG]);assert.deepEqual(TAG_LISTS[TAG_LIST_V1].capex,[PPE]);
});

test('each of the three tags alone: used, both surfaces agree, no note',()=>{
 for(const tag of [PPE,PA,OG]){
  const {key,card,shared}=surfaces(company(tag));
  assert.equal(shared.status,'reported',tag);assert.equal(shared.capexTag,tag);assert.equal(shared.value,130e6-30e6);assert.equal(shared.capexNote,null);assert.deepEqual(shared.otherCapexTags,[]);
  assert.equal(key.value,100e6);assert.equal(card.baseCashFlow.value,100e6);assert.equal(key.calculation.capexTag,tag);assert.equal(card.baseCashFlow.capexTag,tag);
  assert.equal(key.capexTagList,'capex-tags-v4');assert.equal(card.baseCashFlow.capexTagList,'capex-tags-v4');assert.ok(!/also reported/.test(key.changeNote));
 }
});

test('two tags for the same year with different values: the first in priority wins, never a sum, and the other is shown on both surfaces',()=>{
 const {key,card,shared}=surfaces(company({[PPE]:30e6,[PA]:45e6}));
 assert.equal(shared.capexTag,PPE);assert.equal(shared.capex,30e6);assert.equal(shared.value,100e6);assert.notEqual(shared.value,130e6-75e6,'never added together');
 assert.deepEqual(shared.otherCapexTags,[{tag:PA,value:45e6}]);
 assert.equal(shared.capexNote,'Other capital-spending tag also reported: PaymentsToAcquireProductiveAssets ($45,000,000). Sentinel uses PaymentsToAcquirePropertyPlantAndEquipment ($30,000,000), the first tag in capex-tags-v4, and never adds tags together.');
 assert.equal(key.value,card.baseCashFlow.value);assert.match(key.changeNote,/Other capital-spending tag also reported: PaymentsToAcquireProductiveAssets/);assert.equal(card.baseCashFlow.capexNote,shared.capexNote);
 // Second and third in priority: the second wins.
 const b=surfaces(company({[PA]:40e6,[OG]:55e6}));assert.equal(b.shared.capexTag,PA);assert.equal(b.key.value,90e6);assert.equal(b.card.baseCashFlow.value,90e6);assert.match(b.shared.capexNote,/PaymentsToExploreAndDevelopOilAndGasProperties \(\$55,000,000\)/);
 // Same value under two tags: nothing to flag.
 assert.equal(surfaces(company({[PPE]:30e6,[OG]:30e6})).shared.capexNote,null);
});

test('no capex tag at all: both surfaces Unknown with "Capital spending is not tagged", never zero',()=>{
 const {key,card,shared}=surfaces(company(null));
 assert.equal(shared.code,'capex_not_tagged');assert.equal(key.value,null);assert.match(key.reason,/^Capital spending is not tagged.*\(capex-tags-v4\)\. Free cash flow is unknown, not zero\.$/);
 assert.equal(card.status,'unavailable');assert.ok(card.missing.some(m=>/^Base cash flow: Capital spending is not tagged/.test(m)));
 assert.ok(card.history.rows.every(r=>r.value===null&&r.changeNote==='capital spending not tagged'));
 assert.ok(!JSON.stringify(key).includes('"value":0'),'no zero substituted');
});

test('(d) the same company gives the same number on both surfaces, with the same provenance',()=>{
 const {key,card,shared}=surfaces(company('PaymentsToAcquirePropertyPlantAndEquipment'));
 assert.equal(key.value,card.baseCashFlow.value);assert.equal(key.value,shared.value);
 assert.equal(key.periodEnd,card.baseCashFlow.periodEnd);assert.equal(key.calculation.accession,card.baseCashFlow.accession);
 assert.deepEqual([key.calculation.cfo,key.calculation.capex],[card.baseCashFlow.cfo,card.baseCashFlow.capex]);
 assert.equal(key.capexTagList,'capex-tags-v4');assert.equal(card.baseCashFlow.capexTagList,'capex-tags-v4');
 assert.equal(key.fcfVersion,'free-cash-flow-v2');assert.equal(card.baseCashFlow.fcfVersion,'free-cash-flow-v2');assert.equal(key.tagList,'xbrl-tags-v5');
 assert.equal(card.history.rows.at(-1).value,key.value,'the card\'s history row for the same year agrees too');
 // A filing mismatch is unknown on both, not a number on one.
 const data=company('PaymentsToAcquirePropertyPlantAndEquipment');data.facts['us-gaap'].PaymentsToAcquirePropertyPlantAndEquipment.units.USD.at(-1).accn='0000000001-26-000099';
 const m=surfaces(data);assert.equal(m.key.value,null);assert.equal(m.card.status,'unavailable');assert.equal(m.shared.code,'not_matched');
});
