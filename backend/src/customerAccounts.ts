import type { PoolClient } from "pg";
import { query, tx } from "./db.js";

export async function ensureCustomerAccount(customerId: string, client?: PoolClient): Promise<string> {
  const sql = `insert into customer_accounts (customer_id) values ($1)
     on conflict (customer_id) do update set customer_id = excluded.customer_id
     returning id`;
  const result = client
    ? await client.query<{ id: string }>(sql, [customerId])
    : await query<{ id: string }>(sql, [customerId]);
  return result.rows[0].id;
}

export type CustomerTransactionRow = {
  id: string;
  account_id: string;
  customer_id: string;
  txn_date: string;
  txn_date_text: string;
  entry_type: string;
  order_id: string | null;
  order_number: string | null;
  description: string;
  logo: string;
  quantity: number;
  price: number;
  debit: number;
  credit: number;
  created_by: string | null;
  created_at: string;
};

export async function listTransactions(
  customerId: string | null,
  filters: { from?: string; to?: string; logo?: string; entryType?: string; q?: string; limit?: number; offset?: number },
): Promise<{ transactions: CustomerTransactionRow[]; total: number; totalDebit: number; totalCredit: number; openingDebit: number; openingCredit: number }> {
  const params: unknown[] = [];
  const conditions: string[] = [];

  if (customerId) { params.push(customerId); conditions.push(`t.customer_id=$${params.length}`); }
  if (filters.from) { params.push(filters.from); conditions.push(`t.txn_date >= $${params.length}`); }
  if (filters.to) { params.push(filters.to); conditions.push(`t.txn_date <= $${params.length}`); }
  if (filters.logo) { params.push(filters.logo); conditions.push(`t.logo = $${params.length}`); }
  if (filters.entryType) { params.push(filters.entryType); conditions.push(`t.entry_type = $${params.length}`); }
  if (filters.q) { params.push(`%${filters.q}%`); conditions.push(`(t.description ilike $${params.length})`); }

  const where = conditions.length ? conditions.join(" and ") : "true";

  // Opening balance: sum of earlier transactions when a period start is set
  let openingDebit = 0;
  let openingCredit = 0;
  if (filters.from) {
    const openingParams: unknown[] = [filters.from];
    const openingConditions: string[] = [`t.txn_date < $${openingParams.length}`];
    if (customerId) { openingParams.push(customerId); openingConditions.push(`t.customer_id=$${openingParams.length}`); }
    const { rows } = await query<{ debit: string; credit: string }>(
      `select coalesce(sum(debit),0) as debit, coalesce(sum(credit),0) as credit
       from customer_account_transactions t
       where ${openingConditions.join(" and ")}`,
      openingParams,
    );
    openingDebit = Number(rows[0]?.debit ?? 0);
    openingCredit = Number(rows[0]?.credit ?? 0);
  }

  const { rows: countRows } = await query<{ count: string }>(
    `select count(*) as count from customer_account_transactions t where ${where}`,
    params,
  );
  const total = Number(countRows[0]?.count ?? 0);

  const limit = Math.min(filters.limit ?? 200, 1000);
  const offset = filters.offset ?? 0;

  const { rows } = await query<CustomerTransactionRow>(
    `select t.*, to_char(t.txn_date, 'YYYY-MM-DD') as txn_date_text, o.order_number as order_number
     from customer_account_transactions t
     left join orders o on o.id = t.order_id
     where ${where}
     order by t.txn_date, t.created_at, t.id
     limit $${params.length + 1} offset $${params.length + 2}`,
    [...params, limit, offset],
  );

  const totalDebit = rows.reduce((sum, r) => sum + Number(r.debit ?? 0), 0);
  const totalCredit = rows.reduce((sum, r) => sum + Number(r.credit ?? 0), 0);

  return { transactions: rows, total, totalDebit, totalCredit, openingDebit, openingCredit };
}

export async function createTransaction(input: {
  accountId: string;
  customerId: string;
  txnDate: string;
  entryType: string;
  orderId: string | null;
  description: string;
  logo: string;
  quantity: number;
  price: number;
  debit: number;
  credit: number;
  clientKey: string;
  createdBy: string;
}): Promise<CustomerTransactionRow> {
  return tx(async (client) => {
    if (input.orderId) {
      const { rows } = await client.query<{ customer_id: string }>(
        "select customer_id from orders where id=$1",
        [input.orderId],
      );
      if (!rows[0] || rows[0].customer_id !== input.customerId) {
        throw Object.assign(new Error("الأوردر لا ينتمي لهذا العميل"), { code: "ZUNION_ORDER_MISMATCH" });
      }
    }

    const { rows: dupRows } = await client.query<{ id: string }>(
      "select id from customer_account_transactions where client_key=$1 limit 1",
      [input.clientKey],
    );
    if (dupRows[0]) return dupRows[0] as CustomerTransactionRow;

    const { rows } = await client.query<CustomerTransactionRow>(
      `insert into customer_account_transactions
       (account_id, customer_id, txn_date, entry_type, order_id, description, logo, quantity, price, debit, credit, client_key, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       returning *`,
      [
        input.accountId,
        input.customerId,
        input.txnDate,
        input.entryType,
        input.orderId,
        input.description,
        input.logo,
        input.quantity,
        input.price,
        input.debit,
        input.credit,
        input.clientKey,
        input.createdBy,
      ],
    );
    return rows[0];
  });
}

export async function deleteTransaction(txnId: string, customerId: string): Promise<boolean> {
  const { rowCount } = await query(
    "delete from customer_account_transactions where id=$1 and customer_id=$2",
    [txnId, customerId],
  );
  return (rowCount ?? 0) > 0;
}
