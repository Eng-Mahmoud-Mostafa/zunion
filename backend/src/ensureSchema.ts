import { query, databaseAvailable } from "./db.js";
import { schemaSql } from "./schema.js";

/**
 * Every `orders` column the backend reads or writes. Applied as `add column
 * if not exists` for whichever are missing, so an existing database that has
 * drifted from the current schema (e.g. a production DB that was never
 * re-migrated after the file gained new columns) heals itself at boot without
 * touching existing rows. Each statement is guarded individually so one
 * failure can never prevent the server from starting.
 */
const REQUIRED_ORDER_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ["id", "uuid primary key"],
  ["order_number", "text unique not null"],
  ["customer_id", "uuid references customers(id) on delete set null"],
  ["source_party", "text"],
  ["customer_name_snapshot", "text not null"],
  ["customer_code_snapshot", "text"],
  ["phone_snapshot", "text not null"],
  ["delivery_date", "date"],
  ["type", "text"],
  ["product_id", "uuid"],
  ["product_name_snapshot", "text"],
  ["payment_method", "text not null default 'cash'"],
  ["custom_payment_method", "text"],
  ["materials_status", "text not null default ''"],
  ["machine_name", "text not null default ''"],
  ["worker_name", "text not null default ''"],
  ["sewing_worker", "text not null default ''"],
  ["sewing_status", "text not null default ''"],
  ["printing_worker", "text not null default ''"],
  ["printing_status", "text not null default ''"],
  ["finishing_worker", "text not null default ''"],
  ["finishing_status", "text not null default ''"],
  ["operation_methods", "jsonb not null default '[]'::jsonb"],
  ["operation_attachments", "jsonb not null default '[]'::jsonb"],
  ["operation_workers", "jsonb not null default '[]'::jsonb"],
  ["operation_supervisors", "jsonb not null default '[]'::jsonb"],
  ["quantity", "integer not null default 1"],
  ["price", "numeric not null default 0"],
  ["total", "numeric not null default 0"],
  ["paid", "numeric not null default 0"],
  ["remaining", "numeric not null default 0"],
  ["old_account", "numeric not null default 0"],
  ["net_account", "numeric not null default 0"],
  ["status", "order_status not null default 'NEW'"],
  ["work_stage", "text not null default 'new'"],
  ["notes", "text"],
  ["message_text", "text"],
  ["quality_notes", "text"],
  ["damaged_pieces", "integer not null default 0"],
  ["production_notes", "text"],
  ["finishing_notes", "text"],
  ["details", "text"],
  ["draft", "boolean not null default false"],
  ["created_by", "uuid references users(id) on delete set null"],
  ["updated_by", "uuid references users(id) on delete set null"],
  ["created_at", "timestamptz not null default now()"],
  ["updated_at", "timestamptz not null default now()"],
  ["completed_at", "timestamptz"],
];

const ORDER_STATUS_VALUES = [
  "NEW",
  "SENT_TO_WORKER",
  "WORKER_STARTED",
  "WORKER_DONE",
  "SENT_TO_FINISH",
  "FINISH_STARTED",
  "FINISH_DONE",
  "READY",
  "CUSTOMER_MESSAGED",
  "DELIVERED",
  "CANCELLED",
];

const WORK_STAGE_CONSTRAINT = "orders_work_stage_check";
const WORK_STAGE_DEF = "check (work_stage in ('new', 'operation', 'finishing', 'completed', 'cancelled'))";
const WORK_STAGES = ["new", "operation", "finishing", "completed", "cancelled"];

async function guarded(fn: () => Promise<unknown>, log: (msg: string) => void, label: string) {
  // Catalog changes (create or replace function, alter type) can race between
  // concurrently cold-starting serverless instances and abort with
  // "tuple concurrently updated" — retry a few times before giving up.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await fn();
      return;
    } catch (error) {
      if (attempt === 3) {
        log(`[schema] ${label} failed: ${error instanceof Error ? error.message : String(error)}`);
      } else {
        await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
      }
    }
  }
}

async function syncOrdersColumns(log: (msg: string) => void) {
  const { rows } = await query<{ column_name: string }>(
    `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'orders'`,
  );
  const existing = new Set(rows.map((row) => row.column_name));
  const missing = REQUIRED_ORDER_COLUMNS.filter(([name]) => !existing.has(name));
  if (!missing.length) return;
  log(`[schema] adding ${missing.length} missing column(s) to orders: ${missing.map(([name]) => name).join(", ")}`);
  for (const [name, definition] of missing) {
    await guarded(
      () => query(`alter table orders add column if not exists ${name} ${definition}`),
      log,
      `add column orders.${name}`,
    );
  }
}

