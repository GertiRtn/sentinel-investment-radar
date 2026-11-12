import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const esbuild=require(require.resolve('esbuild',{paths:[require.resolve('wrangler/package.json')]}));

// Bundle a TS module for Node, replacing Worker/Next/Sites modules with test doubles.
async function load(path){
 const stubs={
  'cloudflare:workers':'export const env=new Proxy({},{get:(_,k)=>(globalThis.testEnv||{})[k]});',
  'next/headers':'export async function headers(){return new Headers(globalThis.testHeaders||{})}',
  'chatgpt-auth':'export async function getChatGPTUser(){return globalThis.testUser?{userId:globalThis.testUser,email:"sites@example.test",displayName:"sites@example.test",fullName:null}:null}'
 };
 const b=await esbuild.build({entryPoints:[path],bundle:true,write:false,platform:'node',format:'esm',
  alias:{'@':process.cwd()},
  plugins:[{name:'stubs',setup(build){
   build.onResolve({filter:/^cloudflare:workers$|^next\/headers$|chatgpt-auth$/},a=>({path:a.path.endsWith('chatgpt-auth')?'chatgpt-auth':a.path,namespace:'stub'}));
   build.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path],loader:'js'}));
  }}]});
 return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64')+'#'+Math.random());
}

const TEAM='sentinel-test.cloudflareaccess.com',AUD='a'.repeat(64),NOW=Date.parse('2026-11-12T12:00:00Z'),S=Math.floor(NOW/1000);
const b64u=x=>Buffer.from(typeof x==='string'?x:JSON.stringify(x)).toString('base64url');
async function keypair(kid){
 const k=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 return {kid,privateKey:k.privateKey,jwk:{...(await crypto.subtle.exportKey('jwk',k.publicKey)),kid,alg:'RS256',use:'sig'}};
}
async function sign(key,claims,header={}){
 const h=b64u({alg:'RS256',kid:key.kid,typ:'JWT',...header}),p=b64u(claims);
 const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key.privateKey,new TextEncoder().encode(h+'.'+p));
 return h+'.'+p+'.'+Buffer.from(sig).toString('base64url');
}
const good=(over={})=>({iss:'https://'+TEAM,aud:[AUD],email:'Owner@Example.test',sub:'user-1',type:'app',iat:S-10,nbf:S-10,exp:S+600,...over});

const jwt=await load('lib/sentinel/access-jwt.ts');
const k1=await keypair('k1'),k2=await keypair('k2'),attacker=await keypair('k1');
let fetches=0;const fetcher=keys=>async url=>{fetches++;assert.equal(url,'https://'+TEAM+'/cdn-cgi/access/certs');return {keys};};
const verify=(token,opts={})=>jwt.verifyAccessJwt(token,{teamDomain:opts.team??TEAM,audience:opts.aud??AUD},{nowMs:opts.now??NOW,fetcher:opts.fetcher??fetcher([k1.jwk])});

test('a correctly signed token for this app and team is accepted',async()=>{
 jwt.clearAccessKeyCache();
 const r=await verify(await sign(k1,good()));
 assert.equal(r.ok,true);assert.equal(r.claims.email,'Owner@Example.test');
});

test('forged, tampered, foreign and expired tokens are rejected',async()=>{
 jwt.clearAccessKeyCache();
 const cases={
  'signed by a different key with the same kid':await sign(attacker,good()),
  'wrong audience':await sign(k1,good({aud:['other-app']})),
  'wrong issuer':await sign(k1,good({iss:'https://evil.cloudflareaccess.com'})),
  'expired':await sign(k1,good({exp:S-3600})),
  'not yet valid':await sign(k1,good({nbf:S+3600})),
  'no email':await sign(k1,good({email:undefined})),
  'non-app token':await sign(k1,good({type:'org'})),
 };
 for(const [name,token] of Object.entries(cases))assert.equal((await verify(token)).ok,false,name);
 const valid=await sign(k1,good()),[h,,s]=valid.split('.');
 assert.equal((await verify(h+'.'+b64u(good({email:'attacker@example.test'}))+'.'+s)).ok,false,'payload edited after signing');
 assert.equal((await verify(b64u({alg:'none',kid:'k1'})+'.'+b64u(good())+'.')).ok,false,'alg none');
 assert.equal((await verify(b64u({alg:'HS256',kid:'k1'})+'.'+b64u(good())+'.c2ln')).ok,false,'HS256');
 for(const bad of [null,'','a.b','not a token at all'])assert.equal((await verify(bad)).ok,false,String(bad));
});

