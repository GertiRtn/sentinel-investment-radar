export type StockQuote={symbol:string;bid:number;ask:number;sourceTime:string;capturedAt:string;source:string;stale:boolean;rawEventId?:string};
export function parseIexQuote(data:any,symbol:string,capturedAt:string):StockQuote{
 const q=data?.quote,at=Date.parse(capturedAt),source=typeof q?.t==='string'?Date.parse(q.t):NaN;
 if(data?.symbol!==symbol||!q||typeof q.bp!=='number'||typeof q.ap!=='number'||!Number.isFinite(q.bp)||!Number.isFinite(q.ap)||q.bp<=0||q.ap<=0||q.bp>q.ap||!Number.isFinite(source)||!Number.isFinite(at)||source>at+120000)throw new Error('Provider returned an invalid or incomplete quote.');
 return {symbol,bid:q.bp,ask:q.ap,sourceTime:new Date(source).toISOString(),capturedAt,source:'Alpaca IEX · one US exchange',stale:at-source>300000};
}