/**
 * Backfills `orders.completed_at` for orders that were already finished before
 * the column existed. Their only trustworthy completion evidence is the last
 * update that moved them into the completed stage, so that is what the archive
 * shows for them. Runs after `syncOrdersColumns` so the column is guaranteed to
 * exist, and is idempotent because it only touches rows that are still null.
 */
async function syncOrderCompletion(log: (msg: string) => void) {
  await guarded(
    () => query(`update orders set completed_at = updated_at where completed_at is null and work_stage = 'completed'`),
    log,
    "orders completed_at backfill",
  );
}

async function syncWorkStageConstraint(log: (msg: string) => void) {
  const { rows } = await query<{ def: string }>(
    `select pg_get_constraintdef(oid) as def from pg_constraint
      where conrelid = 'orders'::regclass and contype = 'c' and conname = $1`,
    [WORK_STAGE_CONSTRAINT],
  );
  const def = rows[0]?.def ?? "";
  // pg_get_constraintdef returns a normalized form; compare per-stage instead of string equality.
  if (WORK_STAGES.every((stage) => def.includes(`'${stage}'`))) return;
  log(`[schema] fixing orders work_stage check constraint (current: ${def || "missing"})`);
  await guarded(
    () => query(`alter table orders drop constraint if exists ${WORK_STAGE_CONSTRAINT}; alter table orders add constraint ${WORK_STAGE_CONSTRAINT} ${WORK_STAGE_DEF}`),
    log,
    "orders work_stage check constraint",
  );
}

async function syncOrderStatusEnum(log: (msg: string) => void) {
  const { rows } = await query<{ enumlabel: string }>(
    `select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'order_status'`,
  );
  const existing = new Set(rows.map((row) => row.enumlabel));
  const missing = ORDER_STATUS_VALUES.filter((value) => !existing.has(value));
  for (const value of missing) {
    await guarded(
      () => query(`alter type order_status add value if not exists '${value.replace(/'/g, "''")}'`),
      log,
      `order_status enum value ${value}`,
    );
  }
  if (missing.length) log(`[schema] added missing order_status value(s): ${missing.join(", ")}`);
}

async function syncOrdersTriggers(log: (msg: string) => void) {
  await guarded(
    () =>
      query(`create or replace function set_updated_at() returns trigger language plpgsql as $$
        begin
          new.updated_at = now();
          return new;
        end;
      $$;
      create or replace function calculate_order_financials() returns trigger language plpgsql as $$
        begin
          new.price = coalesce(new.price, 0);
          new.quantity = coalesce(new.quantity, 0);
          new.paid = coalesce(new.paid, 0);
          new.old_account = coalesce(new.old_account, 0);
          new.total = new.price * new.quantity;
          new.remaining = new.total - new.paid;
          new.net_account = new.remaining + new.old_account;
          return new;
        end;
      $$;
      create or replace function set_order_completed_at() returns trigger language plpgsql as $$
        begin
          if new.work_stage = 'completed' and new.completed_at is null then
            new.completed_at = now();
          end if;
          if new.work_stage is distinct from 'completed' then
            new.completed_at = null;
          end if;
          return new;
        end;
      $$;
      drop trigger if exists calculate_orders_financials on orders;
      create trigger calculate_orders_financials before insert or update on orders for each row execute function calculate_order_financials();
      drop trigger if exists set_orders_completed_at on orders;
      create trigger set_orders_completed_at before insert or update on orders for each row execute function set_order_completed_at();
      drop trigger if exists set_orders_updated_at on orders;
      create trigger set_orders_updated_at before update on orders for each row execute function set_updated_at();`),
    log,
    "orders triggers/functions sync",
  );
}

async function syncPhotosTable(log: (msg: string) => void) {
  await guarded(
    () => query(`create table if not exists photos (
      id uuid primary key default gen_random_uuid(),
      original_name text not null default '',
      stored_name text not null default '',
      mime_type text not null default 'image/jpeg',
      size integer not null default 0,
      data bytea,
      uploaded_by uuid references users(id) on delete set null,
      created_at timestamptz not null default now()
    )`),
    log,
    "photos table drift",
  );
}

