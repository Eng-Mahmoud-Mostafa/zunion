import type { PoolClient } from "pg";
import { query } from "./db.js";

export async function nextOrderNumber(client: PoolClient) {
  const { rows } = await client.query<{ n: string }>("select lpad(nextval('orders_number_seq')::text, 5, '0') as n");
  return rows[0]?.n ?? "";
}

export async function ensureCustomer(client: PoolClient, input: {
  name: string;
  code?: string;
  phone: string;
  email?: string;
  address?: string;
  source_party?: string;
  source_party_id?: string | null;
  old_balance?: number;
  notes?: string;
}) {
  const incomingPartyId = input.source_party_id ? String(input.source_party_id) : "";
  let resolvedPartyId = incomingPartyId;
  const incomingPartyName = (input.source_party ?? "").trim();
  if (resolvedPartyId) {
    const pid = await client.query<{ id: string }>("select id from parties where id=$1 limit 1", [resolvedPartyId]);
    if (!pid.rows[0]) resolvedPartyId = "";
  }
  if (!resolvedPartyId && incomingPartyName) {
    const pid = await client.query<{ id: string }>("select id from parties where lower(btrim(name)) = lower($1) limit 1", [incomingPartyName]);
    resolvedPartyId = pid.rows[0]?.id ?? "";
  }
  const existing = await client.query<{ id: string; source_party_id: string | null; source_party: string | null }>(
    "select id, source_party_id, source_party from customers where phone = $1 limit 1",
    [input.phone],
  );
  if (existing.rows[0]) {
    const row = existing.rows[0];
    const existingPartyId = row.source_party_id ? String(row.source_party_id) : "";
    const existingPartyName = (row.source_party ?? "").trim();
    const existingHasParty = Boolean(existingPartyId || existingPartyName);
    const incomingHasParty = Boolean(resolvedPartyId || incomingPartyName);
    if (existingHasParty && incomingHasParty) {
      const partiesMatch =
        (resolvedPartyId && existingPartyId && resolvedPartyId === existingPartyId) ||
        (!resolvedPartyId && !existingPartyId && existingPartyName.toLowerCase() === incomingPartyName.toLowerCase());
      if (!partiesMatch) {
        const err: Error & { code?: string } = new Error("الطرف المختار لا يطابق طرف العميل");
        err.code = "ZUNION_PARTY_MISMATCH";
        throw err;
      }
    }
    const partyIdToStore = existingPartyId || resolvedPartyId || null;
    const partyNameToStore = existingPartyName || incomingPartyName;
    await client.query(
      `update customers set name=$1, code=$2, email=coalesce($3, email), address=coalesce($4, address), source_party=$5, source_party_id=$6, old_balance=coalesce($7, old_balance), notes=coalesce($8, notes)
       where id=$9`,
      [input.name, input.code ?? "", input.email || null, input.address || null, partyNameToStore, partyIdToStore, input.old_balance ?? null, input.notes ?? null, row.id],
    );
    return row.id;
  }
  const inserted = await client.query<{ id: string }>(
    `insert into customers (name, code, phone, email, address, source_party, source_party_id, old_balance, notes)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [input.name, input.code ?? "", input.phone, input.email ?? "", input.address ?? "", incomingPartyName, resolvedPartyId || null, input.old_balance ?? 0, input.notes ?? ""],
  );
  return inserted.rows[0].id;
}

export async function loadOrder(id: string) {
  const { rows } = await query("select * from orders where id = $1", [id]);
  return rows[0] ?? null;
}
