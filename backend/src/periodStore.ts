import { query } from "./db.js";

/** Anything that can run SQL: the shared pool or a transaction client. */
export type SqlRunner = (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }>;

export const poolRunner: SqlRunner = (sql, params = []) => query(sql, params) as Promise<{ rows: any[]; rowCount: number | null }>;

export type AccountPeriod = {
  id: string;
  customer_id: string;
  seq: number;
  status: "active" | "closed";
  opened_at: string;
  closed_at: string | null;
  opening_balance: string | number;
  closing_balance: string | number | null;
  opened_by_name: string | null;
  closed_by_name: string | null;
  /** Drift on this closed period already settled by an adjustment row in a later period. */
  drift_absorbed?: string | number | null;
};

/**
 * Accounting periods. One customer, many periods, exactly one active at a time (enforced by a
 * partial unique index). Purely additive: nothing existing is altered or moved, and a customer's
 * first period is created lazily the first time their account is opened.
 */
export const PERIOD_DDL = `
  create table if not exists customer_account_periods (
    id uuid primary key default gen_random_uuid(),
    customer_id uuid not null,
    seq integer not null,
    status text not null default 'active' check (status in ('active', 'closed')),
    opened_at timestamptz not null default now(),
    closed_at timestamptz,
    opening_balance numeric not null default 0,
    closing_balance numeric,
    opened_by uuid references users(id) on delete set null,
    closed_by uuid references users(id) on delete set null,
    opened_by_name text,
    closed_by_name text,
    open_key text,
    created_at timestamptz not null default now(),
    unique (customer_id, seq)
  );
  create unique index if not exists customer_account_periods_one_active
    on customer_account_periods (customer_id) where status = 'active';
  create unique index if not exists customer_account_periods_open_key
    on customer_account_periods (open_key) where open_key is not null;
  alter table customer_account_transactions add column if not exists period_id uuid;
  create index if not exists customer_account_transactions_period_idx
    on customer_account_transactions (customer_id, period_id);
  create index if not exists orders_customer_created_idx
    on orders (customer_id, created_at);
  alter table customer_account_periods add column if not exists drift_absorbed numeric not null default 0;

  -- One immutable row per balance transfer between two periods of the same customer.
  create table if not exists customer_account_transfers (
    id uuid primary key default gen_random_uuid(),
    reference text not null unique,
    customer_id uuid not null,
    from_period_id uuid not null,
    to_period_id uuid not null,
    amount numeric not null,
    pre_transfer_balance numeric not null,
    closing_after numeric not null default 0,
    effective_date date not null,
    transferred_at timestamptz not null default now(),
    transferred_by uuid references users(id) on delete set null,
    transferred_by_name text,
    client_key text
  );
  create unique index if not exists customer_account_transfers_from_idx on customer_account_transfers (from_period_id);
  create unique index if not exists customer_account_transfers_to_idx on customer_account_transfers (to_period_id);
  create unique index if not exists customer_account_transfers_key_idx on customer_account_transfers (client_key) where client_key is not null;
  create index if not exists customer_account_transfers_customer_idx on customer_account_transfers (customer_id);

  create or replace function customer_account_transfers_immutable() returns trigger as $$
  begin
    raise exception 'customer_account_transfers rows are immutable (balance transfers are a permanent record)';
  end;
  $$ language plpgsql;
  drop trigger if exists customer_account_transfers_no_change on customer_account_transfers;
  create trigger customer_account_transfers_no_change
    before update or delete on customer_account_transfers
    for each row execute function customer_account_transfers_immutable();

  -- Transfer / adjustment rows live in the ledger table next to charges and payments.
  alter table customer_account_transactions add column if not exists transfer_id uuid;
  alter table customer_account_transactions drop constraint if exists customer_account_transactions_entry_type_check;
  alter table customer_account_transactions add constraint customer_account_transactions_entry_type_check
    check (entry_type in ('charge', 'payment', 'transfer_out', 'transfer_in', 'adjustment'));
`;

let ensured: Promise<void> | null = null;

/** Idempotent; also runs at boot from ensureSchema, this covers databases where boot DDL failed. */
export function ensurePeriodTables(run: SqlRunner = poolRunner): Promise<void> {
  if (!ensured) {
    ensured = run(PERIOD_DDL).then(() => undefined).catch((error) => {
      ensured = null;
      throw error;
    });
  }
  return ensured;
}

/** Test hook: forget that the tables were ensured (a fresh database needs the DDL again). */
export function resetPeriodTablesCache() {
  ensured = null;
}

export function periodError(message: string, code: string, status = 409) {
  return Object.assign(new Error(message), { code, status });
}

/**
 * Creates the customer's first period when none exists. The first period opens "at the beginning
 * of time" so every existing order and payment falls inside it, and its opening balance is the
 * customer's own recorded old balance. Existing records are not touched.
 */
export async function ensureFirstPeriod(run: SqlRunner, customerId: string): Promise<void> {
  await run(
    `insert into customer_account_periods (customer_id, seq, status, opened_at, opening_balance)
     select c.id, 1, 'active', timestamptz 'epoch', coalesce(c.old_balance, 0)
       from customers c
      where c.id = $1
        and not exists (select 1 from customer_account_periods p where p.customer_id = c.id)
     on conflict do nothing`,
    [customerId],
  );
}

export async function listPeriods(run: SqlRunner, customerId: string): Promise<AccountPeriod[]> {
  const { rows } = await run("select * from customer_account_periods where customer_id = $1 order by seq", [customerId]);
  return rows as AccountPeriod[];
}

export async function ensureActivePeriodId(run: SqlRunner, customerId: string): Promise<string> {
  await ensurePeriodTables(run);
  await ensureFirstPeriod(run, customerId);
  const { rows } = await run("select id from customer_account_periods where customer_id = $1 and status = 'active' limit 1", [customerId]);
  if (!rows[0]) throw periodError("لا توجد فترة محاسبية نشطة لهذا العميل", "ZUNION_NO_ACTIVE_PERIOD", 409);
  return rows[0].id as string;
}

/** A ledger row without a period belongs to the customer's first period. */
export async function assertRowPeriodOpen(run: SqlRunner, customerId: string, periodId: string | null): Promise<void> {
  await ensurePeriodTables(run);
  const { rows } = periodId
    ? await run("select status from customer_account_periods where id = $1", [periodId])
    : await run("select status from customer_account_periods where customer_id = $1 and seq = 1", [customerId]);
  if (rows[0]?.status === "closed") {
    throw periodError("هذه الفترة المحاسبية مغلقة ولا يمكن تعديل حركاتها", "ZUNION_PERIOD_CLOSED", 409);
  }
}
