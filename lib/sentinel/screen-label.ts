export function screenLabel(record:any, unassessed=false):string {
 if(unassessed || record?.stage==='UNASSESSED') return 'Unassessed';
 const version=record?.decision?.version || record?.screenVersion || record?.version;
 if(version==='research-screen-v1' && record?.conclusion==='INVESTIGATE') return 'Data ready (v1 label)';
 if(version==='event-case-v1' && record?.conclusion==='INVESTIGATE') return 'Unassessed';
 return record?.conclusion || 'Unassessed';
}
