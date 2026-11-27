import {useEffect, useState} from "react";
import {DraggableDialog} from "./DraggableDialog";
import {publishProductionChange,subscribeProductionChanges} from "../lib/productionSync";

type Machine={id:string;name:string;position:number;active:boolean};
type Draft={id?:string;name:string;position:number;active:boolean};
export default function MachineManager({canCreate,canEdit}:{canCreate:boolean;canEdit:boolean}){
 const [machines,setMachines]=useState<Machine[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState("");
 const [draft,setDraft]=useState<Draft|null>(null),[busy,setBusy]=useState(false);
 async function request<T>(url:string,init?:RequestInit):Promise<T>{
  const response=await fetch(url,{credentials:"include",...init,headers:{"Content-Type":"application/json",...init?.headers}});
  const body=await response.json();if(!response.ok)throw Error(body.message||"تعذر حفظ الماكينة");return body as T;
 }
 useEffect(()=>{let alive=true,generation=0;const refresh=async()=>{const version=++generation;try{const data=await request<{machines:Machine[]}>("/api/machines");if(alive&&version===generation)setMachines(data.machines);}catch(e){if(alive)setError((e as Error).message);}finally{if(alive)setLoading(false);}};void refresh();const stop=subscribeProductionChanges(()=>void refresh());const timer=window.setInterval(refresh,5000);return()=>{alive=false;stop();window.clearInterval(timer);};},[]);
 async function save(value:Draft){
  if(busy||!(value.id?canEdit:canCreate))return;
  setBusy(true);setError("");
  try{
   await request(value.id?`/api/machines/${encodeURIComponent(value.id)}`:"/api/machines",{method:value.id?"PATCH":"POST",body:JSON.stringify({name:value.name.trim(),position:value.position,active:value.active})});
   const data=await request<{machines:Machine[]}>("/api/machines");setMachines(data.machines);setDraft(null);publishProductionChange();
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 return <section className="settings-card">
  <div className="settings-card-head"><div><h2>الماكينات</h2><p className="muted">إعداد الماكينات وترتيب ظهورها في توزيع المكن.</p></div>{canCreate&&<button type="button" className="primary-btn" disabled={busy} onClick={()=>{setError("");setDraft({name:"",position:machines.length+1,active:true});}}>إضافة ماكينة</button>}</div>
  {error&&<p className="settings-alert error" role="alert">{error}</p>}
  {loading?<p>جارٍ تحميل الماكينات...</p>:<div className="table-wrap settings-table"><table><thead><tr><th>اسم الماكينة</th><th>الترتيب</th><th>الحالة</th><th>الإجراءات</th></tr></thead><tbody>
   {[...machines].sort((a,b)=>a.position-b.position).map(machine=><tr key={machine.id}><td>{machine.name}</td><td>{machine.position}</td><td>{machine.active?"فعال":"متوقف"}</td><td>{canEdit&&<div className="settings-inline"><button type="button" className="ghost-btn compact" disabled={busy} onClick={()=>{setError("");setDraft({...machine});}}>تعديل</button><button type="button" className="ghost-btn compact" disabled={busy} onClick={()=>void save({...machine,active:!machine.active})}>{machine.active?"إيقاف":"تفعيل"}</button></div>}</td></tr>)}
   {!machines.length&&<tr><td colSpan={4}>لا توجد ماكينات مسجلة</td></tr>}
  </tbody></table></div>}
  {draft&&<DraggableDialog dialogClassName="ws-modal ws-management-modal" headClassName="ws-modal-head" title={<h2>{draft.id?"تعديل ماكينة":"إضافة ماكينة"}</h2>} ariaLabel={draft.id?"تعديل ماكينة":"إضافة ماكينة"} onClose={()=>{if(!busy)setDraft(null);}} closeDisabled={busy}>
   <form className="settings-form-grid" onSubmit={e=>{e.preventDefault();void save(draft);}}>
    {error&&<p className="settings-alert error" role="alert">{error}</p>}
    <label>اسم الماكينة<input required maxLength={120} value={draft.name} disabled={busy} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
    <label>الترتيب<input type="number" required min={1} max={10000} step={1} value={draft.position} disabled={busy} onChange={e=>setDraft({...draft,position:Number(e.target.value)})}/></label>
    <label>الحالة<select value={draft.active?"active":"inactive"} disabled={busy} onChange={e=>setDraft({...draft,active:e.target.value==="active"})}><option value="active">فعال</option><option value="inactive">متوقف</option></select></label>
    <div className="settings-inline"><button className="primary-btn" disabled={busy||!draft.name.trim()}>{busy?"جارٍ الحفظ...":"حفظ"}</button><button type="button" className="ghost-btn" disabled={busy} onClick={()=>setDraft(null)}>إلغاء</button></div>
   </form>
  </DraggableDialog>}
 </section>;
}
