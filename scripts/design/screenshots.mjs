// Design-review screenshots (2026-11-17). Offline only. Loads the REAL built company page from a local server and
// answers only its API calls with fixtures made by Sentinel's real pure functions (scripts/design/fixtures.mjs).
// Usage: node scripts/design/screenshots.mjs <baseUrl> <outDir> [state ...]
import {mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {companyPage,IMPLIED_STATES,compare,SYMBOL} from './fixtures.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require('playwright');
const [base='http://127.0.0.1:8787',out='design-screens',...only]=process.argv.slice(2);
mkdirSync(out,{recursive:true});
const states=only.length?only:Object.keys(IMPLIED_STATES);
const json=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
const browser=await chromium.launch();
for(const [w,h,tag] of [[1440,900,'1440'],[390,844,'390']]){
 const ctx=await browser.newContext({viewport:{width:w,height:h},deviceScaleFactor:1});
 for(const state of states){
  const page=await ctx.newPage();
  await page.route('**/api/**',route=>{
   const u=new URL(route.request().url()),p=u.pathname;
   if(p==='/api/company-page')return json(route,companyPage());
   if(p==='/api/implied-expectations')return json(route,IMPLIED_STATES[state]());
   if(p==='/api/decision-compare')return json(route,compare());
   if(p==='/api/decision-snapshot')return json(route,{symbol:SYMBOL,snapshots:[],checkpoints:{quarterly_revenue_yoy:'Next filing: reported quarterly revenue at or above the same quarter a year earlier.'},defaultBudgetCents:100000});
   if(p==='/api/investment-case')return json(route,{investmentCase:null});
   return json(route,{error:'not part of this fixture'},404);
  });
  await page.goto(`${base}/company?symbol=${SYMBOL}`,{waitUntil:'networkidle'});
  await page.waitForSelector('h1');
  // Open the comparison so the "What acting would change" table is visible.
  const cmp=page.getByRole('button',{name:'Compare the three options'});if(await cmp.count())await cmp.first().click().catch(()=>{});
  await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(400);
  await page.screenshot({path:`${out}/${state}-${tag}.png`,fullPage:true});
  const card=page.locator('section[aria-label="What the price assumes"]');
  if(await card.count())await card.first().screenshot({path:`${out}/${state}-${tag}-card.png`});
  await page.close();
 }
 await ctx.close();
}
await browser.close();
console.log('wrote',states.length*2,'pages to',out);
