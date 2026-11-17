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

test('split since the share count: unavailable, never adjusted; a possible split or an unchecked one is unavailable too',()=>{
 const base=impliedExpectations(build(company()));assert.equal(base.status,'computed');assert.equal(base.implied.growthPct,5);assert.equal(base.split.state,'none');
 // A 2-for-1 split after the cover date: the post-split price $25 with the pre-split count would halve the market value. Not computed, not adjusted.
 const split=impliedExpectations(build(company(),{price:{value:25,at:'2026-02-27T21:00:00.000Z',basis:'last_close',source:'x',rawEventId:'b'},split:{state:'split',factor:2,ratio:'2-for-1',coverSession:'2026-01-30',priceSession:'2026-02-27',source:'fixture'}}));
 assert.equal(split.status,'unavailable');assert.equal(split.marketValue,undefined);assert.equal(split.implied,undefined);
 assert.equal(split.missing[0],'Unavailable: split since share count. A 2-for-1 split took effect between the cover-page date (2026-01-30) and the price (2026-02-27), so the share count and the price are on different bases. No figure is shown until a share count filed after the split is stored.');
 assert.ok(!split.caveats.some(c=>c.id==='split_adjusted'),'no adjustment is made');
 const reverse=impliedExpectations(build(company(),{split:{state:'split',factor:0.1,ratio:'1-for-10',coverSession:'2026-01-30',priceSession:'2026-02-27',source:'f'}}));assert.equal(reverse.status,'unavailable');assert.match(reverse.missing[0],/^Unavailable: split since share count\. A 1-for-10 split/);
 const unclear=impliedExpectations(build(company(),{split:{state:'unclear',factor:1.37,coverSession:'2026-01-30',priceSession:'2026-02-27',source:'f'}}));
 assert.equal(unclear.status,'unavailable');assert.match(unclear.missing[0],/^Unavailable: possible split since share count\. The price series changed by a factor of 1\.370 between 2026-01-30 and 2026-02-27, which is not a clean split ratio\./);
 const notRun=impliedExpectations(build(company(),{split:undefined}));assert.equal(notRun.status,'unavailable');assert.equal(notRun.implied,undefined);
 assert.equal(notRun.missing[0],'Unavailable: split check not run (not provided). Without it a share count from before a split could be mixed with a price from after it.');assert.match(notRun.notRun.text,/stock splits/);
 for(const r of [base,split,reverse,unclear,notRun])assert.ok(!BANNED.test(JSON.stringify(r)));
});

