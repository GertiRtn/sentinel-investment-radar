import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {identity,body,json,failure,ApiError} from '@/lib/sentinel/api';
import {database,hash,iso} from '@/db/store';
import {companyFile,rawText,secToken} from '@/lib/sentinel/edgar';
import {companySummary} from '@/lib/sentinel/company-summary';
import {extractRevenueExplanation} from '@/lib/sentinel/filing-explanation';

export async function POST(request:Request){try{
 const owner=await identity(request),user=await getChatGPTUser(),d=await body(request);
 if(typeof d.entity!=='string'||d.mode!=='public'||d.historical!==false)throw new ApiError(400,'Filing explanations are available only for the current public view.');
 const db=database();const watch=await db.prepare('SELECT entity_id FROM entity_watch WHERE owner=? AND entity_id=?').bind(owner,d.entity).first();if(!watch)throw new ApiError(404,'Saved company not found');
 const company=await companyFile(d.entity,iso(),'public',owner),summary=companySummary(company.figures);const current=summary.rows.find(r=>r.metric==='revenue')?.current;
 if(!current)return json({explanation:null,reason:'No supported annual revenue figure is available.'});
 const fact=current.inputs[0],filing=company.filings.find(f=>f.accession===fact.accession&&f.period_end===current.period_end&&['10-K','10-K/A'].includes(String(f.form)));
 if(!filing||!/^\d{10}$/.test(company.entity.cik)||!/^\d{10}-\d{2}-\d{6}$/.test(fact.accession)||!/^[-A-Za-z0-9_.]+\.html?$/.test(String(filing.primary_document)))return json({explanation:null,reason:'A matching annual report was not available for this figure.'});
 const url='https://www.sec.gov/Archives/edgar/data/'+Number(company.entity.cik)+'/'+fact.accession.replaceAll('-','')+'/'+filing.primary_document;
 const source='sec:'+url,state=await db.prepare('SELECT * FROM source_state WHERE source=?').bind(source).first<any>();let raw:any,html:string;
 if(state?.last_good_at&&Date.now()-Date.parse(state.last_good_at)<86400000){raw=await db.prepare('SELECT * FROM raw_event WHERE id=?').bind(state.raw_event_id).first();if(raw)html=await rawText(raw);}
 if(!raw){const contact=user?.email;if(!contact||!/^\S+@\S+\.\S+$/.test(contact))throw new ApiError(503,'A valid SEC contact is required.');await secToken();const response=await fetch(url,{headers:{'User-Agent':'Sentinel Research '+contact,Accept:'text/html'},redirect:'manual',signal:AbortSignal.timeout(15000)});if(!response.ok)throw new ApiError(502,'The SEC filing could not be read. Try again later.');const length=Number(response.headers.get('content-length'));if(Number.isFinite(length)&&length>15000000)throw new ApiError(502,'The filing is too large to inspect.');html=await response.text();if(new TextEncoder().encode(html).length>15000000)throw new ApiError(502,'The filing is too large to inspect.');const digest=await hash(html),at=iso();raw=await db.prepare('SELECT * FROM raw_event WHERE source=? AND content_hash=?').bind(source,digest).first();if(!raw){const id=crypto.randomUUID(),objectKey='sec/'+digest+'.html.gz';const compressed=await new Response(new Blob([html]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();await (env as unknown as {ARCHIVE:R2Bucket}).ARCHIVE.put(objectKey,compressed,{httpMetadata:{contentType:'application/gzip'}});await db.prepare('INSERT OR IGNORE INTO raw_event(id,source,fetched_at,published_at,known_from,content_hash,payload,http_status) VALUES(?,?,?,?,?,?,?,200)').bind(id,source,at,fact.filed,at,digest,JSON.stringify({objectKey,encoding:'gzip',uncompressedBytes:new TextEncoder().encode(html).length})).run();raw=await db.prepare('SELECT * FROM raw_event WHERE source=? AND content_hash=?').bind(source,digest).first();}await db.prepare('INSERT INTO source_state(source,failures,checked_at,last_good_at,raw_event_id) VALUES(?,0,?,?,?) ON CONFLICT(source) DO UPDATE SET failures=0,checked_at=excluded.checked_at,last_good_at=excluded.last_good_at,raw_event_id=excluded.raw_event_id,retry_at=NULL,error=NULL').bind(source,at,at,raw.id).run();}
 const explanation=extractRevenueExplanation(html!);return json({explanation,reason:explanation?null:'No unambiguous short revenue explanation was found in this annual report.',filingUrl:url,filingDate:fact.filed,periodEnd:current.period_end,capturedAt:raw.fetched_at,rawId:raw.id,hash:raw.content_hash});
 }catch(e){return failure(e)}}
