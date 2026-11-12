import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const esbuild=require(require.resolve('esbuild',{paths:[require.resolve('wrangler/package.json')]}));

async function load(entry){
 const stubs={
  'cloudflare:workers':'export const env=new Proxy({},{get:(_,k)=>(globalThis.testEnv||{})[k]});',
  store:'export function database(){return {prepare:sql=>({bind:(...a)=>({run:async()=>{globalThis.inserts.push({sql,a});return {meta:{changes:1}}}})})}}',
 };
 const b=await esbuild.build({entryPoints:[entry],bundle:true,write:false,platform:'node',format:'esm',alias:{'@':process.cwd()},plugins:[{name:'stubs',setup(build){
  build.onResolve({filter:/^cloudflare:workers$|db\/store$/},a=>({path:a.path==='cloudflare:workers'?a.path:'store',namespace:'stub'}));
  build.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path],loader:'js'}));
 }}]});
 return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64')+'#'+Math.random());
}
const R=await load('lib/sentinel/shadow-reader.ts');
const KEY='nvapi-TEST-SECRET-9f3a';
const input={headline:'HubSpot Reaffirms Q4 And FY26 Guidance',summary:'HubSpot said it expects fourth-quarter revenue in line with prior guidance.',company:'HubSpot, Inc.',ticker:'HUBS'};
const on={enabled:'1',key:KEY};
const answer=(obj,extra={})=>({choices:[{message:{content:typeof obj==='string'?obj:JSON.stringify(obj),...extra}}]});
const good={company_role:'subject',event_type:'guidance',claims:[{text:'HubSpot reaffirmed its guidance',quote:'HubSpot Reaffirms Q4 And FY26 Guidance'}]};
function fake(body,status=200){const calls=[];const f=async(url,init)=>{calls.push({url,init});return new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'content-type':'application/json'}})};f.calls=calls;return f;}

test('a valid answer is stored as ok with the full raw response',async()=>{
 const f=fake(answer(good));const r=await R.readShadow(input,on,f);
 assert.equal(r.status,'ok');assert.equal(r.parsed.company_role,'subject');assert.equal(r.parsed.claims.length,1);assert.equal(r.validation.droppedClaims,0);
 assert.equal(r.rawResponse,JSON.stringify(good));assert.equal(r.model,R.DEFAULT_SHADOW_MODEL);assert.equal(r.httpStatus,200);
 const sent=JSON.parse(f.calls[0].init.body);
 assert.equal(f.calls[0].url,R.SHADOW_ENDPOINT);assert.equal(sent.temperature,0);assert.equal(sent.max_tokens,1500);assert.equal(sent.chat_template_kwargs.enable_thinking,false);
 assert.deepEqual(JSON.parse(sent.messages[1].content),input,'only the public headline, summary, company and ticker are sent');
});

test('fabricated quotes and numbers outside quotes are dropped and counted',async()=>{
 const claims=[good.claims[0],{text:'Revenue will double',quote:'HubSpot expects revenue to double'},{text:'Guidance implies 20 percent growth',quote:'HubSpot Reaffirms Q4 And FY26 Guidance'}];
 const r=await R.readShadow(input,on,fake(answer({...good,claims})));
 assert.equal(r.status,'ok');assert.equal(r.parsed.claims.length,1);assert.equal(r.validation.droppedClaims,2);
 assert.deepEqual(r.validation.droppedReasons,['quote not found in the sent text','number outside a quote']);
});

test('thinking blocks and code fences are removed before parsing; the raw text is kept',async()=>{
 const raw='<think>The headline says reaffirms.</think>\n```json\n'+JSON.stringify(good)+'\n```';
 const r=await R.readShadow(input,on,fake(answer(raw,{reasoning_content:'separate reasoning'})));
 assert.equal(r.status,'ok');assert.equal(r.rawResponse,raw);assert.equal(r.rawReasoning,'separate reasoning');
});

test('invalid answers are marked invalid, never guessed',async()=>{
 for(const [label,content] of [['not JSON','HubSpot is the subject.'],['thinking without an answer','<think>still thinking about it'],['thinking then prose','<think>x</think> The company is the subject.'],['extra key',JSON.stringify({...good,score:0.9})],['unknown role',JSON.stringify({...good,company_role:'acquirer'})],['six claims',JSON.stringify({...good,claims:Array(6).fill(good.claims[0])})]]){
  const r=await R.readShadow(input,on,fake(answer(content)));assert.equal(r.status,'invalid',label);assert.equal(r.parsed,null,label);
 }
 assert.equal((await R.readShadow(input,on,fake({choices:[]}))).status,'invalid','no message');
});

test('refusals, missing model, timeouts and network errors are unavailable',async()=>{
 for(const code of [429,404,403,500]){const r=await R.readShadow(input,on,fake({error:'x'},code));assert.equal(r.status,'unavailable');assert.equal(r.httpStatus,code);}
 assert.equal((await R.readShadow(input,on,async()=>{throw new TypeError('network down')})).status,'unavailable');
 const hang=(url,init)=>new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))));
 const realSetTimeout=globalThis.setTimeout;globalThis.setTimeout=(fn)=>realSetTimeout(fn,5); // compress the 8 s timeout
 try{const r=await R.readShadow(input,on,hang);assert.equal(r.status,'unavailable');assert.match(r.validation.error,/No response within 8000 ms/);}
 finally{globalThis.setTimeout=realSetTimeout;}
});

