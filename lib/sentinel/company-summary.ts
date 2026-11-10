import type {Figure} from './financial';

export type SummaryRow={metric:string;label:string;description:string;current:Figure|null;previous:Figure|null;changePercent:number|null};
const measures=[['revenue','Revenue','Money earned from sales.'],['net_income','Net income','Profit or loss after expenses and taxes.'],['cfo','Operating cash flow','Cash generated or used by the business’s operations.']] as const;
/** Only compare sourced, directly reported annual flows with matching tags and similar lengths. */
export function companySummary(figures:Figure[]):{periodEnd:string|null;rows:SummaryRow[]}{
 const periodEnd=figures.filter(f=>f.metric==='revenue').map(f=>f.period_end).sort().at(-1)??null;
 return {periodEnd,rows:measures.map(([metric,label,description])=>{
  const eligible=figures.filter(f=>f.metric===metric&&f.confidence==='reported'&&f.value!==null&&f.inputs.length===1&&!!f.inputs[0].period_start);
  const current=eligible.find(f=>f.period_end===periodEnd)??null;
  let previous:Figure|null=null,changePercent:number|null=null;
  if(current){const c=current.inputs[0],duration=Date.parse(c.period_end)-Date.parse(c.period_start);
   previous=eligible.filter(f=>{const p=f.inputs[0],gap=(Date.parse(current.period_end)-Date.parse(f.period_end))/86400000,priorDuration=Date.parse(p.period_end)-Date.parse(p.period_start);return gap>=330&&gap<=400&&p.source_tag===c.source_tag&&p.unit===c.unit&&Math.abs(duration-priorDuration)<=14*86400000;}).sort((a,b)=>b.period_end.localeCompare(a.period_end))[0]??null;
   if(previous&&previous.value!>0)changePercent=(current.value!-previous.value!)/previous.value!*100;
  }
  return {metric,label,description,current,previous,changePercent};
 })};
}
