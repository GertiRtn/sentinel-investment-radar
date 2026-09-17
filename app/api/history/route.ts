import {rawText} from '@/lib/sentinel/edgar';
import {database} from '@/db/store';
import {identity,json,failure,ApiError} from '@/lib/sentinel/api';
import {NEWS_SOURCES,parseRSS,parseQuote} from '@/lib/sentinel/feeds';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{await identity();const db=database(),p=new URL(request.url).searchParams;
 const rawId=p.get('raw');if(rawId){const raw=await db.prepare('SELECT * FROM raw_event WHERE id=?').bind(rawId).first();if(!raw)throw new ApiError(404,'Capture not found');return json({...raw,payload:await rawText(raw)});}
 const at=p.get('asOf')||new Date().toISOString();if(!Number.isFinite(Date.parse(at))||Date.parse(at)>Date.now()+60000)throw new ApiError(400,'Choose a valid past time');const cutoff=new Date(at).toISOString();
 const runs=await db.prepare('SELECT c.*,r.payload,r.known_from,r.fetched_at FROM collector_run c LEFT JOIN raw_event r ON r.id=c.raw_event_id WHERE c.completed_at<=? ORDER BY c.completed_at DESC LIMIT 300').bind(cutoff).all();
 const latest:any[]=[];const seen=new Set();for(const row of runs.results){if(!seen.has(row.source)){seen.add(row.source);latest.push(row)}}
 const quotes:any[]=[],news:any[]=[];
 for(const source of ['coinbase:BTC','coinbase:ETH','ecb','fed']){
 const row=await db.prepare("SELECT c.*,r.payload,r.known_from FROM collector_run c JOIN raw_event r ON r.id=c.raw_event_id WHERE c.source=? AND c.status='available' AND c.completed_at<=? AND r.known_from<=? ORDER BY c.completed_at DESC LIMIT 1").bind(source,cutoff,cutoff).first<any>();if(!row)continue;
 if(source.startsWith('coinbase'))quotes.push({...parseQuote(JSON.parse(row.payload),source.split(':')[1],source.endsWith('BTC')?'Bitcoin':'Ethereum',row.completed_at),rawEventId:row.raw_event_id,knownFrom:row.known_from});
 else news.push(...parseRSS(row.payload,NEWS_SOURCES.find(s=>s.id===source)!,row.completed_at).map(i=>({...i,rawEventId:row.raw_event_id,knownFrom:row.known_from})));
 }
 const first=await db.prepare('SELECT MIN(known_from) AS started FROM raw_event').first();const health=await db.prepare("SELECT id,created_at,entity,body FROM signal_log WHERE owner='system' AND kind='feed_health' AND created_at<=? ORDER BY created_at DESC LIMIT 20").bind(cutoff).all();
 return json({asOf:cutoff,recordingStarted:first?.started||null,quotes,news,sources:latest.map(({source,completed_at,status,attempts,error})=>({source,completedAt:completed_at,status,attempts,error})),health:health.results.map((r:any)=>({...r,body:JSON.parse(r.body)})),notice:'Only information captured by Sentinel on or before this time. No pre-installation history is reconstructed.'});
 }catch(e){return failure(e)}}
