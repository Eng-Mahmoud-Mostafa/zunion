import type { PoolClient } from "pg";
import { query } from "./db.js";

export function nextOrderNumber() {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  return `${yy}-${now.getMonth() + 1}-${now.getDate()}-${String(Date.now()).slice(-6)}`;
}

export async function ensureCustomer(client: PoolClient, input: {
  name: string;
  code?: string;
  phone: string;
  email?: string;
  address?: string;
  source_party?: string;
  old_balance?: number;
  notes?: string;
}) {
  const existing = await client.query<{ id: string }>("select id from customers where phone = $1 limit 1", [input.phone]);
  if (existing.rows[0]) {
    await client.query(
      `update customers set name=$1, code=$2, email=coalesce($3, email), address=coalesce($4, address), source_party=$5, old_balance=coalesce($6, old_balance), notes=coalesce($7, notes)
       where id=$8`,
      [input.name, input.code ?? "", input.email || null, input.address || null, input.source_party ?? "", input.old_balance ?? null, input.notes ?? null, existing.rows[0].id],
    );
    return existing.rows[0].id;
  }
  const inserted = await client.query<{ id: string }>(
    `insert into customers (name, code, phone, email, address, source_party, old_balance, notes)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [input.name, input.code ?? "", input.phone, input.email ?? "", input.address ?? "", input.source_party ?? "", input.old_balance ?? 0, input.notes ?? ""],
  );
  return inserted.rows[0].id;
}

export async function loadOrder(id: string) {
  const { rows } = await query("select * from orders where id = $1", [id]);
  return rows[0] ?? null;
}