async function syncWorkersTable(log: (msg: string) => void) {
  await guarded(
    () => query(`create table if not exists workers (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      department text not null default '',
      card_id text not null default '',
      phone text not null default '',
      active boolean not null default true,
      created_by uuid references users(id) on delete set null,
      updated_by uuid references users(id) on delete set null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    alter table workers add column if not exists department text not null default '';
    alter table workers add column if not exists card_id text not null default '';
    alter table workers add column if not exists phone text not null default '';
    create unique index if not exists workers_name_uniq on workers (lower(name));`),
    log,
    "workers table drift",
  );
  await guarded(
    () => query(`
      update workers
      set department = case
        when
          exists (select 1 from orders o where o.sewing_worker is not null and trim(coalesce(o.sewing_worker, '')) <> '' and lower(o.sewing_worker) = lower(workers.name))
          and not exists (select 1 from orders o where o.printing_worker is not null and trim(coalesce(o.printing_worker, '')) <> '' and lower(o.printing_worker) = lower(workers.name))
          and not exists (select 1 from orders o where o.finishing_worker is not null and trim(coalesce(o.finishing_worker, '')) <> '' and lower(o.finishing_worker) = lower(workers.name))
          and not exists (select 1 from orders o, jsonb_array_elements_text(coalesce(o.operation_workers, '[]'::jsonb)) wn where trim(coalesce(wn, '')) <> '' and lower(wn) = lower(workers.name))
        then 'sewing'
        when
          exists (select 1 from orders o where o.printing_worker is not null and trim(coalesce(o.printing_worker, '')) <> '' and lower(o.printing_worker) = lower(workers.name))
          and not exists (select 1 from orders o where o.sewing_worker is not null and trim(coalesce(o.sewing_worker, '')) <> '' and lower(o.sewing_worker) = lower(workers.name))
          and not exists (select 1 from orders o where o.finishing_worker is not null and trim(coalesce(o.finishing_worker, '')) <> '' and lower(o.finishing_worker) = lower(workers.name))
          and not exists (select 1 from orders o, jsonb_array_elements_text(coalesce(o.operation_workers, '[]'::jsonb)) wn where trim(coalesce(wn, '')) <> '' and lower(wn) = lower(workers.name))
        then 'printing'
        when
          exists (select 1 from orders o where o.finishing_worker is not null and trim(coalesce(o.finishing_worker, '')) <> '' and lower(o.finishing_worker) = lower(workers.name))
          and not exists (select 1 from orders o where o.sewing_worker is not null and trim(coalesce(o.sewing_worker, '')) <> '' and lower(o.sewing_worker) = lower(workers.name))
          and not exists (select 1 from orders o where o.printing_worker is not null and trim(coalesce(o.printing_worker, '')) <> '' and lower(o.printing_worker) = lower(workers.name))
          and not exists (select 1 from orders o, jsonb_array_elements_text(coalesce(o.operation_workers, '[]'::jsonb)) wn where trim(coalesce(wn, '')) <> '' and lower(wn) = lower(workers.name))
        then 'finishing'
        when
          exists (select 1 from orders o, jsonb_array_elements_text(coalesce(o.operation_workers, '[]'::jsonb)) wn where trim(coalesce(wn, '')) <> '' and lower(wn) = lower(workers.name))
          and not exists (select 1 from orders o where o.sewing_worker is not null and trim(coalesce(o.sewing_worker, '')) <> '' and lower(o.sewing_worker) = lower(workers.name))
          and not exists (select 1 from orders o where o.printing_worker is not null and trim(coalesce(o.printing_worker, '')) <> '' and lower(o.printing_worker) = lower(workers.name))
          and not exists (select 1 from orders o where o.finishing_worker is not null and trim(coalesce(o.finishing_worker, '')) <> '' and lower(o.finishing_worker) = lower(workers.name))
        then 'operation'
        else department
      end
      where department = '';`),
    log,
    "workers department migration",
  );
}

async function syncMachinesTable(log: (msg: string) => void) {
  await guarded(
    () => query(`create table if not exists machines (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      position integer not null default 0,
      active boolean not null default true,
      created_by uuid references users(id) on delete set null,
      updated_by uuid references users(id) on delete set null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    alter table machines add column if not exists position integer not null default 0;
    alter table machines add column if not exists active boolean not null default true;
    create unique index if not exists machines_name_uniq on machines (lower(name));
    create index if not exists machines_position_idx on machines (position);`),
    log,
    "machines table drift",
  );
  const { rows } = await query<{ count: string }>(`select count(*) as count from machines`);
  if (Number(rows[0]?.count ?? 0) === 0) {
    const names = ["تاجيما 2015", "تاجيما 2007", "الجلوبال", "swf", "تاجيما 2005", "فيا الي جوا", "فيا الي برا"];
    await guarded(
      () => query(
        `insert into machines (name, position, active) select * from unnest($1::text[], $2::int[], $3::boolean[])`,
        [names, names.map((_, index) => index + 1), names.map(() => true)],
      ),
      log,
      "machines default seed",
    );
  }
}

