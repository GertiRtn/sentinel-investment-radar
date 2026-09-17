"use client";
import {newId} from '@/lib/sentinel/client-id';
import {useEffect,useRef,useState,useCallback} from 'react';
import {initialWorkspace,type WorkspaceData,Workspace} from '@/lib/sentinel/contracts';
export function useWorkspace(){
 const [data,setData]=useState<WorkspaceData>(initialWorkspace),[ready,setReady]=useState(false),[status,setStatus]=useState('Loading saved research…'),[error,setError]=useState('');
 const current=useRef(data),baseline=useRef(''),revision=useRef(0),busy=useRef(false),blocked=useRef(false),mounted=useRef(true),pending=useRef<{id:string;data:WorkspaceData}|null>(null);
 current.current=data;
 const load=useCallback(async()=>{setReady(false);setError('');try{const r=await fetch('/api/workspace',{cache:'no-store'});const j=await r.json() as any;if(!r.ok)throw new Error(j.error||'Saved research could not be loaded');let remote=Workspace.parse(j.data),rev=j.revision;
  let legacy:WorkspaceData|null=null;try{if(!localStorage.getItem('sentinel-server-imported-v1')){const raw=localStorage.getItem('sentinel-workspace-v1');if(raw){const parsed=Workspace.safeParse({...initialWorkspace,...JSON.parse(raw),instruments:[]});if(parsed.success)legacy=parsed.data;}}}catch{/* The server remains authoritative if browser storage is unavailable. */}
  if(legacy){const requestId=newId();const ir=await fetch('/api/workspace',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'import',requestId,expectedRevision:rev,data:legacy})});const imported=await ir.json() as any;if(!ir.ok)throw new Error(imported.error||'Import failed. Original browser data is preserved.');remote=Workspace.parse(imported.data);rev=imported.revision;try{localStorage.setItem('sentinel-server-imported-v1','yes')}catch{}}
  if(!mounted.current)return;revision.current=rev;baseline.current=JSON.stringify(remote);current.current=remote;setData(remote);setReady(true);blocked.current=false;pending.current=null;setStatus('Saved to your private workspace');
 }catch(e){if(mounted.current){setError(e instanceof Error?e.message:'Storage unavailable');setStatus('Not synced');}}},[]);
 const save=useCallback(async()=>{
  if(busy.current||blocked.current)return;busy.current=true;
  try{while(JSON.stringify(current.current)!==baseline.current){setStatus('Saving…');const snapshot=current.current;if(!pending.current||JSON.stringify(pending.current.data)!==JSON.stringify(snapshot))pending.current={id:newId(),data:snapshot};
   const r=await fetch('/api/workspace',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'save',requestId:pending.current.id,expectedRevision:revision.current,data:snapshot})});const j=await r.json() as any;
   if(!r.ok){blocked.current=true;throw new Error(j.error||'Save failed. Your draft remains on screen.');}
   revision.current=j.revision;baseline.current=JSON.stringify(snapshot);pending.current=null;
  }setError('');setStatus('Saved to your private workspace');
 }catch(e){setStatus('Unsaved changes');setError(e instanceof Error?e.message:'Save failed');}finally{busy.current=false;}
 },[]);
 useEffect(()=>{mounted.current=true;void load();return()=>{mounted.current=false}},[load]);
 useEffect(()=>{if(!ready)return;const timer=setTimeout(()=>void save(),700);return()=>clearTimeout(timer)},[data,ready,save]);
 useEffect(()=>{const prevent=(e:BeforeUnloadEvent)=>{if(ready&&JSON.stringify(current.current)!==baseline.current){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',prevent);return()=>window.removeEventListener('beforeunload',prevent)},[ready]);
 const update=<K extends keyof WorkspaceData>(key:K,value:WorkspaceData[K]|((previous:WorkspaceData[K])=>WorkspaceData[K]))=>setData(d=>({...d,[key]:typeof value==='function'?(value as (previous:WorkspaceData[K])=>WorkspaceData[K])(d[key]):value}));
 const exportDraft=()=>{const link=document.createElement('a');const url=URL.createObjectURL(new Blob([JSON.stringify(current.current,null,2)],{type:'application/json'}));link.href=url;link.download='sentinel-unsaved-research.json';link.click();URL.revokeObjectURL(url)};
 return {data,update,ready,status,error,retry:()=>{if(!ready){void load();return}blocked.current=false;void save()},reload:load,exportDraft};
}
