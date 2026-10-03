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
  customer_id: string;
  txn_date: string;
  txn_date_text: string;
  entry_type: string;
  order_id: string | null;
  order_number: string | null;
  customer_name: string;
  description: string;
  logo: string;
  quantity: number;
  price: number;
  debit: number;
  credit: number;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  /** "ledger" for manually posted rows, "order" for rows derived from saved orders. */
  source: "ledger" | "order";
};

export type StatementFilters = {
  from?: string;
  to?: string;
  logo?: string;
  entryType?: string;
  q?: string;
  orderId?: string;
  limit?: number;
  offset?: number;
};

/** Orders carry their own money; the ledger only holds manual postings. */
const ORDER_DATE = "coalesce(o.delivery_date, o.created_at::date)";
const ORDER_LOGO = "coalesce(nullif(lg.logo_place, ''), nullif(p.logo_placement, ''), '')";
/**
 * The live customer record wins, because a payment posted without an order has
 * no order snapshot to borrow a name from. Only then fall back to the snapshot
 * and finally the description, which is the best guess left.
 */
const LEDGER_CUSTOMER = "coalesce(nullif(c.name, ''), nullif(o.customer_name_snapshot, ''), nullif(t.description, ''), '')";
const ORDER_CUSTOMER = "coalesce(nullif(c.name, ''), nullif(o.customer_name_snapshot, ''), '')";

/**
 * Builds the statement as a union of three sources so a customer (or every
 * customer) shows their recorded work without anybody having to post it:
 *
 *   ledger        - manually posted charges and payments (payments may have no order)
 *   order_charge  - the saved work value of each order, unless a manual charge
 *                   for that order already exists (so nothing is counted twice)
 *   order_payment - the saved paid amount of each order, under the same rule
 *
 * `not exists` deliberately ignores the active filters: narrowing the view must
 * never resurrect an order's own row next to a manual one.
 */
