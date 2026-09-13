import { query, tx } from "./db.js";

export type MachineAssignmentRow = {
  id: string;
  order_id: string;
  machine_name: string;
  position: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export async function loadMachineAssignment(id: string): Promise<MachineAssignmentRow | null> {
  const { rows } = await query<MachineAssignmentRow>("select * from machine_assignments where id=$1", [id]);
  return rows[0] ?? null;
}

export async function listMachineAssignments(): Promise<MachineAssignmentRow[]> {
  const { rows } = await query<MachineAssignmentRow>(
    `select a.id, a.order_id, a.machine_name, a.position, a.created_by, a.updated_by, a.created_at, a.updated_at
     from machine_assignments a
     join orders o on o.id = a.order_id
     order by a.machine_name, a.position`,
  );
  return rows;
}

export async function appendMachineAssignment(orderId: string, machineName: string, userId: string, position?: number): Promise<MachineAssignmentRow> {
  return tx(async (client) => {
    const dup = await client.query<{ id: string }>("select id from machine_assignments where order_id=$1 limit 1", [orderId]);
    if (dup.rows[0]) {
      throw Object.assign(new Error("هذا الأوردر مخصص لمكنة بالفعل"), { code: "ZUNION_ASSIGNED" });
    }
    const max = await client.query<{ max: string | null }>(
      "select max(position) as max from machine_assignments where machine_name=$1",
      [machineName],
    );
    const next = Math.max(1, Number(max.rows[0]?.max ?? 0) + 1);
    const target = Number.isInteger(position) && (position as number) >= 1 && (position as number) <= next ? position as number : next;
    if (target < next) {
      await client.query(
        `update machine_assignments set position = position + 1
         where machine_name=$1 and position >= $2`,
        [machineName, target],
      );
    }
    const inserted = await client.query<MachineAssignmentRow>(
      `insert into machine_assignments (order_id, machine_name, position, created_by, updated_by)
       values ($1,$2,$3,$4,$4) returning *`,
      [orderId, machineName, target, userId],
    );
    return inserted.rows[0];
  });
}

export async function moveMachineAssignment(id: string, machineName: string, userId: string): Promise<MachineAssignmentRow | null> {
  return tx(async (client) => {
    const current = await client.query<MachineAssignmentRow>("select * from machine_assignments where id=$1", [id]);
    const row = current.rows[0];
    if (!row) return null;
    if (row.machine_name === machineName) return row;
    await client.query(
      `update machine_assignments set position = position - 1
       where machine_name=$1 and position > $2`,
      [row.machine_name, row.position],
    );
    const max = await client.query<{ max: string | null }>(
      "select max(position) as max from machine_assignments where machine_name=$1",
      [machineName],
    );
    const position = Math.max(1, Number(max.rows[0]?.max ?? 0) + 1);
    const updated = await client.query<MachineAssignmentRow>(
      `update machine_assignments set machine_name=$1, position=$2, updated_by=$3 where id=$4 returning *`,
      [machineName, position, userId, id],
    );
    return updated.rows[0] ?? null;
  });
}

export async function reorderMachineAssignments(machineName: string, ids: string[]): Promise<number> {
  return tx(async (client) => {
    const current = await client.query<{ id: string }>(
      "select id from machine_assignments where machine_name=$1",
      [machineName],
    );
    const currentIds = new Set(current.rows.map((item) => item.id));
    if (new Set(ids).size !== ids.length) {
      throw Object.assign(new Error("لا يمكن تكرار نفس العنصر في الترتيب"), { code: "ZUNION_BAD_REORDER" });
    }
    if (ids.length !== currentIds.size || !ids.every((id) => currentIds.has(id))) {
      throw Object.assign(new Error("بيانات الترتيب غير متطابقة"), { code: "ZUNION_BAD_REORDER" });
    }
    for (let index = 0; index < ids.length; index += 1) {
      await client.query("update machine_assignments set position=$1 where id=$2", [index + 1, ids[index]]);
    }
    return ids.length;
  });
}

export async function removeMachineAssignment(id: string): Promise<MachineAssignmentRow | null> {
  return tx(async (client) => {
    const current = await client.query<MachineAssignmentRow>("select * from machine_assignments where id=$1", [id]);
    if (!current.rows[0]) return null;
    const row = current.rows[0];
    await client.query("delete from machine_assignments where id=$1", [id]);
    await client.query(
      `update machine_assignments set position = position - 1
       where machine_name=$1 and position > $2`,
      [row.machine_name, row.position],
    );
    return row;
  });
}