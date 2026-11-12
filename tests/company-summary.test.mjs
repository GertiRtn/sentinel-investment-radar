import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const esbuild=require(require.resolve('esbuild',{paths:[require.resolve('wrangler/package.json')]}));
const bundle=await esbuild.build({entryPoints:['lib/sentinel/company-summary.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {companySummary}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
function f(metric,year,value,tag='Revenues'){const period_end=`${year}-12-31`;return {metric,value,unit:'USD',period_end,confidence:'reported',inputs:[{period_start:`${year}-01-01`,period_end,source_tag:tag,unit:'USD'}]};}
test('summary compares matching annual reported figures and preserves sources',()=>{const x=companySummary([f('revenue',2025,110),f('revenue',2024,100),f('net_income',2025,20,'NetIncomeLoss')]);assert.equal(x.periodEnd,'2025-12-31');assert.equal(x.rows[0].changePercent,10);assert.equal(x.rows[0].previous.value,100);assert.equal(x.rows[1].current.value,20);assert.equal(x.rows[2].current,null);});
test('summary suppresses misleading comparisons and does not substitute older current values',()=>{let x=companySummary([f('revenue',2025,110),f('revenue',2024,0),f('net_income',2024,20,'NetIncomeLoss')]);assert.equal(x.rows[0].changePercent,null);assert.equal(x.rows[1].current,null);x=companySummary([f('revenue',2025,100),f('revenue',2024,80,'SalesRevenueNet')]);assert.equal(x.rows[0].previous,null);assert.equal(companySummary([]).periodEnd,null);});