// ---- 2. amended filings (10-K/A) -------------------------------------------------------------
// Real shapes from SEC companyfacts fetched 2026-11-17: Tesla's 10-K/A of 2022-05-02 repeats the 10-K's cover date and
// count (2022-01-31, 1,033,507,611); Plug Power's 10-K/A of 2022-03-14 carries a new date and count (2022-03-09,
// 578,009,043) after the 10-K's (2022-02-25, 577,861,791). The third case is the same shape with a corrected count on
// the original date, which the old rule (any two values on one date, across filings) read as two share classes.
const fact=(cik,end,val,form,accn,filed)=>({end,val,accn,fy:2021,fp:'FY',form,filed});
const deiOnly=rows=>({cik:1,facts:{dei:{EntityCommonStockSharesOutstanding:{units:{shares:rows}}}}});
test('10-K/A: an amended filing never turns a single-class company into multi-class; the most recent filing wins',()=>{
 const tesla=parseFacts(deiOnly([fact(1318605,'2022-01-31',1033507611,'10-K','0001564590-22-004491','2022-02-07'),fact(1318605,'2022-01-31',1033507611,'10-K/A','0001564590-22-016871','2022-05-02')]),'sec:0001318605','r','x');
 assert.equal(tesla.filter(f=>f.metric==='shares_outstanding_multiclass').length,0);assert.equal(latestShareCount(tesla,'2022-06-01T00:00:00Z').accession,'0001564590-22-016871');assert.equal(latestShareCount(tesla,'2022-06-01T00:00:00Z').value,1033507611);
 const plug=parseFacts(deiOnly([fact(1093691,'2022-02-25',577861791,'10-K','0001558370-22-002325','2022-03-01'),fact(1093691,'2022-03-09',578009043,'10-K/A','0001558370-22-003577','2022-03-14')]),'sec:0001093691','r','x');
 assert.equal(plug.filter(f=>f.metric==='shares_outstanding_multiclass').length,0);assert.equal(latestShareCount(plug,'2022-04-01T00:00:00Z').value,578009043);assert.equal(latestShareCount(plug,'2022-03-05T00:00:00Z').value,577861791,'before the amendment was filed, only the original was known');
 const corrected=parseFacts(deiOnly([fact(1093691,'2022-02-25',577861791,'10-K','0001558370-22-002325','2022-03-01'),fact(1093691,'2022-02-25',577900000,'10-K/A','0001558370-22-003577','2022-03-14')]),'sec:0001093691','r','x');
 assert.equal(corrected.filter(f=>f.metric==='shares_outstanding_multiclass').length,0,'a correction in an amendment is not a second class');
 assert.equal(latestShareCount(corrected,'2022-04-01T00:00:00Z').value,577900000);assert.equal(latestShareCount(corrected,'2022-04-01T00:00:00Z').form,'10-K/A');
 // An amendment that repeats the original date and adds its own date in the same filing: two facts, no class marker.
 const both=parseFacts(deiOnly([fact(1,'2022-02-25',577861791,'10-K','0001558370-22-002325','2022-03-01'),fact(1,'2022-02-25',577861791,'10-K/A','0001558370-22-003577','2022-03-14'),fact(1,'2022-03-09',578009043,'10-K/A','0001558370-22-003577','2022-03-14')]),'e','r','x');
 assert.equal(both.filter(f=>f.metric==='shares_outstanding_multiclass').length,0);assert.equal(latestShareCount(both,'2022-04-01T00:00:00Z').value,578009043);
 // Two values on one date inside one filing is still several classes.
 const classes=parseFacts(deiOnly([fact(1,'2022-01-31',5.8e9,'10-K','0000000001-22-000001','2022-02-02'),fact(1,'2022-01-31',0.86e9,'10-K','0000000001-22-000001','2022-02-02')]),'e','r','x');
 assert.equal(classes.filter(f=>f.metric==='shares_outstanding_multiclass').length,1);
 // The implied-expectations result for the corrected single-class case is computed, not "share classes".
 const d=company({shares:[[2025,'2026-01-31',23_047_714,'10-K','0000000001-26-000001'],[2025,'2026-01-31',23_047_714,'10-K/A','0000000001-26-000009']]});
 const r=impliedExpectations(build(d));assert.equal(r.status,'computed');assert.equal(r.marketValue.shares.form,'10-K/A');
});

// ---- 3. share classes: GOOGL and BRK.B ---------------------------------------------------------
// Shapes taken from SEC companyfacts fetched 2026-11-16: Alphabet's file has NO dei:EntityCommonStockSharesOutstanding
// (it reports per class, which companyfacts leaves out); Berkshire's latest one is from 2011, SIC 6331.
// SEC ticker lists: Alphabet GOOGL, GOOG, GOOGM, GOOGN; Berkshire BRK-B, BRK-A.
// Classes are summed only if every class count is present. companyfacts never labels a count with its class, so no
// stored source can show that every class is present: these cases are always "Unavailable: share classes".
test('GOOGL: several listings and no count for each class → "Unavailable: share classes"',()=>{
 const r=impliedExpectations(build(company({shares:[]}),{symbol:'GOOGL',sic:'7370',otherTickers:otherListings('GOOGL',['GOOGL','GOOG','GOOGM','GOOGN'])}));
 assert.equal(r.status,'unavailable');assert.equal(r.marketValue,undefined);assert.equal(r.implied,undefined);
 assert.equal(r.missing.find(m=>m.startsWith('Unavailable: share classes')),'Unavailable: share classes. This SEC company also lists GOOG, GOOGM, GOOGN. Classes are summed only when every class count is present, and the stored filings do not give a count for each class, so the market value cannot be worked out.');
 assert.match(r.notRun.text,/share classes/);
 // Three counts in one filing (A, B, C) without class labels: still not summed.
 const three=impliedExpectations(build(company({shares:[[2025,'2026-01-31',5.8e9,'10-K'],[2025,'2026-01-31',0.86e9,'10-K'],[2025,'2026-01-31',5.4e9,'10-K']]}),{symbol:'GOOGL',otherTickers:['GOOG']}));
 assert.equal(three.status,'unavailable');assert.ok(three.missing.includes('Unavailable: share classes. The filing of 2026-02-15 reports 3 share counts without saying which class each one is, so it cannot be confirmed that every class is present, and they are not summed.'));
 assert.equal(three.notRun.ids.filter(x=>x==='share_classes').length,1,'listed once');
 assert.ok(!BANNED.test(JSON.stringify([r,three])));
});
test('BRK.B: a 2011 count, two listings and an insurer → unavailable with every reason; never a headline',()=>{
 const d=company({shares:[[2010,'2011-02-17',943_242,'10-K','0001193125-11-048914']]});
 const r=impliedExpectations(build(d,{symbol:'BRK.B',sic:'6331',otherTickers:otherListings('BRK.B',['BRK-B','BRK-A'])}));
 assert.deepEqual(otherListings('BRK.B',['BRK-B','BRK-A']),['BRK.A'],'SEC BRK-B is the same listing as IEX BRK.B');
 assert.equal(r.status,'unavailable');assert.equal(r.marketValue,undefined);
 assert.ok(r.missing.some(m=>m.startsWith('Financial company (SIC 6331)')));
 assert.ok(r.missing.some(m=>/^Share count too old: the latest cover-page count is from 2011-02-17 \(10-K filed 2011-02-15\), more than 400 days before the price\./.test(m)),JSON.stringify(r.missing));
 assert.ok(r.missing.some(m=>m.startsWith('Unavailable: share classes. This SEC company also lists BRK.A.')));
 const nonfin=impliedExpectations(build(company(),{symbol:'BRK.B',sic:'3570',otherTickers:['BRK.A']}));assert.equal(nonfin.status,'unavailable');assert.match(nonfin.notRun.text,/share classes/);
 assert.ok(!BANNED.test(JSON.stringify([r,nonfin])));
});

