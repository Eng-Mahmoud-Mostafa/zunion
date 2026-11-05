import { query, tx } from "./db.js";
import { createTransaction, ensureCustomerAccount, statementCtes, unionSelect } from "./customerAccounts.js";
import {
  ensureFirstPeriod,
  ensurePeriodTables,
  listPeriods,
  periodError,
  poolRunner,
  type AccountPeriod,
  type SqlRunner,
} from "./periodStore.js";

/** All money is handled as integer cents so running balances never accumulate float error. */
const cents = (value: unknown) => Math.round(Number(value ?? 0) * 100);
const money = (value: number) => value / 100;

export type LedgerRowKind = "opening" | "carried" | "charge" | "payment" | "adjustment";

export type LedgerRow = {
  id: string;
  kind: LedgerRowKind;
  txn_date_text: string;
  order_id: string | null;
  order_number: string;
  created_by_name: string | null;
  description: string;
  logo: string;
  color: string;
  quantity: number;
  price: number;
  debit: number;
  credit: number;
  balance: number;
  source: "ledger" | "order" | "system";
};

export type LedgerResult = {
  customer: { id: string; name: string; code: string | null; phone: string | null; party: string };
  periods: Array<{
    id: string;
    seq: number;
    status: "active" | "closed";
    opened_at: string;
    closed_at: string | null;
    opening_balance: number;
    closing_balance: number | null;
  }>;
  period: {
    id: string;
    seq: number;
    status: "active" | "closed";
    opened_at: string;
    closed_at: string | null;
    openingBalance: number;
    closingBalance: number;
    /** Stored closing balance of a closed period (what was carried forward). */
    snapshotClosing: number | null;
    /** Live closing minus snapshot for a closed period: orders edited after it was closed. */
    driftAfterClose: number;
  };
  summary: { operationCount: number; totalWork: number; totalPayments: number; currentBalance: number };
  rows: LedgerRow[];
  total: number;
  hasMore: boolean;
};

const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : String(value ?? ""));

async function fetchPeriodRows(run: SqlRunner, customerId: string, period: AccountPeriod) {
  const { sql: ctes, params } = statementCtes(customerId, {
    periodId: period.id,
    periodIsFirst: period.seq === 1,
    excludeDrafts: true,
  });
  const { rows } = await run(
    `with ${ctes}
     select s.*, to_char(s.txn_date, 'YYYY-MM-DD') as txn_date_text
       from (${unionSelect(ctes)}) s
      order by s.txn_date, s.created_at, s.id`,
    params,
  );
  return rows as Array<Record<string, any>>;
}

/** Live net movement (debit - credit, in cents) of one period's own rows. */
async function periodNetCents(run: SqlRunner, customerId: string, period: AccountPeriod): Promise<number> {
  const { sql: ctes, params } = statementCtes(customerId, { periodId: period.id, periodIsFirst: period.seq === 1, excludeDrafts: true });
  const { rows } = await run(
    `with ${ctes} select coalesce(sum(s.debit), 0) as debit, coalesce(sum(s.credit), 0) as credit from (${unionSelect(ctes)}) s`,
    params,
  );
  return cents(rows[0]?.debit) - cents(rows[0]?.credit);
}

/** The customer's true overall balance: old balance + every order/charge - every payment, ignoring periods. */
async function overallBalanceCents(run: SqlRunner, customerId: string, oldBalance: unknown): Promise<number> {
  const { sql: ctes, params } = statementCtes(customerId, { excludeDrafts: true });
  const { rows } = await run(
    `with ${ctes} select coalesce(sum(s.debit), 0) as debit, coalesce(sum(s.credit), 0) as credit from (${unionSelect(ctes)}) s`,
    params,
  );
  return cents(oldBalance) + cents(rows[0]?.debit) - cents(rows[0]?.credit);
}