/**
 * Dedicated sequence for the display order number (00001, 00002, ...). Created
 * once, never reset, and aligned to continue after the highest existing
 * all-digit number already stored on orders. The unique index on
 * orders.order_number is the final guard against duplicates.
 */
async function syncOrderNumberSequence(log: (msg: string) => void) {
  await guarded(
    () =>
      query(`create sequence if not exists orders_number_seq minvalue 1 start 1 increment by 1 no cycle;
        select setval('orders_number_seq', greatest(
          (select coalesce(max((order_number)::bigint), 0) + 1 from orders where order_number ~ '^[0-9]{5,}$'),
          (select last_value + case when is_called then 1 else 0 end from orders_number_seq)
        ), false);`),
    log,
    "order number sequence",
  );
}

/**
 * The customer-account ledger tables are created here as well, because a
 * database that predates the feature boots through `syncSchemaDrift` instead of
 * the full 001_init.sql and would otherwise fail every statement query with
 * "relation customer_account_transactions does not exist". Idempotent.
 */
async function syncCustomerAccountsTables(log: (msg: string) => void) {
  await guarded(
    () => query(`
      create table if not exists customer_accounts (
        id uuid primary key default gen_random_uuid(),
        customer_id uuid not null unique,
        opening_balance numeric not null default 0,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create table if not exists customer_account_transactions (
        id uuid primary key default gen_random_uuid(),
        account_id uuid not null,
        customer_id uuid not null,
        txn_date date not null,
        entry_type text not null,
        order_id uuid,
        description text not null default '',
        logo text not null default '',
        quantity numeric not null default 0,
        price numeric not null default 0,
        debit numeric not null default 0,
        credit numeric not null default 0,
        client_key text,
        created_by uuid references users(id) on delete set null,
        created_at timestamptz not null default now()
      );
      alter table customer_account_transactions add column if not exists logo text not null default '';
      alter table customer_account_transactions drop constraint if exists customer_account_transactions_entry_type_check;
      alter table customer_account_transactions add constraint customer_account_transactions_entry_type_check check (entry_type in ('charge', 'payment'));
      create unique index if not exists customer_account_transactions_client_key_idx
        on customer_account_transactions (client_key) where client_key is not null;
      create unique index if not exists customer_account_transactions_order_uniq
        on customer_account_transactions (order_id) where order_id is not null;
    `),
    log,
    "customer accounts tables",
  );
}

/**
 * Repairs schema drift on an existing database. Runs on every boot after the
 * full bootstrap: it cheaply diffs the orders table/catalog and adds whatever
 * is missing, so the backend never writes into a stale schema. All statements
 * are idempotent and individually guarded — a failure is logged and does not
 * abort startup.
 */
async function syncSchemaDrift(log: (msg: string) => void) {
  await syncOrdersColumns(log);
  await syncOrderCompletion(log);
  await syncWorkStageConstraint(log);
  await syncOrderStatusEnum(log);
  await syncOrdersTriggers(log);
  await syncPhotosTable(log);
  await syncWorkersTable(log);
  await syncMachinesTable(log);
  await syncCustomerAccountsTables(log);
  await syncOrderNumberSequence(log);
}

/**
 * Applies the idempotent schema (001_init.sql) when the backend database is
 * missing it, then always runs a lightweight drift sync so a partially-migrated
 * database self-heals. Safe to run on every boot: it short-circuits with cheap
 * catalog checks once the schema exists, and the drift sync only issues
 * `add column if not exists` / constraint repairs for what is actually missing.
 */
export async function ensureSchema(log: (msg: string) => void = console.log) {
  if (!databaseAvailable()) {
    log("[schema] DATABASE_URL not set; skipping schema bootstrap.");
    return;
  }
  try {
    const { rows } = await query<{ t: unknown }>(`select to_regclass('public.users') as t`);
    const hasUsers = rows[0]?.t != null;
    if (!hasUsers) {
      log("[schema] public.users missing — applying 001_init.sql...");
      try {
        await query(schemaSql);
        log("[schema] 001_init.sql applied.");
      } catch (error) {
        log(`[schema] 001_init.sql failed: ${error instanceof Error ? error.message : error}`);
      }
    }
    await syncSchemaDrift(log);
  } catch (error) {
    log(`[schema] bootstrap failed: ${error instanceof Error ? error.message : error}`);
  }
}