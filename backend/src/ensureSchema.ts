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
  ["operation_methods", "jsonb not null default '[]'::jsonb"],
  ["operation_attachments", "jsonb not null default '[]'::jsonb"],
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
  try {
    await fn();
  } catch (error) {
    log(`[schema] ${label} failed: ${error instanceof Error ? error.message : String(error)}`);
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
      drop trigger if exists calculate_orders_financials on orders;
      create trigger calculate_orders_financials before insert or update on orders for each row execute function calculate_order_financials();
      drop trigger if exists set_orders_updated_at on orders;
      create trigger set_orders_updated_at before update on orders for each row execute function set_updated_at();`),
    log,
    "orders triggers/functions sync",
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
  await syncWorkStageConstraint(log);
  await syncOrderStatusEnum(log);
  await syncOrdersTriggers(log);
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