export async function buildLedger(
  run: SqlRunner,
  customerId: string,
  opts: { periodId?: string; limit?: number; offset?: number } = {},
): Promise<LedgerResult & { _closingCents: number }> {
  await ensurePeriodTables(run);
  const { rows: customerRows } = await run(
    "select id, name, code, phone, coalesce(source_party, '') as party, old_balance from customers where id = $1",
    [customerId],
  );
  const customer = customerRows[0];
  if (!customer) throw periodError("العميل غير موجود", "ZUNION_CUSTOMER_NOT_FOUND", 404);

  await ensureFirstPeriod(run, customerId);
  const periods = await listPeriods(run, customerId);
  const active = periods.find((item) => item.status === "active");
  const period = opts.periodId ? periods.find((item) => item.id === opts.periodId) : active;
  if (!period || !active) throw periodError("الفترة المحاسبية غير موجودة لهذا العميل", "ZUNION_PERIOD_NOT_FOUND", 404);

  const isFirst = period.seq === 1;
  const openingC = isFirst ? cents(customer.old_balance) : cents(period.opening_balance);
  const periodRows = await fetchPeriodRows(run, customerId, period);

  // Orders edited after a period was closed change that period's live figures, but its closing
  // balance was already carried forward. The difference is shown in the ACTIVE period as an
  // explicit adjustment line, so the active balance always equals the true overall balance.
  let adjustmentC = 0;
  let driftAfterClose = 0;
  for (const closed of periods) {
    if (closed.status !== "closed") continue;
    const liveOpening = closed.seq === 1 ? cents(customer.old_balance) : cents(closed.opening_balance);
    const drift = liveOpening + (await periodNetCents(run, customerId, closed)) - cents(closed.closing_balance);
    if (period.status === "active") adjustmentC += drift;
    if (closed.id === period.id) driftAfterClose = drift;
  }

  const out: LedgerRow[] = [];
  let running = openingC;
  let totalWork = 0;
  let totalPayments = 0;
  let operationCount = 0;

  if (openingC !== 0) {
    out.push({
      id: `opening-${period.id}`,
      kind: isFirst ? "opening" : "carried",
      txn_date_text: iso(period.opened_at).slice(0, 10),
      order_id: null,
      order_number: "",
      created_by_name: null,
      description: isFirst ? "رصيد سابق" : "رصيد مرحّل",
      logo: "",
      color: "",
      quantity: 0,
      price: 0,
      debit: money(Math.max(openingC, 0)),
      credit: money(Math.max(-openingC, 0)),
      balance: money(openingC),
      source: "system",
    });
  }
  if (adjustmentC !== 0) {
    running += adjustmentC;
    operationCount += 1;
    out.push({
      id: `adjustment-${period.id}`,
      kind: "adjustment",
      txn_date_text: iso(period.opened_at).slice(0, 10),
      order_id: null,
      order_number: "",
      created_by_name: null,
      description: "تسوية تعديلات على فترات سابقة",
      logo: "",
      color: "",
      quantity: 0,
      price: 0,
      debit: money(Math.max(adjustmentC, 0)),
      credit: money(Math.max(-adjustmentC, 0)),
      balance: money(running),
      source: "system",
    });
  }

  for (const row of periodRows) {
    const debit = cents(row.debit);
    const credit = cents(row.credit);
    running += debit - credit;
    operationCount += 1;
    const kind: LedgerRowKind = row.entry_type === "payment" ? "payment" : "charge";
    if (kind === "charge") totalWork += debit;
    else totalPayments += credit;
    out.push({
      id: String(row.id),
      kind,
      txn_date_text: String(row.txn_date_text ?? ""),
      order_id: row.order_id ?? null,
      order_number: String(row.order_number ?? ""),
      created_by_name: row.created_by_name ?? null,
      description: String(row.description ?? ""),
      logo: String(row.logo ?? ""),
      color: String(row.color ?? ""),
      quantity: Number(row.quantity ?? 0),
      price: Number(row.price ?? 0),
      debit: money(debit),
      credit: money(credit),
      balance: money(running),
      source: row.source === "order" ? "order" : "ledger",
    });
  }

  const overallC = await overallBalanceCents(run, customerId, customer.old_balance);
  const limit = Math.min(Math.max(Number(opts.limit ?? 2000), 1), 5000);
  const offset = Math.max(Number(opts.offset ?? 0), 0);
  const slice = out.slice(offset, offset + limit);

  return {
    customer: { id: customer.id, name: customer.name, code: customer.code ?? null, phone: customer.phone ?? null, party: customer.party },
    periods: periods.map((item) => ({
      id: item.id,
      seq: item.seq,
      status: item.status,
      opened_at: iso(item.opened_at),
      closed_at: item.closed_at ? iso(item.closed_at) : null,
      opening_balance: Number(item.opening_balance),
      closing_balance: item.closing_balance === null || item.closing_balance === undefined ? null : Number(item.closing_balance),
    })),
    period: {
      id: period.id,
      seq: period.seq,
      status: period.status,
      opened_at: iso(period.opened_at),
      closed_at: period.closed_at ? iso(period.closed_at) : null,
      openingBalance: money(openingC),
      closingBalance: money(running),
      snapshotClosing: period.status === "closed" ? Number(period.closing_balance) : null,
      driftAfterClose: money(driftAfterClose),
    },
    summary: {
      operationCount,
      totalWork: money(totalWork),
      totalPayments: money(totalPayments),
      currentBalance: money(overallC),
    },
    rows: slice,
    total: out.length,
    hasMore: offset + slice.length < out.length,
    _closingCents: running,
  };
}

/**
 * Every customer's true outstanding balance in one query, using the SAME rules as the ledger
 * (old balance + orders/charges - payments, drafts excluded), independent of accounting periods.
 * Feeds the customers list and its مدينين filter.
 */
