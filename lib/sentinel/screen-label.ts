export function screenLabel(record:any, unassessed=false):string {
 if(unassessed || record?.stage==='UNASSESSED') return 'Unassessed';
 const version=record?.decision?.version || record?.screenVersion || record?.version;
 if(version==='research-screen-v1' && record?.conclusion==='INVESTIGATE') return 'Data ready (v1 label)';
 if(version==='event-case-v1' && record?.conclusion==='INVESTIGATE') return 'Unassessed';
 if(/^(research-screen-v2|event-case-v2)$/.test(String(version))&&FRIENDLY_LABELS[record?.conclusion])return FRIENDLY_LABELS[record.conclusion];
 return record?.conclusion || 'Unassessed';
}

/** Plain-English display names for screen-v2 labels. Stored values never change. */
export const FRIENDLY_LABELS:Record<string,string>={INVESTIGATE:'Strong case',MONITOR:'Watch',WAIT:'Not enough data'};
export function friendlyLabel(label:string):string{
 return FRIENDLY_LABELS[label]??label; // exact match only: 'INVESTIGATE (research-screen-v1)' is not a strong case
}
