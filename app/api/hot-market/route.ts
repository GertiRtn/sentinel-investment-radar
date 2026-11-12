import {database,iso} from '@/db/store';
import {identity,json,failure} from '@/lib/sentinel/api';
import {buildInvestmentDashboard} from '@/lib/sentinel/investment-dashboard';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const owner=await identity(request),now=iso(),db=database();const rows=await db.prepare("SELECT id,created_at,body FROM signal_log WHERE owner=? AND kind='discovery_case' ORDER BY created_at DESC,id DESC LIMIT 200").bind(owner).all<{id:string;created_at:string;body:string}>();return json({asOf:now,caseLimit:200,items:buildInvestmentDashboard(rows.results,now)});}catch(e){return failure(e)}}
