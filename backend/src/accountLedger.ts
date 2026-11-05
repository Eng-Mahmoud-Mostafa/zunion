import crypto from "node:crypto";
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

export type LedgerRowKind = "opening" | "carried" | "charge" | "payment" | "adjustment" | "transfer_out" | "transfer_in";

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

type TransferRecord = {
  id: string;
  reference: string;
  customer_id: string;
  from_period_id: string;
  to_period_id: string;
  amount: string | number;
  pre_transfer_balance: string | number;
  closing_after: string | number;
  effective_text: string;
  transferred_at: Date | string;
  transferred_by_name: string | null;
};

export type ClosingSummary = {
  reference: string;
  /** الرصيد قبل الترحيل — captured at the moment of closing and never recalculated. */
  preTransferBalance: number;
  /** المبلغ المرحّل — signed. */
  transferredAmount: number;
  /** رصيد الإقفال بعد الترحيل — stored, always 0. */
  closingAfterTransfer: number;
  closedAt: string;
  effectiveDate: string;
  byName: string | null;
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
    /** Where the running balance starts (0 for a period opened by a transfer; the transfer-in row carries the amount). */
    openingBalance: number;
    /** الرصيد الافتتاحي المرحّل — the signed amount transferred in (null for the first period). */
    carriedIn: number | null;
    closingBalance: number;
    /** Balance stored when the period was closed. */
    snapshotClosing: number | null;
    /** Live closing minus stored closing for a closed period: orders edited after it was closed. */
    driftAfterClose: number;
    /** Earliest allowed date for opening the next period (active period only). */
    minOpenDate: string | null;
    /** Closed through the old carry-forward model (no transfer record). */
    legacyClose: boolean;
  };
  closing: ClosingSummary | null;
  summary: { operationCount: number; totalWork: number; totalPayments: number; currentBalance: number };
  rows: LedgerRow[];
  total: number;
  hasMore: boolean;
};

type InternalLedger = LedgerResult & {
  _closingCents: number;
  _driftItems: Array<{ periodId: string; driftCents: number }>;
  _adjustmentCents: number;
  _minOpenDate: string | null;
};

const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : String(value ?? ""));
const dateOf = (value: unknown) => iso(value).slice(0, 10);