test('off unless the flag is exactly "1"; no key means no call',async()=>{
 for(const enabled of [undefined,'','0','true','yes',' 1']){const f=fake(answer(good));const r=await R.readShadow(input,{enabled,key:KEY},f);assert.equal(r.status,'disabled');assert.equal(f.calls.length,0,String(enabled));}
 const f=fake(answer(good));assert.equal((await R.readShadow(input,{enabled:'1'},f)).status,'unavailable');assert.equal(f.calls.length,0);
 assert.equal((await R.readShadow(input,{...on,model:'nvidia/other-model'},fake(answer(good)))).model,'nvidia/other-model');
});

test('the API key never appears in a stored reading',async()=>{
 for(const body of [answer(good),answer('not json'),{error:'denied'}]){
  const row=R.storedReading('case-1','HUBS',await R.readShadow(input,on,fake(body,body.error?401:200)));
  const text=JSON.stringify(row);assert.ok(!text.includes(KEY));assert.ok(!/authorization|bearer/i.test(text));
  assert.deepEqual(Object.keys(row).sort(),['caseId','createdAt','httpStatus','latencyMs','model','note','parsed','promptVersion','rawReasoning','rawResponse','sentText','status','symbol','validation','version']);
 }
});

test('comparison: role and event agreement, summary and a safe CSV',()=>{
 const kase=(level,topics,headline='h')=>({identity:{name:'HubSpot, Inc.',relevance:{level}},event:{headline,analysis:{topics}}});
 const reading=(role,event,status='ok')=>({caseId:'c',symbol:'HUBS',createdAt:'t',status,sentText:{headline:'=HYPERLINK("x")',company:'HubSpot, Inc.'},parsed:status==='ok'?{company_role:role,event_type:event,claims:[]}:null,validation:{droppedClaims:0}});
 const a=R.compareRow(reading('subject','guidance'),kase('direct_candidate',['Earnings or financial results']));
 assert.equal(a.roleAgrees,true);assert.equal(a.eventAgrees,true);
 const b=R.compareRow(reading('mentioned','analyst_opinion'),kase('direct_candidate',['Earnings or financial results']));
 assert.equal(b.roleAgrees,false);assert.equal(b.eventAgrees,false);
 assert.equal(R.compareRow(reading('subject','product_or_operations'),kase('review',[])).eventAgrees,true,'both see none of the rules topics');
 const c=R.compareRow(reading(null,null,'unavailable'),kase('review',[]));assert.equal(c.roleAgrees,null);
 assert.deepEqual(R.summarise([a,b,c]),{readings:3,statuses:{ok:2,unavailable:1},role:{agree:1,disagree:1},event:{agree:1,disagree:1}});
 const csv=R.toCsv([a]);const [header,line]=csv.trim().split('\r\n');
 assert.equal(header,'caseId,headline,company,rules_role,rules_topics,model_role,model_event,my_role,my_event');
 assert.ok(line.includes(`"'=HYPERLINK(""x"")"`),'formula-looking headline is neutralised and quoted');assert.ok(line.endsWith(',,'),'labelling columns left blank');
});

test('batch hook: reads only created cases, never mutates them, stores allow-listed rows, respects the cap',async()=>{
 const S=await load('lib/sentinel/shadow-store.ts');
 const freeze=o=>{Object.values(o).forEach(v=>v&&typeof v==='object'&&freeze(v));return Object.freeze(o)};
 const item=(i,created=true)=>({status:'complete',created,caseId:'case-'+i,case:{symbol:'S'+i,event:{headline:'Company '+i+' reports results',providerSummary:null},identity:{name:'Company '+i,cik:'000000000'+i}}});
 const items=freeze([item(1),item(2,false),item(3),{status:'failed'},...Array.from({length:12},(_,i)=>item(10+i))]);
 globalThis.inserts=[];globalThis.testEnv={};
 assert.deepEqual(await S.shadowReadCases('owner-1',items,fake(answer(good))),{status:'disabled',attempted:0});assert.equal(inserts.length,0);
 globalThis.testEnv={SHADOW_READER_ENABLED:'1',NVIDIA_API_KEY:KEY};
 const f=fake(answer({company_role:'subject',event_type:'earnings_results',claims:[]}));
 const r=await S.shadowReadCases('owner-1',items,f);
 assert.equal(r.attempted,10,'capped at 10 per run');assert.equal(f.calls.length,10);assert.equal(inserts.length,10);
 assert.ok(!f.calls.some(c=>JSON.parse(c.init.body).messages[1].content.includes('Company 2 ')),'cases not created in this run are not read');
 for(const ins of inserts){assert.match(ins.sql,/^INSERT INTO signal_log\(.*'shadow_reading'/);assert.equal(ins.a[1],'owner-1');assert.ok(!ins.a.join(' ').includes(KEY));}
 globalThis.testEnv=undefined;
});

test('shadow code never updates or deletes',()=>{
 for(const f of ['lib/sentinel/shadow-reader.ts','lib/sentinel/shadow-store.ts','app/api/shadow-comparison/route.ts'])assert.doesNotMatch(readFileSync(f,'utf8'),/\b(UPDATE|DELETE)\b/,f);
});
