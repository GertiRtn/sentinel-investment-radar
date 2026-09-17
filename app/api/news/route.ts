import {collectNews} from '@/lib/sentinel/collector';
import {identity,json,failure} from '@/lib/sentinel/api';
export const dynamic='force-dynamic';
export async function GET(){try{await identity();return json(await collectNews(false))}catch(e){return failure(e)}}
