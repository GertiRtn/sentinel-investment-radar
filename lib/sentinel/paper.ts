export const START_CENTS=5000;
export type PaperOrder={sequence:number;symbol:string;side:'buy'|'sell';quantityMicros:number;priceCents:number;grossCents:number;feeCents:number;reason:string;priceSource:string;createdAt:string};
export type PaperState={cashCents:number;positions:Record<string,{quantityMicros:number;lastPriceCents:number;lastPriceAt:string;priceSource:string}>;orders:PaperOrder[];version:number};
export function paperState(orders:PaperOrder[]):PaperState{let cashCents=START_CENTS;const positions:PaperState['positions']={};for(const o of orders){const p=positions[o.symbol]||{quantityMicros:0,lastPriceCents:0,lastPriceAt:'',priceSource:''};cashCents+=o.side==='buy'?-o.grossCents-o.feeCents:o.grossCents-o.feeCents;p.quantityMicros+=o.side==='buy'?o.quantityMicros:-o.quantityMicros;p.lastPriceCents=o.priceCents;p.lastPriceAt=o.createdAt;p.priceSource=o.priceSource;positions[o.symbol]=p;}return {cashCents,positions,orders,version:orders.length};}
export function makeOrder(state:PaperState,input:{symbol:string;side:'buy'|'sell';quantityMicros:number;priceCents:number;reason:string;priceSource:string},createdAt:string):PaperOrder{
 const grossCents=Math.round(input.quantityMicros*input.priceCents/1_000_000),feeCents=Math.max(1,Math.ceil(grossCents/1000));
 if(grossCents<1)throw new Error('Trade value must be at least $0.01.');
 if(input.side==='buy'&&grossCents+feeCents>state.cashCents)throw new Error('Not enough practice cash to cover this trade and its estimated fee.');
 if(input.side==='sell'&&(state.positions[input.symbol]?.quantityMicros||0)<input.quantityMicros)throw new Error('You cannot sell more than you hold.');
 if(input.side==='sell'&&grossCents<=feeCents)throw new Error('Trade value must exceed the estimated fee.');
 return {...input,sequence:state.version+1,grossCents,feeCents,createdAt};
}
