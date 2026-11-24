import { useEffect, useState } from "react";
type Worker = { id: string; name: string; card_id: string; phone: string; department: string; active: boolean };
async function request(url: string, method = "GET", body?: unknown) {
 const response = await fetch(url, { method, credentials: "include", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
 const data = await response.json();
 if (!response.ok) throw new Error(data.message || "تعذر حفظ البيانات");
 return data;
}
const blank = { id: "", name: "", card_id: "", phone: "", department: "operation", active: true };
export default function WorkerManager({ canManage }: { canManage: boolean }) {
 const [workers, setWorkers] = useState<Worker[]>([]);
 const [draft, setDraft] = useState<Worker | null>(null);
 const [search, setSearch] = useState("");
 const [error, setError] = useState("");
 const [busy, setBusy] = useState(false);
 const load = () => request("/api/workers").then(data => setWorkers(data.workers));
 useEffect(() => { load().catch(e => setError(e.message)); }, []);
 async function save(worker: Worker, remove = false) {
  if (!canManage || busy) return;
  setBusy(true); setError("");
  try { await request(`/api/workers${worker.id ? `/${worker.id}` : ""}`, remove ? "DELETE" : worker.id ? "PATCH" : "POST", remove ? undefined : worker); await load(); setDraft(null); }
  catch (e) { setError(e instanceof Error ? e.message : "تعذر الحفظ"); }
  finally { setBusy(false); }
 }
 return <section className="settings-card"><h2>العمال</h2>
 <input aria-label="ابحث عن عامل" placeholder="ابحث عن عامل" value={search} onChange={e=>setSearch(e.target.value)} />
 {error && <p role="alert">{error}</p>}
 {canManage && <button className="primary-btn" onClick={()=>setDraft({...blank})}>إضافة عامل</button>}
 {draft && <form onSubmit={e=>{e.preventDefault(); void save(draft);}}>
 {[["name", "اسم العامل"], ["card_id", "رقم البطاقة"], ["phone", "الهاتف"]].map(([key,label])=><label key={key}>{label}<input required value={String(draft[key as keyof Worker])} onChange={e=>setDraft({...draft,[key]:e.target.value})}/></label>)}
 <label>القسم<select value={draft.department} onChange={e=>setDraft({...draft,department:e.target.value})}>{[["operation","التطريز"],["printing","الطباعة"],["sewing","الخياطة"],["finishing","التشطيب"]].map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
 <button className="primary-btn" disabled={busy}>حفظ</button><button type="button" className="ghost-btn" onClick={()=>setDraft(null)}>إلغاء</button></form>}
 <div className="table-wrap"><table className="settings-table"><thead><tr><th>اسم العامل</th><th>رقم البطاقة</th><th>الهاتف</th><th>القسم</th><th>الحالة</th><th>إجراءات</th></tr></thead><tbody>{workers.filter(w=>`${w.name} ${w.phone}`.toLowerCase().includes(search.toLowerCase())).map(w=><tr key={w.id}><td>{w.name}</td><td>{w.card_id}</td><td>{w.phone}</td><td>{w.department}</td><td>{w.active ? "فعال" : "متوقف"}</td><td>{canManage && <><button className="ghost-btn" disabled={busy} onClick={()=>setDraft({...w})}>تعديل</button><button className="ghost-btn" disabled={busy} onClick={()=>void save({...w,active:!w.active})}>{w.active ? "إيقاف" : "تفعيل"}</button><button className="ghost-btn" disabled={busy} onClick={()=>{if(window.confirm("إيقاف العامل مع الاحتفاظ بسجلاته؟")) void save(w,true);}}>حذف آمن</button></>}</td></tr>)}</tbody></table></div></section>;
}