export async function getBalances(): Promise<Array<{ customer_id: string; balance: number }>> {
  const { sql: ctes, params } = statementCtes(null, { excludeDrafts: true });
  const { rows } = await query(
    `with ${ctes}
     select c.id as customer_id, c.old_balance, coalesce(s.debit, 0) as debit, coalesce(s.credit, 0) as credit
       from customers c
       left join (select u.customer_id, sum(u.debit) as debit, sum(u.credit) as credit
                    from (${unionSelect(ctes)}) u group by u.customer_id) s on s.customer_id = c.id`,
    params,
  );
  return rows.map((row: any) => ({ customer_id: row.customer_id as string, balance: money(cents(row.old_balance) + cents(row.debit) - cents(row.credit)) }));
}

export async function getLedger(customerId: string, opts: { periodId?: string; limit?: number; offset?: number } = {}) {
  const { _closingCents: _ignored, ...result } = await buildLedger(poolRunner, customerId, opts);
  return result as LedgerResult;
}

/**
 * Closes the customer's active period and opens the next one with the exact closing balance
 * carried forward. One transaction, serialised per customer by a row lock; the partial unique
 * index guarantees a single active period even if the lock were bypassed.
 */
export async function openNewPeriod(
  customerId: string,
  actor: { id: string | null; name: string | null },
  opts: { clientKey?: string; expectedPeriodId?: string | null } = {},
) {
  return tx(async (client) => {
    const run: SqlRunner = (sql, params = []) => client.query(sql, params) as Promise<{ rows: any[]; rowCount: number | null }>;
    await ensurePeriodTables(run);
    const locked = await run("select id from customers where id = $1 for update", [customerId]);
    if (!locked.rows[0]) throw periodError("العميل غير موجود", "ZUNION_CUSTOMER_NOT_FOUND", 404);

    if (opts.clientKey) {
      const repeat = await run("select * from customer_account_periods where open_key = $1 and customer_id = $2", [opts.clientKey, customerId]);
      if (repeat.rows[0]) return { period: repeat.rows[0] as AccountPeriod, previous: null, repeated: true };
    }

    await ensureFirstPeriod(run, customerId);
    const { rows: activeRows } = await run(
      "select * from customer_account_periods where customer_id = $1 and status = 'active' for update",
      [customerId],
    );
    const active = activeRows[0] as AccountPeriod | undefined;
    if (!active) throw periodError("لا توجد فترة محاسبية نشطة لهذا العميل", "ZUNION_NO_ACTIVE_PERIOD", 409);
    if (opts.expectedPeriodId && opts.expectedPeriodId !== active.id) {
      throw periodError("تم فتح حساب جديد لهذا العميل بالفعل. أعد تحميل الصفحة.", "ZUNION_PERIOD_ALREADY_OPENED", 409);
    }

    // Exact closing balance of the active period, computed under the lock.
    const ledger = await buildLedger(run, customerId, { periodId: active.id, limit: 1 });
    const closing = ledger._closingCents;

    // Read the clock AFTER the snapshot: anything created after this instant belongs to the new
    // period and cannot already be inside the snapshot.
    const clock = await run("select clock_timestamp() as now");
    const now = clock.rows[0].now;

    await run(
      `update customer_account_periods
          set status = 'closed', closed_at = $2, closing_balance = $3, closed_by = $4, closed_by_name = $5
        where id = $1`,
      [active.id, now, money(closing), actor.id, actor.name],
    );
    const inserted = await run(
      `insert into customer_account_periods (customer_id, seq, status, opened_at, opening_balance, opened_by, opened_by_name, open_key)
       values ($1, $2, 'active', $3, $4, $5, $6, $7)
       returning *`,
      [customerId, Number(active.seq) + 1, now, money(closing), actor.id, actor.name, opts.clientKey ?? null],
    );
    await ensureCustomerAccount(customerId, client);
    return { period: inserted.rows[0] as AccountPeriod, previous: { id: active.id, seq: active.seq, closing_balance: money(closing) }, repeated: false };
  });
}

const PAYMENT_METHODS: Record<string, string> = {
  cash: "كاش",
  bank_transfer: "تحويل بنكي",
  instapay: "انستا باي",
  wallet: "محفظة",
  deferred: "آجل",
  other: "أخرى",
};

export async function recordPayment(
  customerId: string,
  input: { amount: number; date: string; method: string; notes: string; clientKey: string; expectedPeriodId?: string | null; createdBy: string },
) {
  const amount = Math.round(input.amount * 100) / 100;
  const methodLabel = PAYMENT_METHODS[input.method] ?? "";
  const description = [methodLabel ? `طريقة الدفع: ${methodLabel}` : "", input.notes.trim()].filter(Boolean).join(" — ");
  await ensurePeriodTables(poolRunner);
  const accountId = await ensureCustomerAccount(customerId);
  return createTransaction({
    accountId,
    customerId,
    txnDate: input.date,
    entryType: "payment",
    orderId: null,
    description,
    logo: "",
    quantity: 0,
    price: 0,
    debit: 0,
    credit: amount,
    clientKey: input.clientKey,
    createdBy: input.createdBy,
    expectedPeriodId: input.expectedPeriodId ?? null,
  });
}

export const PAYMENT_METHOD_KEYS = Object.keys(PAYMENT_METHODS);
