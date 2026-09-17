import {env} from 'cloudflare:workers';
export function database():D1Database{if(!env.DB)throw new Error('Persistent storage unavailable');return env.DB;}
export const iso=()=>new Date().toISOString();
export async function hash(value:string){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');}