function statementCtes(customerId: string | null, filters: StatementFilters): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const ledgerCond: string[] = [];
  if (customerId) { params.push(customerId); ledgerCond.push(`t.customer_id=$${params.length}`); }
  if (filters.from) { params.push(filters.from); ledgerCond.push(`t.txn_date >= $${params.length}`); }
  if (filters.to) { params.push(filters.to); ledgerCond.push(`t.txn_date <= $${params.length}`); }
  if (filters.logo) { params.push(filters.logo); ledgerCond.push(`t.logo = $${params.length}`); }
  if (filters.orderId) { params.push(filters.orderId); ledgerCond.push(`t.order_id = $${params.length}`); }
  if (filters.entryType) { params.push(filters.entryType); ledgerCond.push(`t.entry_type = $${params.length}`); }
  if (filters.q) {
    params.push(`%${filters.q}%`);
    ledgerCond.push(`(t.description ilike $${params.length} or coalesce(o.order_number, '') ilike $${params.length} or coalesce(c.name, '') ilike $${params.length})`);
  }

  const orderCond: string[] = [];
  if (customerId) { params.push(customerId); orderCond.push(`o.customer_id=$${params.length}`); }
  if (filters.from) { params.push(filters.from); orderCond.push(`${ORDER_DATE} >= $${params.length}`); }
  if (filters.to) { params.push(filters.to); orderCond.push(`${ORDER_DATE} <= $${params.length}`); }
  if (filters.logo) { params.push(filters.logo); orderCond.push(`${ORDER_LOGO} = $${params.length}`); }
  if (filters.orderId) { params.push(filters.orderId); orderCond.push(`o.id = $${params.length}`); }
  if (filters.q) {
    params.push(`%${filters.q}%`);
    orderCond.push(`(coalesce(o.order_number, '') ilike $${params.length} or coalesce(c.name, '') ilike $${params.length} or coalesce(o.customer_name_snapshot, '') ilike $${params.length})`);
  }
  const orderWhere = orderCond.length ? orderCond.join(" and ") : "true";

  const parts = [
    `ledger as (
       select t.id::text as id, t.customer_id, t.txn_date, t.entry_type, t.order_id,
coalesce(o.order_number, '') as order_number,
          ${LEDGER_CUSTOMER} as customer_name,
          t.description, t.logo, t.quantity, t.price, t.debit, t.credit,
          t.created_by, coalesce(nullif(u.full_name, ''), u.username) as created_by_name,
          t.created_at, 'ledger'::text as source
        from customer_account_transactions t
        left join orders o on o.id = t.order_id
        left join customers c on c.id = t.customer_id
        left join users u on u.id = t.created_by
       where ${ledgerCond.length ? ledgerCond.join(" and ") : "true"}
     )`,
  ];

  if (filters.entryType !== "payment") {
    parts.push(`order_charge as (
       select 'oc-' || o.id::text as id, o.customer_id, ${ORDER_DATE} as txn_date, 'charge'::text as entry_type, o.id as order_id,
         coalesce(o.order_number, '') as order_number, ${ORDER_CUSTOMER} as customer_name,
         coalesce(nullif(o.product_name_snapshot, ''), nullif(o.type, ''), 'شغل') as description,
         ${ORDER_LOGO} as logo, o.quantity::numeric as quantity, o.price as price,
         o.total as debit, 0::numeric as credit,
         o.created_by, coalesce(nullif(u.full_name, ''), u.username) as created_by_name,
         o.created_at, 'order'::text as source
       from orders o
       left join customers c on c.id = o.customer_id
       left join products p on p.id = o.product_id
       left join lateral (select oi.logo_place from order_items oi where oi.order_id = o.id and coalesce(oi.logo_place, '') <> '' order by oi.id limit 1) lg on true
       left join users u on u.id = o.created_by
       where o.total <> 0 and ${orderWhere}
         and not exists (select 1 from customer_account_transactions c where c.order_id = o.id and c.entry_type = 'charge')
     )`);
  }

  if (filters.entryType !== "charge") {
    parts.push(`order_payment as (
       select 'op-' || o.id::text as id, o.customer_id, ${ORDER_DATE} as txn_date, 'payment'::text as entry_type, o.id as order_id,
         coalesce(o.order_number, '') as order_number, ${ORDER_CUSTOMER} as customer_name,
         'دفعة على الأوردر' as description,
         ${ORDER_LOGO} as logo, 0::numeric as quantity, 0::numeric as price,
         0::numeric as debit, o.paid as credit,
         o.created_by, coalesce(nullif(u.full_name, ''), u.username) as created_by_name,
         o.created_at, 'order'::text as source
       from orders o
       left join customers c on c.id = o.customer_id
       left join products p on p.id = o.product_id
       left join lateral (select oi.logo_place from order_items oi where oi.order_id = o.id and coalesce(oi.logo_place, '') <> '' order by oi.id limit 1) lg on true
       left join users u on u.id = o.created_by
       where o.paid <> 0 and ${orderWhere}
         and not exists (select 1 from customer_account_transactions c where c.order_id = o.id and c.entry_type = 'payment')
     )`);
  }

  return { sql: parts.join(",\n"), params };
}

function unionSelect(ctes: string): string {
  const names = ["ledger", "order_charge", "order_payment"].filter((name) => ctes.includes(`${name} as (`));
  return names.map((name) => `select * from ${name}`).join("\n union all\n");
}