test('missing configuration rejects everything',async()=>{
 const token=await sign(k1,good());
 assert.equal((await verify(token,{aud:''})).ok,false);
 assert.equal((await verify(token,{team:''})).ok,false);
 assert.equal((await verify(token,{team:'https://evil.example.com'})).ok,false);
});

test('signing keys are cached and refetched once when a new key appears',async()=>{
 jwt.clearAccessKeyCache();fetches=0;
 let keys=[k1.jwk];const f=async()=>{fetches++;return {keys};};
 assert.equal((await verify(await sign(k1,good()),{fetcher:f})).ok,true);
 assert.equal((await verify(await sign(k1,good()),{fetcher:f})).ok,true);
 assert.equal(fetches,1,'second check uses the cache');
 keys=[k1.jwk,k2.jwk];
 assert.equal((await verify(await sign(k2,good()),{fetcher:f})).ok,true,'rotated key accepted after one refetch');
 assert.equal(fetches,2);
 assert.equal((await verify(await sign(await keypair('k9'),good()),{fetcher:f})).ok,false,'unknown key still rejected');
});

test('team domain accepts the forms shown in the Cloudflare dashboard',()=>{
 assert.equal(jwt.normalizeTeamDomain('sentinel-test'),TEAM);
 assert.equal(jwt.normalizeTeamDomain('https://Sentinel-Test.cloudflareaccess.com/'),TEAM);
 assert.equal(jwt.normalizeTeamDomain('sentinel-test.example.com'),null);
});

test('own-Cloudflare host: only the configured owner gets in, under the existing owner id',async()=>{
 const auth=await load('app/auth.ts');
 const realFetch=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify({keys:[k1.jwk]}),{status:200});
 const config={SENTINEL_HOST:'cloudflare',CF_ACCESS_TEAM_DOMAIN:'sentinel-test',CF_ACCESS_AUD:AUD,SENTINEL_OWNER_EMAIL:'owner@example.test',SENTINEL_OWNER_ID:'existing-chatgpt-user-id'};
 const fresh=(over={})=>sign(k1,good({exp:Math.floor(Date.now()/1000)+600,iat:undefined,nbf:undefined,...over}));
 try{
  globalThis.testEnv=config;globalThis.testUser='sites-user';
  globalThis.testHeaders={'oai-authenticated-user-id':'sites-user','oai-authenticated-user-email':'owner@example.test'};
  assert.equal(await auth.getUser(),null,'ChatGPT headers are ignored on this host');
  globalThis.testHeaders={'cf-access-jwt-assertion':await fresh()};
  const user=await auth.getUser();
  assert.equal(user.userId,'existing-chatgpt-user-id');assert.equal(user.email,'Owner@Example.test');
  globalThis.testHeaders={'cf-access-jwt-assertion':await fresh({email:'someone-else@example.test'})};
  assert.equal(await auth.getUser(),null,'a different Access user is refused');
  for(const missing of ['CF_ACCESS_AUD','CF_ACCESS_TEAM_DOMAIN','SENTINEL_OWNER_EMAIL','SENTINEL_OWNER_ID']){
   globalThis.testEnv={...config,[missing]:''};globalThis.testHeaders={'cf-access-jwt-assertion':await fresh()};
   assert.equal(await auth.getUser(),null,'fails closed without '+missing);
  }
  globalThis.testEnv=config;
  const mcp=new Request('https://sentinel.example/mcp',{method:'POST',headers:{'oai-authenticated-user-id':'sites-user'}});
  assert.equal(await auth.mcpCaller(mcp),null,'MCP ignores ChatGPT headers on this host');
  const mcpOk=new Request('https://sentinel.example/mcp',{method:'POST',headers:{'cf-access-jwt-assertion':await fresh()}});
  assert.equal((await auth.mcpCaller(mcpOk)).owner,'existing-chatgpt-user-id');
 }finally{globalThis.fetch=realFetch;globalThis.testEnv=undefined;globalThis.testHeaders=undefined;globalThis.testUser=undefined;}
});

test('Sites host: behaviour is unchanged',async()=>{
 const auth=await load('app/auth.ts');
 try{
  globalThis.testEnv={};globalThis.testUser='sites-user';
  assert.equal((await auth.getUser()).userId,'sites-user');
  const r=new Request('https://x/mcp',{method:'POST',headers:{'oai-authenticated-user-id':'sites-user','oai-authenticated-user-email':'a@b.test'}});
  assert.deepEqual(await auth.mcpCaller(r),{owner:'sites-user',email:'a@b.test'});
 }finally{globalThis.testEnv=undefined;globalThis.testUser=undefined;}
});
