/** Extract only a directly stated, bounded revenue explanation; never infer causation. */
export function extractRevenueExplanation(html:string):string|null{
 const text=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;|\u00a0/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ');
 const matches=[...text.matchAll(/\b(?:total )?revenue (?:increased|decreased) primarily (?:due to|driven by) [^.]{10,160}\./gi)];
 // Multiple matches are ambiguous (e.g. different comparative periods). Do not guess.
 const sentences=[...new Set(matches.map(m=>m[0].trim()))];
 if(sentences.length!==1||sentences[0].split(/\s+/).length>25)return null;
 return sentences[0];
}
export function executiveSentence(rows:{label:string;current:{value:number|null}|null;changePercent:number|null}[]):string{
 const pieces=rows.map(r=>{if(!r.current||r.current.value===null)return `${r.label} was unavailable`;if(r.changePercent===null)return `${r.label} was reported, but a comparable change was unavailable`;const n=Math.abs(r.changePercent).toFixed(1);return r.changePercent>0?`${r.label} rose ${n}%`:r.changePercent<0?`${r.label} fell ${n}%`:`${r.label} was unchanged`;});
 return pieces.join('; ')+'.';
}