// ---- 4. noncontrolling interests and preferred stock ------------------------------------------
test('NCI and preferred: above 10% unavailable; tag present but unreadable unavailable; not reported shown; not parsed yet listed as not run',()=>{
 assert.deepEqual(TAG_LISTS[TAG_LIST_V1].capex,['PaymentsToAcquirePropertyPlantAndEquipment'],'capex v1 unchanged');assert.equal(TAG_LISTS[TAG_LIST_V1].nci,undefined);
 const facts=parseFacts(company({nci:6e9,preferred:0}),'e','r','x');
 assert.equal(derive(facts,asOf).find(f=>f.metric==='nci'),undefined,'v1 readers never see it');
 const v3=derive(facts,asOf,undefined,TAG_LIST_V3).find(f=>f.metric==='nci'&&f.period_end==='2025-12-31');assert.equal(v3.value,6e9);assert.equal(v3.tagList,'xbrl-tags-v3');assert.equal(v3.method,'reported:MinorityInterest');
 // FANG-type: market value $1.15B here (23,047,714 × $50), NCI $600M = 52% → unavailable, in plain English.
 const fang=impliedExpectations(build(company({nci:600e6})));
 assert.equal(fang.status,'unavailable');assert.equal(fang.implied,undefined);
 assert.equal(fang.missing[0],'Unavailable: noncontrolling interests (minority owners in subsidiaries) are about 52% of the market value (book value $600.0M at 2025-12-31). The cash flow includes the minority owners’ share, so what the price assumes would not describe these shares. Until they are valued separately, no figure is shown.');
 assert.equal(fang.claims.nci.state,'too_large');
 const mv=50*23_047_714;assert.equal(impliedExpectations(build(company({nci:Math.round(mv*0.101)}))).status,'unavailable');
 const small=impliedExpectations(build(company({nci:Math.round(mv*0.099),preferred:0})));assert.equal(small.status,'computed');
 assert.match(small.caveats.find(c=>c.id==='nci_checked').text,/^Noncontrolling interests: book value \$114\.1M at 2025-12-31, 9\.9% of the market value \(limit 10%\); included in the cash flow, not deducted\.$/);
 assert.equal(small.caveats.find(c=>c.id==='preferred_checked').text,'Preferred stock: none reported (0 at 2025-12-31).');assert.equal(small.notRun.text,null);
 assert.equal(impliedExpectations(build(company({nci:1_037_000,preferred:0}))).claims.nci.state,'ok','EMCOR-type');
 assert.equal(impliedExpectations(build(company({nci:60e6,redeemable:60e6}))).claims.nci.value,120e6,'redeemable NCI is added');
 const pref=impliedExpectations(build(company({preferred:200e6})));assert.equal(pref.status,'unavailable');assert.match(pref.missing[0],/^Unavailable: preferred stock is about 17% of the market value \(book value \$200\.0M at 2025-12-31\)\. Preferred holders are paid before common shareholders/);
 // Not reported: shown as such, not a check that was not run.
 const none=impliedExpectations(build(company()));assert.equal(none.status,'computed');assert.equal(none.claims.nci.state,'not_reported');assert.equal(none.caveats.find(c=>c.id==='nci_checked').text,'Noncontrolling interests: not reported in the company’s filings for 2025-12-31.');assert.equal(none.notRun.text,null);
 // Not parsed yet (data stored before parser v3): "Checks not run".
 const old=impliedExpectations({...build(company()),sec:{state:'loaded',parserCurrent:false,tagList:'xbrl-tags-v3'}});assert.equal(old.claims.nci.state,'not_parsed');assert.match(old.notRun.text,/noncontrolling interests, preferred stock/);assert.match(old.caveats.find(c=>c.id==='nci').text,/^Noncontrolling interests: not checked yet\. This company.s SEC data was stored before Sentinel read this item/);
 // Tag present but in a unit that is not US dollars: unavailable, with the reason.
 const bad=company();bad.facts['us-gaap'].MinorityInterest={units:{EUR:[inst(2025,5e6)]}};const badFacts=parseFacts(bad,'sec:0000000001','raw-1','2026-02-16T00:00:00.000Z');
 const marker=badFacts.find(f=>f.metric==='claim_unreadable');assert.equal(marker.source_tag,'MinorityInterest');assert.equal(marker.unit,'EUR');assert.equal(marker.known_from,'2026-02-15T23:59:59.999Z');
 const unread=impliedExpectations({...build(bad),claimFacts:badFacts.filter(f=>['nci','nci_redeemable','preferred','claim_unreadable'].includes(f.metric))});
 assert.equal(unread.status,'unavailable');assert.equal(unread.missing[0],'Unavailable: noncontrolling interests are reported (tag MinorityInterest) but could not be read: the values are in unit "EUR", not US dollars.');assert.equal(unread.claims.nci.state,'unreadable');
 // Tag present for other dates but not for the cash-flow year-end: unavailable.
 const other=company();other.facts['us-gaap'].MinorityInterest={units:{USD:[{end:'2025-09-30',val:900e6,accn:'0000000001-25-000007',fy:2025,fp:'Q3',form:'10-Q',filed:'2025-11-01'}]}};const otherFacts=parseFacts(other,'sec:0000000001','raw-1','2026-02-16T00:00:00.000Z');
 const gap=impliedExpectations({...build(other),claimFacts:otherFacts.filter(f=>['nci','nci_redeemable','preferred','claim_unreadable'].includes(f.metric))});
 assert.equal(gap.status,'unavailable');assert.equal(gap.missing[0],'Unavailable: noncontrolling interests are reported for 2025-09-30 but not for the cash-flow year-end 2025-12-31, so they cannot be compared with this cash flow.');
 for(const r of [fang,small,pref,none,old,unread,gap])assert.ok(!BANNED.test(JSON.stringify(r)));
});

