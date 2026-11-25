import { listMachines } from "./machines.js";
import { query, tx } from "./db.js";
import type { PoolClient } from "pg";
import { ACTIVE_EMBROIDERY_SQL, lockEmbroidery } from "./embroideryEligibility.js";

export const MACHINE_SLOT_DDL = `alter table machine_assignments add column if not exists queue_position integer check (queue_position > 0);`;

export type MachineAssignmentRow = {
  id: string; order_id: string; machine_name: string; position: number;
  created_by: string | null; updated_by: string | null; created_at: string; updated_at: string;
};

// Completion takes the same lock before touching an order. This serializes
// assignment, movement, ordering and completion across machines and sessions.
async function assertEligible(client: PoolClient, orderId: string) {
  const { rows } = await client.query(`select o.id from orders o where o.id=$1 and ${ACTIVE_EMBROIDERY_SQL} for update of o`, [orderId]);
  if (!rows.length) throw Object.assign(new Error("الأوردر لم يعد متاحاً في تشغيل التطريز. حدّث الطابور."), { code: "ZUNION_INELIGIBLE" });
}

export async function loadMachineAssignment(id: string): Promise<MachineAssignmentRow | null> {
  return (await query<MachineAssignmentRow>("select * from machine_assignments where id=$1", [id])).rows[0] ?? null;
}

export async function activeMachineAssignments(client: Pick<PoolClient, "query">): Promise<MachineAssignmentRow[]> {
  // Legacy rows retain their previous compact queue. Explicit slots preserve the
  // clicked cell, including intentional gaps. Finished rows remain historical.
  return (await client.query<MachineAssignmentRow>(`
    select a.id,a.order_id,coalesce(m.name,a.machine_name) as machine_name,
      coalesce(a.queue_position,(row_number() over(partition by lower(btrim(a.machine_name)) order by a.position,a.created_at,a.id))::int) as position,
      a.created_by,a.updated_by,a.created_at,a.updated_at
    from machine_assignments a join orders o on o.id=a.order_id
    left join machines m on lower(btrim(m.name))=lower(btrim(a.machine_name))
    where ${ACTIVE_EMBROIDERY_SQL}
    order by machine_name,position`)).rows;
}
export async function listMachineAssignments() {
  return activeMachineAssignments({ query } as Pick<PoolClient, "query">);
}
export async function machineDistributionSnapshot() {
  return tx(async client => {
    await lockEmbroidery(client);
    const assignments = await activeMachineAssignments(client);
    const { rows: orders } = await client.query(`select o.* from orders o where ${ACTIVE_EMBROIDERY_SQL} order by o.created_at,o.id`);
    const machines=await listMachines(client);
    return { assignments, orders, machines };
  });
}
async function setPositions(client: PoolClient, ids: string[]) {
  for (let i=0;i<ids.length;i++) await client.query("update machine_assignments set position=$1,queue_position=$1 where id=$2", [i+1,ids[i]]);
}

async function materializeSlots(client: PoolClient, rows: MachineAssignmentRow[]) {
  // Pin legacy display slots before adding an explicit slot so their positions
  // cannot change when the fallback window function sees another assignment.
  for (const row of rows) await client.query("update machine_assignments set queue_position=$1 where id=$2 and queue_position is null",[row.position,row.id]);
}
export async function compactMachineQueue(client: PoolClient, machineName: string) {
  const rows=(await activeMachineAssignments(client)).filter(a=>a.machine_name===machineName);
  rows.sort((a,b)=>a.position-b.position);
  await setPositions(client,rows.map(a=>a.id));
}

