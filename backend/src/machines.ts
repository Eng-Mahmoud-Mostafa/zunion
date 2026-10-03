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

export async function listMachines(): Promise<MachineRow[]> {
  const { rows } = await query<MachineRow>(`select * from machines order by position asc, created_at asc`);
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
  const { rows } = await query<MachineRow>(
    `update machines set active=false, updated_by=$1 where id=$2 returning *`,
    [userId, id],
  );
  return rows[0] ?? null;
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

export async function deleteMachine(id: string): Promise<void> {
  await query("delete from machines where id=$1", [id]);
}

/**
 * True when the machine still has queued board assignments (someone must move
 * the jobs out before the machine can be removed).
 */
export async function machineHasQueuedJobs(machineName: string): Promise<boolean> {
  const { rows } = await query<{ has: boolean }>(
    "select exists(select 1 from machine_assignments where lower(machine_name)=lower($1)) as has",
    [machineName],
  );
  return Boolean(rows[0]?.has);
}

async function machineReferencedByOrders(machineName: string): Promise<boolean> {
  const { rows } = await query<{ has: boolean }>(
    "select exists(select 1 from orders where lower(machine_name)=lower($1)) as has",
    [machineName],
  );
  return Boolean(rows[0]?.has);
}

export async function removeMachine(id: string, userId: string): Promise<{ machine: MachineRow; deactivated: boolean } | { deleted: true; machine: MachineRow } | null> {
  return tx(async (client) => {
    const current = await client.query<MachineRow>("select * from machines where id=$1", [id]);
    const row = current.rows[0];
    if (!row) return null;
    if (await machineHasQueuedJobs(row.name)) {
      throw Object.assign(new Error("هذه المكنة عليها أوردرات في الطابور، انقلها أولاً قبل مسحها"), { code: "ZUNION_MACHINE_QUEUED" });
    }
    const referenced = await machineReferencedByOrders(row.name);
    if (referenced) {
      const { rows } = await client.query<MachineRow>(
        `update machines set active=false, updated_by=$1 where id=$2 returning *`,
        [userId, id],
      );
      return { machine: rows[0], deactivated: true };
    }
    await client.query("delete from machines where id=$1", [id]);
    return { deleted: true, machine: row };
  });
}