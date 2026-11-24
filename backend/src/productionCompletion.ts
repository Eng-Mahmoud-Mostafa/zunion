import { ACTIVE_EMBROIDERY_SQL } from "./embroideryEligibility.js";
import { activeMachineAssignments, compactMachineQueue } from "./machineAssignments.js";
import { tx } from "./db.js";
import type { PoolClient } from "pg";
import type { OrderRecord } from "./notifications.js";
export type ProductionKind = "embroidery" | "sewing" | "printing";
export const PRODUCTION_DDL = `
create table if not exists production_queues (
 stage text primary key check(stage in ('embroidery','printing','sewing')),
 revision integer not null default 0,
 order_ids jsonb not null default '[]'::jsonb
);
create table if not exists production_stage_completions (
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references orders(id) on delete restrict,
 stage text not null check(stage in ('embroidery','printing','sewing')),
 completed_at timestamptz not null default now(),
 completed_by uuid references users(id) on delete set null,
 worker_name text not null default '',
 priority integer,
 snapshot jsonb not null,
 unique(order_id, stage)
);
alter table production_queues enable row level security;
alter table production_stage_completions enable row level security;
insert into production_queues(stage) values ('embroidery'),('printing'),('sewing') on conflict do nothing;
`;
const types = { embroidery: ["تطريز"], sewing: ["خياطه", "خياطة"], printing: ["طباعه", "طباعة"] };
export async function lockQueue(client: PoolClient, stage: ProductionKind) {
 const { rows } = await client.query<{revision:number;order_ids:string[]}>("select * from production_queues where stage=$1 for update", [stage]);
 if (!rows[0]) throw new Error("Production migration is required");
 return rows[0];
}
export async function activeQueue(client: PoolClient, stage: ProductionKind, saved: string[]) {
 const { rows } = stage === "embroidery"
   ? await client.query(`select o.* from orders o where ${ACTIVE_EMBROIDERY_SQL} order by o.created_at,o.id`)
   : await client.query("select * from orders where type=any($1::text[]) and work_stage in ('new','operation') and draft=false order by created_at,id", [types[stage]]);
 const ranks = new Map(saved.map((id,i)=>[id,i]));
 return rows.sort((a,b)=>(ranks.get(a.id)??Number.MAX_SAFE_INTEGER)-(ranks.get(b.id)??Number.MAX_SAFE_INTEGER));
}
export async function readProductionQueue(stage: ProductionKind) {
 return tx(async client=>{ const saved=await lockQueue(client,stage); const orders=await activeQueue(client,stage,saved.order_ids); return {revision:saved.revision,orders}; });
}
export async function saveProductionQueue(stage: ProductionKind, ids: string[], revision: number, user: {id:string;email:string;role:string}) {
 return tx(async client=>{
  const saved=await lockQueue(client,stage);
  const orders=await activeQueue(client,stage,saved.order_ids);
  if(saved.revision!==revision || ids.length!==orders.length || new Set(ids).size!==ids.length || orders.some(o=>!ids.includes(o.id))) return false;
  await client.query("update production_queues set order_ids=$2::jsonb,revision=revision+1 where stage=$1",[stage,JSON.stringify(ids)]);
  await client.query("insert into audit_logs(user_id,user_email,user_role,action,entity_type,new_value_json) values($1,$2,$3,'PRODUCTION_REORDERED','production_queues',$4::jsonb)",[user.id,user.email,user.role,JSON.stringify({stage,ids})]);
  return true;
 });
}
export async function completeProductionOrder(id: string, stage: ProductionKind, userId: string) {
 return tx(async client=>{
  const queue=await lockQueue(client,stage);
  const previous=(await client.query<OrderRecord>("select * from orders where id=$1 for update",[id])).rows[0];
  if(!previous) return {outcome:"missing" as const};
  // An existing completion is an idempotent retry, including after finishing/delivery.
  const done=await client.query("select id from production_stage_completions where order_id=$1 and stage=$2",[id,stage]);
  if(done.rows.length) return {outcome:"already-transferred" as const,current:previous};
  if(!types[stage].includes(String(previous.type??""))) return {outcome:"wrong-type" as const};
  if(previous.draft) return {outcome:"draft" as const};
  if(!["new","operation"].includes(String(previous.work_stage))) return {outcome:"ineligible" as const};
  const active=await activeQueue(client,stage,queue.order_ids);
  if (stage === "embroidery" && !active.some(o=>o.id===id)) return {outcome:"ineligible" as const};
  const statusColumn=stage==="embroidery" ? "status" : `${stage}_status`;
  const worker=String(previous[stage==="embroidery"?"worker_name":`${stage}_worker`]??"");
  const snapshot: Record<string,unknown>=Object.fromEntries(["order_number","customer_name_snapshot","source_party","type","color","quantity","delivery_date","product_name_snapshot"].map(key=>[key,previous[key]]));
  const logos=await client.query("select logo_place from order_items where order_id=$1",[id]);
  let completedMachine: string | undefined;
  if (stage === "embroidery") {
    const assignment = (await activeMachineAssignments(client)).find(a=>a.order_id===id);
    if (assignment) {snapshot.machine_assignment = assignment;completedMachine=assignment.machine_name;}
  }
  snapshot.logo=logos.rows.map(r=>r.logo_place).filter(Boolean).join("، ");
  await client.query("insert into production_stage_completions(order_id,stage,completed_by,worker_name,priority,snapshot) values($1,$2,$3,$4,$5,$6::jsonb)",[id,stage,userId,worker,active.findIndex(o=>o.id===id)+1,JSON.stringify(snapshot)]);
  const current=(await client.query<OrderRecord>(`update orders set ${stage==="embroidery"?"":""+statusColumn+"='done',"} status='WORKER_DONE',work_stage='finishing',updated_by=$2 where id=$1 returning *`,[id,userId])).rows[0];
  if (completedMachine) await compactMachineQueue(client,completedMachine);
  await client.query("update production_queues set order_ids=$2::jsonb,revision=revision+1 where stage=$1",[stage,JSON.stringify(active.filter(o=>o.id!==id).map(o=>o.id))]);
  await client.query("insert into audit_logs(user_id,action,entity_type,entity_id,new_value_json) values($1,'PRODUCTION_COMPLETED','orders',$2,$3::jsonb)",[userId,id,JSON.stringify({stage,work_stage:"finishing",worker})]);
  return {outcome:"transferred" as const,previous,current,statusColumn};
 });
}
