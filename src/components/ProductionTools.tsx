import { creatorName } from "../lib/creatorName";
import { DraggableDialog } from "./DraggableDialog";
import { subscribeProductionChanges } from "../lib/productionSync";
import { useEffect, useState } from "react";
type Stage = "embroidery" | "printing" | "sewing";
type QueueRow = {creator_name?:string;created_by?:string; id:string; order_number:string; customer_name_snapshot:string; printing_status?:string; sewing_status?:string; status?:string; printing_worker?:string; sewing_worker?:string };
type Completion = {order_id:string;completed_at:string|null;worker_name:string;snapshot:Record<string,string|number|null>};
async function request(url:string, method="GET",body?:unknown) {
 const response=await fetch(url,{method,credentials:"include",headers:{"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
 const data=await response.json(); if(!response.ok) throw new Error(data.message||"تعذر تحميل البيانات"); return data;
}
export function useProductionQueue(stage:Stage|undefined, refresh:unknown) {
 const [ids,setIds]=useState<string[]>([]);
 const [revision,setRevision]=useState(0);
 const [error,setError]=useState("");
 useEffect(()=>{
  if(!stage||stage==="embroidery") return;
  let active=true;
  const load=()=>request(`/api/production/${stage}/queue`).then(data=>{if(active){setIds(data.orders.map((o:QueueRow)=>o.id));setRevision(data.revision);setError("");}}).catch(e=>{if(active)setError(e.message);});
  void load(); const timer=window.setInterval(load,15000); return ()=>{active=false;window.clearInterval(timer);};
 },[stage,refresh]);
 return {ids,revision,error,setIds,setRevision};
}
export default function ProductionTools({stage,canReorder,onOrderClick,onSaved}:{stage:Stage;canReorder:boolean;onOrderClick?:(id:string)=>void;onSaved:()=>void}) {
 const [panel,setPanel]=useState<"archive"|"priority"|null>(null);
 const [rows,setRows]=useState<QueueRow[]>([]);
 const [archive,setArchive]=useState<Completion[]>([]);
 const [revision,setRevision]=useState(0);
 const [error,setError]=useState("");
 const [busy,setBusy]=useState(false);
 const [drag,setDrag]=useState<number|null>(null);
 async function open(next:"archive"|"priority") {
  setPanel(next);setError("");setBusy(true);setRows([]);setArchive([]);
  try {const data=await request(`/api/production/${stage}/${next==="archive"?"archive":"queue"}`);
   if(next==="archive") setArchive(data.completions);else {setRows(data.orders);setRevision(data.revision);}
  } catch(e){setError(e instanceof Error?e.message:"تعذر التحميل");} finally{setBusy(false);}
 }
 useEffect(()=>{if(panel!=="archive")return;let active=true;let generation=0;
  const refresh=async()=>{const requestId=++generation;try{const data=await request(`/api/production/${stage}/archive`);if(active&&requestId===generation)setArchive(data.completions);}catch{/* Keep current archive and retry on next refresh. */}};
  const unsubscribe=subscribeProductionChanges(()=>{void refresh();});const timer=window.setInterval(refresh,5000);
  return()=>{active=false;generation++;unsubscribe();window.clearInterval(timer);};
 },[panel,stage]);
 function move(from:number,to:number){if(to<0||to>=rows.length||busy)return;setRows(current=>{const next=[...current];const [row]=next.splice(from,1);next.splice(to,0,row);return next;});}
 async function save(){setBusy(true);setError("");try {await request(`/api/production/${stage}/queue`,"PUT",{ids:rows.map(r=>r.id),revision});onSaved();setPanel(null);}catch(e){setError(e instanceof Error?e.message:"تعذر الحفظ");}finally{setBusy(false);}}
 const columns=[['customer_name_snapshot','اسم العميل'],['source_party','طرف'],['type','النوع'],['color','اللون'],['logo','اللوجو'],['quantity','العدد'],['delivery_date','تاريخ التسليم']];
 const panelTitle=panel==="archive"?`أرشيف ${stage==="embroidery"?"التطريز":stage==="printing"?"الطباعة":"الخياطة"}`:"ترتيب الأوردرات";
 const panelContent=panel ? <>
 {error&&<p role="alert">{error}<button className="ghost-btn" onClick={()=>{if(panel)void open(panel);}}>إعادة تحميل</button></p>}{busy&&<p role="status">جار التحميل…</p>}
 <div className="table-wrap"><table className="settings-table"><thead><tr>{panel==="priority"?<><th>الترتيب</th><th>رقم الأوردر</th><th className="order-creator-cell">أُضيف بواسطة</th><th>اسم العميل</th><th>الحالة</th><th>نقل</th></>:<><th>رقم الأوردر</th><th className="order-creator-cell">أُضيف بواسطة</th>{columns.map(([key,label])=><th key={key}>{label}</th>)}<th>اسم العامل</th><th>وقت إنهاء المرحلة</th></>}</tr></thead><tbody>
 {panel==="priority"?rows.map((row,index)=><tr key={row.id} draggable={!busy} onDragStart={()=>setDrag(index)} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(drag!==null)move(drag,index);setDrag(null);}}><td>{index+1}</td><td>{row.order_number}</td><td className="order-creator-cell" title={creatorName(row)}>{creatorName(row)}</td><td>{row.customer_name_snapshot}</td><td>{(row.status === "WORKER_STARTED" || !!row.printing_worker || !!row.sewing_worker)?"جاري التشغيل":"في الانتظار"}</td><td><button aria-label={`نقل ${row.order_number} لأعلى`} disabled={busy||index===0} onClick={()=>move(index,index-1)}>↑</button><button aria-label={`نقل ${row.order_number} لأسفل`} disabled={busy||index===rows.length-1} onClick={()=>move(index,index+1)}>↓</button></td></tr>):archive.map((row,index)=><tr key={`${row.order_id}-${index}`}><td><a href={`#editOrder/${row.order_id}`} onClick={e=>{if(onOrderClick){e.preventDefault();onOrderClick(row.order_id);}}}>{row.snapshot.order_number}</a></td><td className="order-creator-cell" title={creatorName(row.snapshot)}>{creatorName(row.snapshot)}</td>{columns.map(([key])=><td key={key}>{row.snapshot[key]??"—"}</td>)}<td>{row.worker_name||"—"}</td><td>{row.completed_at?new Date(row.completed_at).toLocaleString("ar-EG"):"غير مسجل"}</td></tr>)}
 </tbody></table></div>{!busy&&!(panel==="priority"?rows:archive).length&&<p>لا توجد أوردرات</p>}
 {panel==="priority"&&<button className="primary-btn" disabled={busy||!!error} onClick={()=>void save()}>حفظ الترتيب</button>}
 </> : null;
 return <><button className="ws-workers-open" onClick={()=>void open("archive")}>الأرشيف</button>{stage!=="embroidery"&&canReorder&&<button className="ws-distribute-btn" onClick={()=>void open("priority")}>ترتيب</button>}
 {panel==="archive"&&<DraggableDialog
   dialogClassName="production-panel production-archive-window"
   headClassName="production-archive-head"
   ariaLabel={panelTitle}
   title={<div className="production-archive-title"><h2>{panelTitle}</h2><button type="button" className="ghost-btn" disabled={busy} onClick={()=>setPanel(null)}>إغلاق</button></div>}
   onClose={()=>setPanel(null)}
   showCloseButton={false}
   windowControls
   minimizedLabel={panelTitle}
   defaultSize={{w:1216,h:640}}
 >
   <div className="production-archive-body">{panelContent}</div>
 </DraggableDialog>}
 {panel==="priority"&&<div className="production-overlay"><section className="production-panel" role="dialog" aria-modal="true" aria-label={panelTitle} dir="rtl">
   <div className="settings-card-head"><h2>{panelTitle}</h2><button className="ghost-btn" disabled={busy} onClick={()=>setPanel(null)}>إغلاق</button></div>
   {panelContent}
 </section></div>}
 </>;
}
