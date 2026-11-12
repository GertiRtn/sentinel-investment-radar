import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const esbuild=require(require.resolve('esbuild',{paths:[require.resolve('wrangler/package.json')]}));
const b=await esbuild.build({entryPoints:['lib/sentinel/security-identity.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const S=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const asset=(name,o={})=>({symbol:'XYZ',class:'us_equity',status:'active',name,exchange:'NYSE',...o});

test('v2 accepts plain US common shares named without "Common Stock" (the live-site failure)',()=>{
 for(const name of ['GE Vernova Inc.','ConocoPhillips','EnerSys','Intercontinental Exchange, Inc.','HubSpot, Inc. Common Stock','Apple Inc. Common Stock']){
  const r=S.classifySecurity(asset(name),'XYZ',['XYZ']);assert.equal(r.status,'candidate_common',name);assert.equal(r.version,'security-identity-v2');
 }
});

test('v2 still fails closed for other instruments, share classes, inactive or ambiguous listings',()=>{
 for(const name of ['Example American Depositary Shares','Aurora Mobile Ltd ADS','KNOT Offshore Partners LP Common Units representing Limited Partner Interests','Example Corp Warrants','Example 6% Preferred','SPDR S&P 500 ETF Trust','Alphabet Inc. Class A Common Stock','Example Rights','Example Notes due 2030'])
  assert.equal(S.classifySecurity(asset(name),'XYZ',['XYZ']).status,'unverified',name);
 assert.equal(S.classifySecurity(asset('Example Inc.',{status:'inactive'}),'XYZ',['XYZ']).status,'unverified');
 assert.equal(S.classifySecurity(asset('Example Inc.',{class:'crypto'}),'XYZ',['XYZ']).status,'unverified');
 assert.equal(S.classifySecurity(asset('Example Inc.'),'XYZ',['XYZ','XYZA']).status,'unverified','two SEC tickers stay ambiguous');
 assert.equal(S.classifySecurity(asset('Example Inc.'),'ABC',['ABC']).status,'unverified','provider symbol must match exactly');
 assert.equal(S.classifySecurity(asset(''),'XYZ',['XYZ']).status,'unverified');
});