// ---- 3. rendered text in the decision-workflow components --------------------------------------
// Every string literal, template piece and JSX text node in the components that render this workflow.
// Every string literal, template piece and JSX text node in lib/, components/ and app/ (negated uses included).
// Allowed, each for a stated reason: the old manual ledger's stored side values 'buy' and 'sell' (append-only data, never
// shown as text: the page shows "Practice purchase" / "Practice sale"); instructions sent to a model telling it NOT to
// give such opinions (never rendered); and a developer error inside the UI library.
const ALLOWED=[
 {file:/./,text:/^(buy|sell)$/},
 {file:/^lib\/sentinel\/(research-team|shadow-reader)\.ts$/,text:/^Never /},
 {file:/^components\/ui\/form\.tsx$/,text:/should be used within/},
];
test('no banned word in any text the app can render (every source file, negated uses included)',()=>{
 const {readdirSync,statSync}=require('node:fs'),{join}=require('node:path');
 const files=[];const walkDir=d=>{for(const f of readdirSync(d)){const p=join(d,f);if(statSync(p).isDirectory())walkDir(p);else if(/\.(ts|tsx)$/.test(f))files.push(p);}};
 for(const d of ['lib','components','app'])walkDir(d);
 assert.ok(files.length>80,'scanned '+files.length+' files');
 const found=[];
 for(const f of files){
  const src=ts.createSourceFile(f,readFileSync(f,'utf8'),ts.ScriptTarget.Latest,true,f.endsWith('x')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  const visit=n=>{const k=n.kind;
   if(k===ts.SyntaxKind.JsxText||k===ts.SyntaxKind.StringLiteral||k===ts.SyntaxKind.NoSubstitutionTemplateLiteral||k===ts.SyntaxKind.TemplateHead||k===ts.SyntaxKind.TemplateMiddle||k===ts.SyntaxKind.TemplateTail){
    const text=(n.text??n.getText()).trim();
    if(BANNED.test(text)&&!ALLOWED.some(a=>a.file.test(f)&&a.text.test(text)))found.push(`${f}:${src.getLineAndCharacterOfPosition(n.getStart()).line+1}: ${text.slice(0,100)}`);}
   ts.forEachChild(n,visit);};
  visit(src);
 }
 assert.deepEqual(found,[]);
});