async function fetchPeriodRows(run: SqlRunner, customerId: string, period: AccountPeriod) {
  const { sql: ctes, params } = statementCtes(customerId, {
    periodId: period.id,
    periodIsFirst: period.seq === 1,
    excludeDrafts: true,
    includeSystem: true,
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

/** Live net movement (debit - credit, in cents) of a period's rows, INCLUDING its transfer rows. */
async function periodNetCents(run: SqlRunner, customerId: string, period: AccountPeriod): Promise<number> {
  const { sql: ctes, params } = statementCtes(customerId, { periodId: period.id, periodIsFirst: period.seq === 1, excludeDrafts: true, includeSystem: true });
  const { rows } = await run(
    `with ${ctes} select coalesce(sum(s.debit), 0) as debit, coalesce(sum(s.credit), 0) as credit from (${unionSelect(ctes)}) s`,
    params,
  );
  return cents(rows[0]?.debit) - cents(rows[0]?.credit);
}

/** The customer's true overall balance: old balance + every order/charge - every payment (no transfers, no periods). */
async function overallBalanceCents(run: SqlRunner, customerId: string, oldBalance: unknown): Promise<number> {
  const { sql: ctes, params } = statementCtes(customerId, { excludeDrafts: true });
  const { rows } = await run(
    `with ${ctes} select coalesce(sum(s.debit), 0) as debit, coalesce(sum(s.credit), 0) as credit from (${unionSelect(ctes)}) s`,
    params,
  );
  return cents(oldBalance) + cents(rows[0]?.debit) - cents(rows[0]?.credit);
}

async function listTransfers(run: SqlRunner, customerId: string): Promise<TransferRecord[]> {
  const { rows } = await run(
    `select t.*, to_char(t.effective_date, 'YYYY-MM-DD') as effective_text
       from customer_account_transfers t where t.customer_id = $1 order by t.transferred_at`,
    [customerId],
  );
  return rows as TransferRecord[];
}

export async function buildLedger(
  run: SqlRunner,
  customerId: string,
  opts: { periodId?: string; limit?: number; offset?: number } = {},
): Promise<InternalLedger> {
  await ensurePeriodTables(run);
  const { rows: customerRows } = await run(
    "select id, name, code, phone, coalesce(source_party, '') as party, old_balance from customers where id = $1",
    [customerId],
  );
  const customer = customerRows[0];
  if (!customer) throw periodError("العميل غير موجود", "ZUNION_CUSTOMER_NOT_FOUND", 404);

  await ensureFirstPeriod(run, customerId);
  const periods = await listPeriods(run, customerId);
  const transfers = await listTransfers(run, customerId);
  const active = periods.find((item) => item.status === "active");
  const period = opts.periodId ? periods.find((item) => item.id === opts.periodId) : active;
  if (!period || !active) throw periodError("الفترة المحاسبية غير موجودة لهذا العميل", "ZUNION_PERIOD_NOT_FOUND", 404);

  const incomingOf = (p: AccountPeriod) => transfers.find((t) => t.to_period_id === p.id);
  const outgoingOf = (p: AccountPeriod) => transfers.find((t) => t.from_period_id === p.id);
  /** Where a period's running balance starts. A period opened by a transfer starts at 0: its transfer-in row carries the amount. */
  const startCents = (p: AccountPeriod) => (p.seq === 1 ? cents(customer.old_balance) : incomingOf(p) ? 0 : cents(p.opening_balance));

  const isFirst = period.seq === 1;
  const incoming = incomingOf(period);
  const outgoing = outgoingOf(period);
  const openingC = startCents(period);
  const periodRows = await fetchPeriodRows(run, customerId, period);

  // Orders edited after a period was closed change that period's live figures. Drift that has not yet
  // been settled by an adjustment row is shown in the ACTIVE period so its balance equals the true one.
  let adjustmentC = 0;
  let driftAfterClose = 0;
  const driftItems: Array<{ periodId: string; driftCents: number }> = [];
  for (const closed of periods) {
    if (closed.status !== "closed") continue;
    const live = startCents(closed) + (await periodNetCents(run, customerId, closed)) - cents(closed.closing_balance);
    const unabsorbed = live - cents(closed.drift_absorbed);
    if (closed.id === period.id) driftAfterClose = live;
    if (unabsorbed !== 0) driftItems.push({ periodId: closed.id, driftCents: unabsorbed });
    if (period.status === "active") adjustmentC += unabsorbed;
  }

  const out: LedgerRow[] = [];
  let running = openingC;
  let totalWork = 0;
  let totalPayments = 0;
  let operationCount = 0;

  const needsVirtualOpening = openingC !== 0;
  if (needsVirtualOpening) {
    out.push({
      id: `opening-${period.id}`,
      kind: isFirst ? "opening" : "carried",
      txn_date_text: dateOf(period.opened_at),
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

  // Persisted internal rows are placed deliberately: transfer-in first, then adjustments, then the
  // ordinary rows in date order, and the transfer-out always last (so the period ends at 0).
  const kindOf = (row: Record<string, any>): LedgerRowKind =>
    row.entry_type === "payment" ? "payment"
    : row.entry_type === "transfer_in" ? "transfer_in"
    : row.entry_type === "transfer_out" ? "transfer_out"
    : row.entry_type === "adjustment" ? "adjustment"
    : "charge";
  const ins = periodRows.filter((r) => kindOf(r) === "transfer_in");
  const adjs = periodRows.filter((r) => kindOf(r) === "adjustment");
  const outs = periodRows.filter((r) => kindOf(r) === "transfer_out");
  const middle = periodRows.filter((r) => !["transfer_in", "adjustment", "transfer_out"].includes(kindOf(r)));

  const pushRow = (row: Record<string, any>) => {
    const debit = cents(row.debit);
    const credit = cents(row.credit);
    running += debit - credit;
    const kind = kindOf(row);
    if (kind === "charge") { totalWork += debit; operationCount += 1; }
    else if (kind === "payment") { totalPayments += credit; operationCount += 1; }
    else if (kind === "adjustment") operationCount += 1;
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
  };

  ins.forEach(pushRow);
  if (adjustmentC !== 0) {
    running += adjustmentC;
    operationCount += 1;
    out.push({
      id: `adjustment-${period.id}`,
      kind: "adjustment",
      txn_date_text: dateOf(period.opened_at),
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
  adjs.forEach(pushRow);
  middle.forEach(pushRow);
  outs.forEach(pushRow);

  // Earliest sensible date for opening the next period: not before this period began and not before
  // anything already recorded in it (recorded date, not delivery date).
  let minOpenDate: string | null = null;
  if (period.status === "active") {
    const candidates = [isFirst ? "" : dateOf(period.opened_at), ...middle.map((r) => dateOf(r.created_at))].filter(Boolean);
    minOpenDate = candidates.length ? candidates.sort().slice(-1)[0] : null;
  }

  const overallC = await overallBalanceCents(run, customerId, customer.old_balance);
  const limit = Math.min(Math.max(Number(opts.limit ?? 2000), 1), 5000);
  const offset = Math.max(Number(opts.offset ?? 0), 0);
  const slice = out.slice(offset, offset + limit);

  const closing: ClosingSummary | null = outgoing
    ? {
        reference: outgoing.reference,
        preTransferBalance: Number(outgoing.pre_transfer_balance),
        transferredAmount: Number(outgoing.amount),
        closingAfterTransfer: Number(outgoing.closing_after),
        closedAt: iso(outgoing.transferred_at),
        effectiveDate: outgoing.effective_text,
        byName: outgoing.transferred_by_name,
      }
    : null;

  return {
    customer: { id: customer.id, name: customer.name, code: customer.code ?? null, phone: customer.phone ?? null, party: customer.party },
    periods: periods.map((item) => ({
      id: item.id,
      seq: item.seq,
      status: item.status,
      opened_at: iso(item.opened_at),
      closed_at: item.closed_at ? iso(item.closed_at) : null,
      opening_balance: incomingOf(item) ? Number(incomingOf(item)!.amount) : Number(item.opening_balance),
      closing_balance: item.closing_balance === null || item.closing_balance === undefined ? null : Number(item.closing_balance),
    })),
    period: {
      id: period.id,
      seq: period.seq,
      status: period.status,
      opened_at: iso(period.opened_at),
      closed_at: period.closed_at ? iso(period.closed_at) : null,
      openingBalance: money(openingC),
      carriedIn: incoming ? Number(incoming.amount) : isFirst ? null : Number(period.opening_balance),
      closingBalance: money(running),
      snapshotClosing: period.status === "closed" ? Number(period.closing_balance) : null,
      driftAfterClose: money(driftAfterClose),
      minOpenDate,
      legacyClose: period.status === "closed" && !outgoing,
    },
    closing,
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
    _driftItems: driftItems,
    _adjustmentCents: adjustmentC,
    _minOpenDate: minOpenDate,
  };
}

export async function getLedger(customerId: string, opts: { periodId?: string; limit?: number; offset?: number } = {}) {
  const { _closingCents, _driftItems, _adjustmentCents, _minOpenDate, ...result } = await buildLedger(poolRunner, customerId, opts);
  void _closingCents; void _driftItems; void _adjustmentCents; void _minOpenDate;
  return result as LedgerResult;
}

/**
 * Every customer's true outstanding balance in one query, using the SAME rules as the ledger
 * (old balance + orders/charges - payments, drafts excluded), independent of accounting periods.
 * Internal transfer rows are excluded, so they can never create or hide debt. Feeds the customers
 * list and its مدينين filter.
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

const transferReference = (now: Date) =>
  `TR-${now.toISOString().slice(0, 10).replace(/-/g, "")}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

/**
 * Closes the customer's active period at zero through an internal balance transfer and opens the next
 * period with the exact balance carried in. One transaction, serialised per customer by a row lock; the
 * partial unique indexes guarantee a single active period and a single transfer per period even if the
 * lock were bypassed. Any failure rolls the whole operation back.
 */
export async function openNewPeriod(
  customerId: string,
  actor: { id: string | null; name: string | null },
  opts: { clientKey?: string; expectedPeriodId?: string | null; effectiveDate?: string | null } = {},
) {
  return tx(async (client) => {
    const run: SqlRunner = (sql, params = []) => client.query(sql, params) as Promise<{ rows: any[]; rowCount: number | null }>;
    await ensurePeriodTables(run);
    const locked = await run("select id from customers where id = $1 for update", [customerId]);
    if (!locked.rows[0]) throw periodError("العميل غير موجود", "ZUNION_CUSTOMER_NOT_FOUND", 404);

    if (opts.clientKey) {
      const repeat = await run("select * from customer_account_periods where open_key = $1 and customer_id = $2", [opts.clientKey, customerId]);
      if (repeat.rows[0]) {
        const t = (await run("select * from customer_account_transfers where to_period_id = $1", [repeat.rows[0].id])).rows[0];
        return { period: repeat.rows[0] as AccountPeriod, previous: null, repeated: true, reference: t?.reference ?? null, preTransferBalance: t ? Number(t.pre_transfer_balance) : null };
      }
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

    // The authoritative balance of the active period, computed under the lock.
    const ledger = await buildLedger(run, customerId, { periodId: active.id, limit: 1 });
    const balanceC = ledger._closingCents;

    // The selected date is the accounting date of the transfer. It may not be in the future and may not
    // precede the period's own start or anything already recorded in it.
    const today = (await run("select current_date::text as d, (current_date + 1)::text as tomorrow")).rows[0];
    const effective = (opts.effectiveDate && String(opts.effectiveDate)) || today.d;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effective) || Number.isNaN(new Date(`${effective}T00:00:00Z`).getTime())) {
      throw periodError("تاريخ فتح الحساب الجديد غير صحيح", "ZUNION_BAD_OPEN_DATE", 400);
    }
    if (effective > today.tomorrow) throw periodError("لا يمكن أن يكون تاريخ فتح الحساب الجديد في المستقبل", "ZUNION_BAD_OPEN_DATE", 400);
    if (ledger._minOpenDate && effective < ledger._minOpenDate) {
      throw periodError(`لا يمكن أن يسبق تاريخ فتح الحساب الجديد آخر حركة مسجلة في الحساب الحالي (${ledger._minOpenDate})`, "ZUNION_BAD_OPEN_DATE", 400);
    }

    const accountId = await ensureCustomerAccount(customerId, client);
    const reference = transferReference(new Date());

    // Read the clock AFTER the snapshot: anything created after this instant belongs to the new period.
    const now = (await run("select clock_timestamp() as now")).rows[0].now;

    // 1) Settle unreconciled edits to older orders with ONE persisted adjustment row (and mark them absorbed),
    //    so this period's own balance, and therefore the transfer, is exactly what the customer owes.
    if (ledger._adjustmentCents !== 0) {
      const adj = ledger._adjustmentCents;
      await run(
        `insert into customer_account_transactions
           (account_id, customer_id, txn_date, entry_type, description, debit, credit, client_key, created_by, period_id)
         values ($1,$2,$3,'adjustment','تسوية تعديلات على فترات سابقة',$4,$5,$6,$7,$8)`,
        [accountId, customerId, effective, money(Math.max(adj, 0)), money(Math.max(-adj, 0)), `${reference}:adj`, actor.id, active.id],
      );
      for (const item of ledger._driftItems) {
        await run("update customer_account_periods set drift_absorbed = drift_absorbed + $2 where id = $1", [item.periodId, money(item.driftCents)]);
      }
    }

    // 2) Close the old period at zero and open the new one.
    await run(
      `update customer_account_periods
          set status = 'closed', closed_at = $2, closing_balance = 0, closed_by = $3, closed_by_name = $4
        where id = $1`,
      [active.id, now, actor.id, actor.name],
    );
    const inserted = await run(
      `insert into customer_account_periods (customer_id, seq, status, opened_at, opening_balance, opened_by, opened_by_name, open_key)
       values ($1, $2, 'active', $3, $4, $5, $6, $7)
       returning *`,
      [customerId, Number(active.seq) + 1, now, money(balanceC), actor.id, actor.name, opts.clientKey ?? null],
    );
    const next = inserted.rows[0] as AccountPeriod;

    // 3) The permanent transfer record (immutable) links old and new period and keeps the pre-transfer balance.
    const transfer = (await run(
      `insert into customer_account_transfers
         (reference, customer_id, from_period_id, to_period_id, amount, pre_transfer_balance, closing_after, effective_date, transferred_at, transferred_by, transferred_by_name, client_key)
       values ($1,$2,$3,$4,$5,$6,0,$7,$8,$9,$10,$11)
       returning id`,
      [reference, customerId, active.id, next.id, money(balanceC), money(balanceC), effective, now, actor.id, actor.name, opts.clientKey ?? null],
    )).rows[0];

    // 4) The two ledger entries (none for a zero balance: no artificial amounts).
    if (balanceC !== 0) {
      const amountOut = money(Math.abs(balanceC));
      const insertRow = (type: string, description: string, debit: number, credit: number, periodId: string, suffix: string) =>
        run(
          `insert into customer_account_transactions
             (account_id, customer_id, txn_date, entry_type, description, debit, credit, client_key, created_by, period_id, transfer_id)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [accountId, customerId, effective, type, description, debit, credit, `${reference}:${suffix}`, actor.id, periodId, transfer.id],
        );
      // Old period: a positive balance is cleared by a CREDIT, a credit balance by a DEBIT.
      await insertRow("transfer_out", "ترحيل رصيد إلى الحساب الجديد", balanceC < 0 ? amountOut : 0, balanceC > 0 ? amountOut : 0, active.id, "out");
      // New period: the same amount, same sign, as its opening balance.
      await insertRow("transfer_in", "رصيد مرحّل من الحساب السابق", balanceC > 0 ? amountOut : 0, balanceC < 0 ? amountOut : 0, next.id, "in");
    }

    return {
      period: next,
      previous: { id: active.id, seq: active.seq, pre_transfer_balance: money(balanceC), closing_balance: 0 },
      repeated: false,
      reference,
      preTransferBalance: money(balanceC),
    };
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