async function requireAvailableMachine(client: PoolClient, name: string) {
 const row=(await client.query<{name:string;active:boolean}>("select name,active from machines where lower(btrim(name))=lower(btrim($1)) for update",[name])).rows[0];
 if(!row?.active)throw Object.assign(new Error("هذه المكنة غير متاحة للتوزيع. حدّث قائمة الماكينات."),{code:"ZUNION_MACHINE_UNAVAILABLE"});
 return row.name;
}
export async function appendMachineAssignment(orderId: string, machineName: string, userId: string, position?: number): Promise<MachineAssignmentRow> {
  return tx(async client => {
    await lockEmbroidery(client);
    machineName=await requireAvailableMachine(client,machineName);
    await assertEligible(client,orderId);
    if ((await client.query("select id from machine_assignments where order_id=$1 limit 1", [orderId])).rows.length)
      throw Object.assign(new Error("هذا الأوردر مخصص لمكنة بالفعل"), { code:"ZUNION_ASSIGNED" });
    const active=(await activeMachineAssignments(client)).filter(a=>a.machine_name===machineName);
    const next=Math.max(0,...active.map(a=>a.position))+1;
    const target=position ?? next;
    if(!Number.isSafeInteger(target) || target<1 || target>10000)
      throw Object.assign(new Error("موقع الطابور غير صالح"),{code:"ZUNION_BAD_POSITION"});
    if(active.some(a=>a.position===target))
      throw Object.assign(new Error("هذا الموقع أصبح مشغولاً. اختر خانة إضافة أخرى ثم أعد الحفظ."),{code:"ZUNION_SLOT_OCCUPIED"});
    await materializeSlots(client,active);
    const row = (await client.query<MachineAssignmentRow>(`insert into machine_assignments(order_id,machine_name,position,queue_position,created_by,updated_by) values($1,$2,$3,$3,$4,$4) returning *`,[orderId,machineName,target,userId])).rows[0];
    return row;
  });
}
export async function moveMachineAssignment(id: string, machineName: string, userId: string): Promise<MachineAssignmentRow | null> {
  return tx(async client => {
    await lockEmbroidery(client);
    const row = (await client.query<MachineAssignmentRow>("select * from machine_assignments where id=$1",[id])).rows[0];
    if (!row) return null;
    machineName=await requireAvailableMachine(client,machineName);
    await assertEligible(client,row.order_id);
    const active = await activeMachineAssignments(client);
    if (row.machine_name===machineName) return active.find(a=>a.id===id) ?? null;
    const source = active.filter(a=>a.machine_name===row.machine_name && a.id!==id).map(a=>a.id);
    const target = active.filter(a=>a.machine_name===machineName);
    const position = Math.max(0,...target.map(a=>a.position))+1;
    await materializeSlots(client,target);
    const updated = (await client.query<MachineAssignmentRow>("update machine_assignments set machine_name=$1,position=$2,queue_position=$2,updated_by=$3 where id=$4 returning *",[machineName,position,userId,id])).rows[0];
    await setPositions(client,source);
    return updated;
  });
}
export async function reorderMachineAssignments(machineName: string, ids: string[]): Promise<number> {
  return tx(async client => {
    await lockEmbroidery(client);
    const current = (await activeMachineAssignments(client)).filter(a=>a.machine_name===machineName);
    if(new Set(ids).size!==ids.length || current.length!==ids.length || current.some(a=>!ids.includes(a.id)))
      throw Object.assign(new Error("تغير طابور المكنة. حدّث البيانات قبل الترتيب."),{code:"ZUNION_BAD_REORDER"});
    await setPositions(client,ids); return ids.length;
  });
}
export async function removeMachineAssignment(id: string): Promise<MachineAssignmentRow | null> {
  return tx(async client => {
    await lockEmbroidery(client);
    const row = (await client.query<MachineAssignmentRow>("select * from machine_assignments where id=$1",[id])).rows[0];
    if (!row) return null;
    await assertEligible(client,row.order_id);
    const ids = (await activeMachineAssignments(client)).filter(a=>a.machine_name===row.machine_name && a.id!==id).map(a=>a.id);
    await client.query("delete from machine_assignments where id=$1",[id]);
    await setPositions(client,ids); return row;
  });
}