export async function listTransactions(
  customerId: string | null,
  filters: StatementFilters,
): Promise<{
  transactions: CustomerTransactionRow[];
  total: number;
  hasMore: boolean;
  /** Totals over every matching row, not just the returned page. */
  totalDebit: number;
  totalCredit: number;
  openingDebit: number;
  openingCredit: number;
  openingBalance: number;
  balance: number;
}> {
  const { sql: ctes, params } = statementCtes(customerId, filters);
  const union = unionSelect(ctes);

  const limit = Math.min(Math.max(Number(filters.limit ?? 500), 1), 5000);
  const offset = Math.max(Number(filters.offset ?? 0), 0);

  // Totals and the row count come from the full matching set so the balance is
  // right even when the caller is paging through the results.
  const { rows: totalRows } = await query<{ count: string; debit: string; credit: string }>(
    `with ${ctes}
     select count(*)::text as count, coalesce(sum(s.debit), 0) as debit, coalesce(sum(s.credit), 0) as credit
     from (${union}) s`,
    params,
  );
  const total = Number(totalRows[0]?.count ?? 0);
  const totalDebit = Number(totalRows[0]?.debit ?? 0);
  const totalCredit = Number(totalRows[0]?.credit ?? 0);

  const { rows } = await query<CustomerTransactionRow>(
    `with ${ctes}
     select s.*, to_char(s.txn_date, 'YYYY-MM-DD') as txn_date_text
     from (${union}) s
     order by s.txn_date, s.created_at, s.id
     limit $${params.length + 1} offset $${params.length + 2}`,
    [...params, limit, offset],
  );

  // Opening balance is the customer's own recorded opening balance plus every
  // movement dated before the requested period, so a filtered period still
  // starts from the true carried-forward figure.
  let openingBalance = 0;
  {
    const openParams: unknown[] = [];
    let openCustomer = "";
    if (customerId) { openParams.push(customerId); openCustomer = ` and c.id = $${openParams.length}`; }
    const { rows: openRows } = await query<{ amount: string }>(
      `select coalesce(sum(c.old_balance), 0) as amount from customers c where true${openCustomer}`,
      openParams,
    );
    openingBalance = Number(openRows[0]?.amount ?? 0);

    if (filters.from) {
      const priorFilters: StatementFilters = { from: undefined, to: undefined, logo: undefined, entryType: undefined, q: undefined, orderId: filters.orderId };
      const { sql: priorCtes, params: priorParams } = statementCtes(customerId, priorFilters);
      const priorUnion = unionSelect(priorCtes);
      const fromParam = priorParams.length + 1;
      const { rows: priorRows } = await query<{ debit: string; credit: string }>(
        `with ${priorCtes}
         select coalesce(sum(s.debit), 0) as debit, coalesce(sum(s.credit), 0) as credit
         from (${priorUnion}) s
         where s.txn_date < $${fromParam}`,
        [...priorParams, filters.from],
      );
      openingBalance += Number(priorRows[0]?.debit ?? 0) - Number(priorRows[0]?.credit ?? 0);
    }
  }

  const openingDebit = openingBalance > 0 ? openingBalance : 0;
  const openingCredit = openingBalance < 0 ? -openingBalance : 0;

  return {
    transactions: rows,
    total,
    hasMore: offset + rows.length < total,
    totalDebit,
    totalCredit,
    openingDebit,
    openingCredit,
    openingBalance,
    balance: openingBalance + totalDebit - totalCredit,
  };
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

    try {
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
    } catch (error) {
      if (error instanceof Error && (error as { code?: string }).code === "23505") {
        throw Object.assign(new Error("هذا الأوردر مدين بالفعل في كشف العميل"), { code: "ZUNION_ORDER_ALREADY_CHARGED" });
      }
      throw error;
    }
  });
}

export async function updateTransaction(
  txnId: string,
  customerId: string,
  fields: {
    txnDate?: string;
    description?: string;
    logo?: string;
    quantity?: number;
    price?: number;
    credit?: number;
  },
): Promise<CustomerTransactionRow | null> {
  const { rows: existingRows } = await query<CustomerTransactionRow>(
    "select * from customer_account_transactions where id=$1 and customer_id=$2",
    [txnId, customerId],
  );
  const existing = existingRows[0];
  if (!existing) return null;

  let quantity = Number(existing.quantity);
  let price = Number(existing.price);
  let credit = Number(existing.credit);
  if (fields.quantity !== undefined) quantity = Number(fields.quantity);
  if (fields.price !== undefined) price = Number(fields.price);
  if (fields.credit !== undefined) credit = Number(fields.credit);

  let debit: number;
  if (existing.entry_type === "charge") {
    debit = Math.round(quantity * price * 100) / 100;
    credit = 0;
  } else {
    debit = 0;
    credit = Math.round(credit * 100) / 100;
  }

  const { rows } = await query<CustomerTransactionRow>(
    `update customer_account_transactions set
       txn_date = coalesce($1::date, txn_date),
       description = coalesce($2, description),
       logo = coalesce($3, logo),
       quantity = $4,
       price = $5,
       debit = $6,
       credit = $7
     where id = $8 and customer_id = $9
     returning *`,
    [fields.txnDate ?? null, fields.description ?? null, fields.logo ?? null, quantity, price, debit, credit, txnId, customerId],
  );
  return rows[0] ?? null;
}

export async function deleteTransaction(txnId: string, customerId: string): Promise<boolean> {
  const { rowCount } = await query(
    "delete from customer_account_transactions where id=$1 and customer_id=$2",
    [txnId, customerId],
  );
  return (rowCount ?? 0) > 0;
}
