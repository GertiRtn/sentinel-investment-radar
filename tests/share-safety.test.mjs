import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const esbuild=require(require.resolve('esbuild',{paths:[require.resolve('wrangler/package.json')]}));
const ts=require('typescript');
const b=await esbuild.build({stdin:{contents:`export * from './lib/sentinel/financial';export * from './lib/sentinel/implied-expectations';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm'});
const M=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const {parseFacts,derive,latestShareCount,impliedExpectations,splitCheck,otherListings,TAG_LIST_V1,TAG_LIST_V3,TAG_LISTS}=M;
const BANNED=/\b(undervalued|overvalued|cheap|expensive|upside|target|buy|sell|should)\b/i;

// ---- fixture: one company's SEC companyfacts payload -------------------------------------------
const accn=y=>'0000000001-'+String(y+1).slice(2)+'-000001';
const row=(y,val,over={})=>({start:y+'-01-01',end:y+'-12-31',val,accn:accn(y),fy:y,fp:'FY',form:'10-K',filed:(y+1)+'-02-15',...over});
const inst=(y,val)=>({end:y+'-12-31',val,accn:accn(y),fy:y,fp:'FY',form:'10-K',filed:(y+1)+'-02-15'});
function company({nci=null,preferred=null,redeemable=null,shares=[[2025,'2026-01-31',23_047_714,'10-K']]}={}){
 const y=2025,us={NetCashProvidedByUsedInOperatingActivities:{units:{USD:[row(y,130e6)]}},PaymentsToAcquirePropertyPlantAndEquipment:{units:{USD:[row(y,30e6)]}},
  LongTermDebtNoncurrent:{units:{USD:[inst(y,100e6)]}},LongTermDebtCurrent:{units:{USD:[inst(y,20e6)]}},CashAndCashEquivalentsAtCarryingValue:{units:{USD:[inst(y,50e6)]}}};
 if(nci!==null)us.MinorityInterest={units:{USD:[inst(y,nci)]}};if(preferred!==null)us.PreferredStockValue={units:{USD:[inst(y,preferred)]}};if(redeemable!==null)us.RedeemableNoncontrollingInterestEquityCarryingAmount={units:{USD:[inst(y,redeemable)]}};
 const dei={EntityCommonStockSharesOutstanding:{units:{shares:shares.map(([fy,end,val,form,acc])=>({end,val,accn:acc??accn(fy),fy,fp:'FY',form,filed:(fy+1)+'-02-15'}))}}};
 return {cik:1,facts:{'us-gaap':us,...(shares.length?{dei}:{})}};
}
const asOf='2026-03-02T15:00:00.000Z',none={state:'none',coverSession:'2026-01-30',priceSession:'2026-02-27',source:'fixture'};
const build=(data,over={})=>{const facts=parseFacts(data,'sec:0000000001','raw-1','2026-02-16T00:00:00.000Z');return {symbol:'FIX',asOf,sic:'3570',figures:derive(facts,asOf,undefined,TAG_LIST_V3),shareFact:latestShareCount(facts,asOf),
 price:{value:50,at:'2026-02-27T21:00:00.000Z',basis:'last_close',source:'IEX daily close 2026-02-27',rawEventId:'bars-1'},split:none,...over};};

// ---- 1. stock splits ---------------------------------------------------------------------------
const sessions=['2026-01-28','2026-01-29','2026-01-30','2026-02-02','2026-02-26','2026-02-27'];
const series=(splitOn,k)=>{const raw={},adj={};for(const d of sessions){raw[d]=d<splitOn?100*k:100;adj[d]=100;}return {raw,adj};}; // k-for-1 on splitOn: raw falls by k, split-adjusted is flat

test('split check: none, a clean split (incl. reverse), an unclear factor, and not run',()=>{
 const flat=series('2099-01-01',1);assert.deepEqual(splitCheck(flat.raw,flat.adj,'2026-01-31','2026-02-27'),{state:'none',coverSession:'2026-01-30',priceSession:'2026-02-27',source:'Alpaca IEX daily closes, adjustment raw and split'});
 const two=series('2026-02-26',2),s2=splitCheck(two.raw,two.adj,'2026-01-31','2026-02-27');assert.equal(s2.state,'split');assert.equal(s2.factor,2);assert.equal(s2.ratio,'2-for-1');
 const twenty=series('2026-02-26',20);assert.equal(splitCheck(twenty.raw,twenty.adj,'2026-01-31','2026-02-27').ratio,'20-for-1');
 const rev=series('2026-02-26',0.1),sr=splitCheck(rev.raw,rev.adj,'2026-01-31','2026-02-27');assert.equal(sr.state,'split');assert.equal(sr.ratio,'1-for-10');assert.ok(Math.abs(sr.factor-0.1)<1e-12);
 const odd=series('2026-02-26',1.37);assert.equal(splitCheck(odd.raw,odd.adj,'2026-01-31','2026-02-27').state,'unclear');
 const threeTwo=series('2026-02-26',1.5);assert.equal(splitCheck(threeTwo.raw,threeTwo.adj,'2026-01-31','2026-02-27').ratio,'3-for-2');
 const tiny=series('2026-02-26',1.003);assert.equal(splitCheck(tiny.raw,tiny.adj,'2026-01-31','2026-02-27').state,'none','under 0.5%: no split');
 assert.equal(splitCheck(null,flat.adj,'2026-01-31','2026-02-27').state,'not_run');
 assert.match(splitCheck(flat.raw,flat.adj,'2025-06-30','2026-02-27').reason,/no IEX close within 7 days before the cover-page date 2025-06-30/);
 // A split before the cover date is already in the count: no adjustment.
 const early=series('2026-01-29',2);assert.equal(splitCheck(early.raw,early.adj,'2026-01-31','2026-02-27').state,'none');
});

test('split between cover date and price date: the count is adjusted and said; unclear or unchecked holds the result back',()=>{
 // A 2-for-1 split after the cover date: the post-split price $25 with the pre-split count × 2 gives the same market value as $50 × the count.
 const base=impliedExpectations(build(company()));assert.equal(base.status,'computed');assert.equal(base.implied.growthPct,5);
 const adj=impliedExpectations(build(company(),{price:{value:25,at:'2026-02-27T21:00:00.000Z',basis:'last_close',source:'x',rawEventId:'b'},split:{state:'split',factor:2,ratio:'2-for-1',coverSession:'2026-01-30',priceSession:'2026-02-27',source:'fixture'}}));
 assert.equal(adj.status,'computed');assert.equal(adj.marketValue.value,base.marketValue.value);assert.equal(adj.marketValue.splitFactor,2);assert.equal(adj.implied.growthPct,5);
 assert.match(adj.marketValue.method,/× 2 \(split adjustment\)/);assert.equal(adj.caveats.find(c=>c.id==='split_adjusted').text,'Share count adjusted for a 2-for-1 split between 2026-01-30 and 2026-02-27 (23,047,714 × 2 = 46,095,428), from fixture.');
 // Without the check the same inputs would have given half the market value: that is what is stopped.
 const unclear=impliedExpectations(build(company(),{split:{state:'unclear',factor:1.37,coverSession:'2026-01-30',priceSession:'2026-02-27',source:'f'}}));
 assert.equal(unclear.status,'unavailable');assert.match(unclear.missing[0],/^Split check: the price series changed by a factor of 1\.370 between 2026-01-30 and 2026-02-27, which is not a clean split ratio\./);
 const notRun=impliedExpectations(build(company(),{split:undefined}));assert.equal(notRun.status,'unavailable');assert.equal(notRun.implied,undefined);
 assert.match(notRun.missing[0],/^Split check not run: not provided\. Without it a share count from before a split could be mixed with a price from after it\.$/);assert.match(notRun.notRun.text,/stock splits/);
 for(const r of [base,adj,unclear,notRun])assert.ok(!BANNED.test(JSON.stringify(r)));
});

// ---- 2. share classes: GOOGL and BRK.B ---------------------------------------------------------
// Shapes taken from SEC companyfacts fetched 2026-11-16: Alphabet's file has NO dei:EntityCommonStockSharesOutstanding
// (it reports per class, which companyfacts leaves out); Berkshire's latest one is from 2011 (956,153), SIC 6331.
// SEC ticker lists: Alphabet GOOGL, GOOG, GOOGM, GOOGN; Berkshire BRK-B, BRK-A.
test('GOOGL: several listings and no cover-page total → no market value; "Checks not run: share classes"',()=>{
 const r=impliedExpectations(build(company({shares:[]}),{symbol:'GOOGL',sic:'7370',otherTickers:otherListings('GOOGL',['GOOGL','GOOG','GOOGM','GOOGN'])}));
 assert.equal(r.status,'unavailable');assert.equal(r.marketValue,undefined);assert.equal(r.implied,undefined);
 assert.equal(r.missing.find(m=>m.startsWith('Share classes')),'Share classes: this SEC company also lists GOOG, GOOGM, GOOGN. The cover-page count may cover only some classes, and classes can carry different economic weight, so the market value cannot be summed without each class’s price and conversion ratio.');
 assert.match(r.notRun.text,/share classes/);
 // If the file did carry three counts in one filing (A, B, C), they are never summed either.
 const three=impliedExpectations(build(company({shares:[[2025,'2026-01-31',5.8e9,'10-K'],[2025,'2026-01-31',0.86e9,'10-K'],[2025,'2026-01-31',5.4e9,'10-K']]}),{symbol:'GOOGL',otherTickers:['GOOG']}));
 assert.equal(three.status,'unavailable');assert.ok(three.missing.some(m=>/^Multi-class: per-share unavailable\. The filing of 2026-02-15 reports 3 share counts; they are not summed\./.test(m)));
 assert.equal(three.notRun.ids.filter(x=>x==='share_classes').length,1,'listed once');
 assert.ok(!BANNED.test(JSON.stringify([r,three])));
});
test('BRK.B: a 15-year-old single count and two listings → no market value, with every reason; never a headline',()=>{
 const d=company({shares:[[2010,'2011-02-17',943_242,'10-K','0001193125-11-048914']]});
 const r=impliedExpectations(build(d,{symbol:'BRK.B',sic:'6331',otherTickers:otherListings('BRK.B',['BRK-B','BRK-A'])}));
 assert.deepEqual(otherListings('BRK.B',['BRK-B','BRK-A']),['BRK.A'],'SEC BRK-B is the same listing as IEX BRK.B');
 assert.equal(r.status,'unavailable');assert.equal(r.marketValue,undefined);
 assert.ok(r.missing.some(m=>m.startsWith('Financial company (SIC 6331)')));
 assert.ok(r.missing.some(m=>/^Share count too old: the latest cover-page count is from 2011-02-17 \(10-K filed 2011-02-15\), more than 400 days before the price\./.test(m)),JSON.stringify(r.missing));
 assert.ok(r.missing.some(m=>m.startsWith('Share classes: this SEC company also lists BRK.A.')));
 // Even if it were not a financial company, the classes alone hold it back.
 const nonfin=impliedExpectations(build(company(),{symbol:'BRK.B',sic:'3570',otherTickers:['BRK.A']}));assert.equal(nonfin.status,'unavailable');assert.match(nonfin.notRun.text,/share classes/);
 assert.ok(!BANNED.test(JSON.stringify([r,nonfin])));
});

// ---- 4. noncontrolling interests and preferred stock ------------------------------------------
test('NCI and preferred are parsed (xbrl-tags-v3 only; v1 untouched) and checked against market value',()=>{
 assert.deepEqual(TAG_LISTS[TAG_LIST_V1].capex,['PaymentsToAcquirePropertyPlantAndEquipment'],'capex v1 unchanged');assert.equal(TAG_LISTS[TAG_LIST_V1].nci,undefined);
 const facts=parseFacts(company({nci:6e9,preferred:0}),'e','r','x');
 assert.equal(derive(facts,asOf).find(f=>f.metric==='nci'),undefined,'v1 readers never see it');
 const v3=derive(facts,asOf,undefined,TAG_LIST_V3).find(f=>f.metric==='nci'&&f.period_end==='2025-12-31');assert.equal(v3.value,6e9);assert.equal(v3.tagList,'xbrl-tags-v3');assert.equal(v3.method,'reported:MinorityInterest');
 // FANG-type: market value $1.15B here (23,047,714 × $50), NCI $600M = 52% → held back, in plain English.
 const fang=impliedExpectations(build(company({nci:600e6})));
 assert.equal(fang.status,'unavailable');assert.equal(fang.implied,undefined);
 assert.equal(fang.missing[0],'Held back: noncontrolling interests (minority owners in subsidiaries) are about 52% of the market value (book value $600.0M at 2025-12-31). The cash flow includes the minority owners’ share, so what the price assumes would not describe these shares. Until they are valued separately, no figure is shown.');
 assert.equal(fang.claims.nci.state,'too_large');
 // Just over and just under 10%.
 const mv=50*23_047_714;assert.equal(impliedExpectations(build(company({nci:Math.round(mv*0.101)}))).status,'unavailable');
 const small=impliedExpectations(build(company({nci:Math.round(mv*0.099),preferred:0})));assert.equal(small.status,'computed');
 assert.match(small.caveats.find(c=>c.id==='nci_checked').text,/^Noncontrolling interests: book value \$114\.1M at 2025-12-31, 9\.9% of the market value \(limit 10%\); included in the cash flow, not deducted\.$/);
 assert.equal(small.caveats.find(c=>c.id==='preferred_checked').text,'Preferred stock: none reported (0 at 2025-12-31).');assert.equal(small.notRun.text,null,'both checked: nothing listed as not run');
 // EMCOR-type: NCI $1.0M, preferred 0 → computed.
 const eme=impliedExpectations(build(company({nci:1_037_000,preferred:0})));assert.equal(eme.status,'computed');assert.equal(eme.claims.nci.state,'ok');
 // Redeemable NCI is added; preferred above 10% is held back.
 assert.equal(impliedExpectations(build(company({nci:60e6,redeemable:60e6}))).claims.nci.value,120e6);
 const pref=impliedExpectations(build(company({preferred:200e6})));assert.equal(pref.status,'unavailable');assert.match(pref.missing[0],/^Held back: preferred stock is about 17% of the market value \(book value \$200\.0M at 2025-12-31\)\. Preferred holders are paid before common shareholders/);
 // Untagged stays "not checked".
 const untagged=impliedExpectations(build(company()));assert.equal(untagged.claims.nci.state,'not_checked');assert.match(untagged.caveats.find(c=>c.id==='nci').text,/^Noncontrolling interests: not checked\. No supported tag is reported for 2025-12-31/);
 for(const r of [fang,small,eme,pref,untagged])assert.ok(!BANNED.test(JSON.stringify(r)));
});

// ---- 3. rendered text in the decision-workflow components --------------------------------------
// Every string literal, template piece and JSX text node in the components that render this workflow.
test('no banned word in any text the decision-workflow components can render',()=>{
 const files=['components/sentinel/implied-expectations.tsx','components/sentinel/decision-compare.tsx','components/sentinel/discovery-funnel.tsx'];
 const found=[];
 for(const f of files){
  const src=ts.createSourceFile(f,readFileSync(f,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const visit=n=>{const k=n.kind;
   if(k===ts.SyntaxKind.JsxText||k===ts.SyntaxKind.StringLiteral||k===ts.SyntaxKind.NoSubstitutionTemplateLiteral||k===ts.SyntaxKind.TemplateHead||k===ts.SyntaxKind.TemplateMiddle||k===ts.SyntaxKind.TemplateTail){
    const text=n.text??n.getText();if(BANNED.test(text))found.push(`${f}:${src.getLineAndCharacterOfPosition(n.getStart()).line+1}: ${text.trim().slice(0,80)}`);}
   ts.forEachChild(n,visit);};
  visit(src);
 }
 assert.deepEqual(found,[]);
});
