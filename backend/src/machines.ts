import type { PoolClient } from "pg";
import { ACTIVE_EMBROIDERY_SQL, lockEmbroidery } from "./embroideryEligibility.js";
import { query, tx } from "./db.js";

export type MachineRow = {
  id: string;
  name: string;
  position: number;
  active: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export async function listMachines(client: Pick<PoolClient,"query"> = {query} as Pick<PoolClient,"query">): Promise<MachineRow[]> {
  const { rows } = await client.query<MachineRow>(`select * from machines order by position asc, created_at asc`);
  return rows;
}

export async function loadMachine(id: string): Promise<MachineRow | null> {
  const { rows } = await query<MachineRow>("select * from machines where id=$1", [id]);
  return rows[0] ?? null;
}

export async function findMachineByName(name: string): Promise<MachineRow | null> {
  const { rows } = await query<MachineRow>("select * from machines where lower(name)=lower($1)", [name]);
  return rows[0] ?? null;
}

export async function createOrReactivateMachine(name: string, userId: string): Promise<{ machine: MachineRow; reactivated: boolean }> {
  return tx(async (client) => {
    await lockEmbroidery(client);
    const existing = await client.query<MachineRow>("select * from machines where lower(name)=lower($1)", [name]);
    if (existing.rows[0]) {
      if (existing.rows[0].active) {
        throw Object.assign(new Error("هذه المكنة موجودة بالفعل"), { code: "ZUNION_MACHINE_EXISTS" });
      }
      const max = await client.query<{ max: string | null }>("select max(position) as max from machines");
      const position = Math.max(1, Number(max.rows[0]?.max ?? 0) + 1);
      const { rows } = await client.query<MachineRow>(
        `update machines set name=$1, position=$2, active=true, updated_by=$3 where id=$4 returning *`,
        [name, position, userId, existing.rows[0].id],
      );
      return { machine: rows[0], reactivated: true };
    }
    const max = await client.query<{ max: string | null }>("select max(position) as max from machines");
    const position = Math.max(1, Number(max.rows[0]?.max ?? 0) + 1);
    const inserted = await client.query<MachineRow>(
      `insert into machines (name, position, active, created_by, updated_by) values ($1, $2, true, $3, $3) returning *`,
      [name, position, userId],
    );
    return { machine: inserted.rows[0], reactivated: false };
  });
}

export async function deactivateMachine(id: string, userId: string): Promise<MachineRow | null> {
 const result=await removeMachine(id,userId,true);return result?.machine??null;
}

export async function activateMachine(id: string, userId: string): Promise<MachineRow | null> {
  const { rows } = await query<MachineRow>(
    `update machines set active=true, updated_by=$1 where id=$2 returning *`,
    [userId, id],
  );
  return rows[0] ?? null;
}

export async function renameMachine(id: string, name: string, userId: string): Promise<MachineRow | null> {
  const { rows } = await query<MachineRow>(
    `update machines set name=$1, updated_by=$2 where id=$3 returning *`,
    [name, userId, id],
  );
  return rows[0] ?? null;
}

/** Only current eligible embroidery assignments block removal, just like the board. */
export async function machineHasQueuedJobs(machineName: string,client: Pick<PoolClient,"query"> = {query} as Pick<PoolClient,"query">): Promise<boolean> {
 const {rows}=await client.query<{has:boolean}>(`select exists(select 1 from machine_assignments a join orders o on o.id=a.order_id where lower(btrim(a.machine_name))=lower(btrim($1)) and ${ACTIVE_EMBROIDERY_SQL}) as has`,[machineName]);
 return Boolean(rows[0]?.has);
}

export async function removeMachine(id: string, userId: string, deactivateOnly=false): Promise<{machine:MachineRow;deactivated:true}|{machine:MachineRow;deleted:true}|null> {
 return tx(async client=>{
  await lockEmbroidery(client);
  const row=(await client.query<MachineRow>("select * from machines where id=$1 for update",[id])).rows[0];
  if(!row)return null;
  if(await machineHasQueuedJobs(row.name,client))throw Object.assign(new Error("لا يمكن مسح المكنة: بها أوردرات تطريز نشطة في جدول التوزيع. انقل الأوردرات أو أنهِ تشغيلها أولاً."),{code:"ZUNION_MACHINE_QUEUED"});
  const referenced=(await client.query<{has:boolean}>(`select (
    exists(select 1 from orders where lower(btrim(machine_name))=lower(btrim($1)))
    or exists(select 1 from machine_assignments where lower(btrim(machine_name))=lower(btrim($1)))
    or exists(select 1 from production_stage_completions where lower(btrim(snapshot->'machine_assignment'->>'machine_name'))=lower(btrim($1)))
   ) as has`,[row.name])).rows[0]?.has;
  if(deactivateOnly||referenced){
   const saved=(await client.query<MachineRow>("update machines set active=false,updated_by=$1 where id=$2 returning *",[userId,id])).rows[0];
   return {machine:saved,deactivated:true as const};
  }
  await client.query("delete from machines where id=$1",[id]);
  return {machine:row,deleted:true as const};
 });
}

/** A narrowly scoped repair: valid orders and machine configurations never change. */
export async function reconcileMachineAssignments(log:(message:string)=>void=console.log, repairOrphans=true) {
 return tx(async client=>{
  await lockEmbroidery(client);
  let orphans=(await client.query("select a.* from machine_assignments a where not exists(select 1 from orders o where o.id=a.order_id)")).rows;
  const orphanAssignmentsFound=orphans.length;
  let orphanAssignmentsRemoved=0;
  if(orphans.length && repairOrphans){
   // Prevent a concurrent restore/insert of an order while checking and removing
   // dangling references. Re-check under the lock, then preserve each row in audit.
   await client.query("lock table orders in share mode");
   await client.query("lock table machine_assignments in share row exclusive mode");
   orphans=(await client.query("delete from machine_assignments a where not exists(select 1 from orders o where o.id=a.order_id) returning a.*")).rows;
   orphanAssignmentsRemoved=orphans.length;
   for(const row of orphans)await client.query("insert into audit_logs(action,entity_type,entity_id,old_value_json,new_value_json) values('ORPHAN_MACHINE_ASSIGNMENT_REMOVED','machine_assignments',$1,$2::jsonb,$3::jsonb)",[row.id,JSON.stringify(row),JSON.stringify({reason:"order_missing",order_id:row.order_id})]);
  }
  const machines=await client.query(`select m.id,m.name,m.active,
    (select count(*)::int from machine_assignments a join orders o on o.id=a.order_id where lower(btrim(a.machine_name))=lower(btrim(m.name)) and ${ACTIVE_EMBROIDERY_SQL}) as active_orders,
    (select count(*)::int from machine_assignments a join orders o on o.id=a.order_id where lower(btrim(a.machine_name))=lower(btrim(m.name)) and not (${ACTIVE_EMBROIDERY_SQL})) as historical_assignments
    from machines m order by m.position,m.created_at`);
  const result={orphanAssignmentsFound,orphanAssignmentsRemoved,machines:machines.rows};
  log("[machine-queue-reconciliation] "+JSON.stringify(result));return result;
 });
}
