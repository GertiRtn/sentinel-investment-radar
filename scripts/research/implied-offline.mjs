// Offline check of implied-expectations-v1 on a real SEC companyfacts file. Research only: never part of the Worker.
// Usage: node scripts/research/implied-offline.mjs <companyfacts.json> <submissions.json> <SYMBOL> [price priceDateISO]
// A price given on the command line is typed by the operator, not a recorded quote: the output says so.
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const esbuild=require(require.resolve('esbuild',{paths:[require.resolve('wrangler/package.json')]}));
const b=await esbuild.build({stdin:{contents:`export * from './lib/sentinel/financial';export * from './lib/sentinel/implied-expectations';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm'});
const {parseFacts,derive,latestShareCount,impliedExpectations}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const [factsPath,subPath,symbol,price,priceAt]=process.argv.slice(2);
const data=JSON.parse(readFileSync(factsPath,'utf8')),sub=JSON.parse(readFileSync(subPath,'utf8')),asOf=process.env.AS_OF||new Date().toISOString();
// EXTRA_CAPEX_TAG: research only. Reads another us-gaap tag as capital expenditure to see what a wider tag list would give.
// The app's TAGS list is NOT changed by this; widening it changes existing figures and needs its own versioned change.
const extra=process.env.EXTRA_CAPEX_TAG;if(extra&&data.facts['us-gaap'][extra]&&!data.facts['us-gaap'].PaymentsToAcquirePropertyPlantAndEquipment)data.facts['us-gaap'].PaymentsToAcquirePropertyPlantAndEquipment=data.facts['us-gaap'][extra];
const facts=parseFacts(data,'sec:offline','offline-file',asOf);
const r=impliedExpectations({symbol,asOf,sic:String(sub.sic||'')||null,figures:derive(facts,asOf),shareFact:latestShareCount(facts,asOf),
 price:price?{value:Number(price),at:priceAt,basis:'operator-typed',source:'typed on the command line (not a recorded quote)',rawEventId:null}:null});
const shareFacts=facts.filter(f=>f.metric.startsWith('shares_outstanding'));
console.log(JSON.stringify({offlineCapexTag:extra||null,company:sub.name,sic:sub.sic,asOf,shareFacts:{single:shareFacts.filter(f=>f.metric==='shares_outstanding').length,multiClassMarkers:shareFacts.filter(f=>f.metric!=='shares_outstanding').length},
 status:r.status,missing:r.missing,marketValue:r.marketValue,baseCashFlow:r.baseCashFlow,implied:r.implied,sensitivity:r.sensitivity?.cells.map(c=>[c.discount,c.terminalGrowth,c.growth===null?'outside range':+(c.growth*100).toFixed(2)]),leverage:r.leverage,netDebt:r.netDebtContext,history:r.history.rows.map(h=>[h.periodEnd,h.value,h.changePct===null?h.changeNote:+h.changePct.toFixed(1)]),caveats:r.caveats.map(c=>c.text)},null,1));
