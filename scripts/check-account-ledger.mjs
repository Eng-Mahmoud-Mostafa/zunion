// Real PostgreSQL execution in memory: never loads .env or connects to production.
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { build } = require("../backend/node_modules/esbuild");
const db = new PGlite();
let failOn = "";
globalThis.__ledgerTestQuery = async (sql, params = []) => {
  if (failOn && sql.includes(failOn)) throw new Error("injected write failure");
  const result = sql.includes("create table if not exists") ? (await db.exec(sql)).at(-1) : await db.query(sql, params);
  return { rows: result?.rows ?? [], rowCount: result?.affectedRows ?? 0 };
};
globalThis.__ledgerTestTx = (fn) => db.transaction((client) => fn({ query: (sql, params) => {
  if (failOn && sql.includes(failOn)) throw new Error("injected write failure");
  return client.query(sql, params);
} }));
const bundle = await build({
  stdin: { contents: 'export * from "./backend/src/accountLedger.ts"; export * from "./backend/src/accountDates.ts";', resolveDir: process.cwd() }, bundle: true, platform: "node", format: "esm", write: false,
  plugins: [{ name: "isolated-db", setup(b) {
    b.onResolve({ filter: /^\.\/db\.js$/ }, () => ({ path: "isolated-db", namespace: "test" }));
    b.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: "export const query = (...a) => globalThis.__ledgerTestQuery(...a); export const tx = (...a) => globalThis.__ledgerTestTx(...a);" }));
  } }],
});
const { getLedger, getBalances, getCustomerPaymentReceipts, recordPayment, openNewPeriod, isAccountDate } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const q = (sql, args) => db.query(sql, args);
try {
  await db.exec(`
    create table users (id uuid primary key default gen_random_uuid(), full_name text, username text);
    create table customers (id uuid primary key default gen_random_uuid(), name text, code text, phone text, source_party text, old_balance numeric default 0);
    create table products (id uuid primary key, logo_placement text);
    create table orders (id uuid primary key default gen_random_uuid(), customer_id uuid, order_number text, customer_name_snapshot text, product_name_snapshot text, type text, color text, product_id uuid, quantity numeric, price numeric, total numeric, paid numeric default 0, draft boolean default false, delivery_date date, created_by uuid, created_at timestamptz default now());
    create table order_items (id uuid primary key default gen_random_uuid(), order_id uuid, logo_place text);
    create table customer_accounts (id uuid primary key default gen_random_uuid(), customer_id uuid unique);
    create table customer_account_transactions (id uuid primary key default gen_random_uuid(), account_id uuid, customer_id uuid, txn_date date, entry_type text, order_id uuid, description text, logo text, quantity numeric default 0, price numeric default 0, debit numeric default 0, credit numeric default 0, client_key text unique, created_by uuid, created_at timestamptz default now());
  `);
  const actor = (await q("insert into users (full_name, username) values ('Tester','tester') returning id")).rows[0];
  const customer = (await q("insert into customers (name,code,source_party) values ('شركة الاختبار','1054','Mahmoud') returning id")).rows[0];
  const other = (await q("insert into customers (name) values ('عميل آخر') returning id")).rows[0];
  const order = (await q(`insert into orders (customer_id,order_number,type,color,quantity,price,total,created_by,created_at,delivery_date)
    values ($1,'00048','تطريز','أحمر',10,5,50,$2,now()-interval '2 days',current_date-2) returning id`, [customer.id, actor.id])).rows[0];
  await q("insert into orders (customer_id,total,quantity,price,draft) values ($1,999,1,999,true)", [customer.id]);
  let ledger = await getLedger(customer.id);
  assert.deepEqual(ledger.summary, { operationCount: 1, totalWork: 50, totalPayments: 0, currentBalance: 50 });
  assert.equal(ledger.rows[0].color, "أحمر");
  assert.equal(ledger.rows[0].quantity, 10);
  assert.equal(ledger.rows[0].price, 5);
  assert.equal(ledger.rows[0].order_id, order.id);
  assert.equal((await getLedger(customer.id)).rows.length, 1);
  const periodId = ledger.period.id;
  const date = (await q("select (clock_timestamp() at time zone 'Africa/Cairo')::date::text as d")).rows[0].d;
  const input = { amount: 40, date, method: "cash", notes: "", clientKey: "payment-test-001", expectedPeriodId: periodId, createdBy: actor.id };
  const first = await recordPayment(customer.id, input);
  assert.equal((await recordPayment(customer.id, input)).id, first.id);
  await assert.rejects(() => recordPayment(customer.id, { ...input, amount: 41 }), { code: "ZUNION_TRANSACTION_KEY_CONFLICT" });
  await assert.rejects(() => recordPayment(other.id, input), { code: "ZUNION_TRANSACTION_KEY_CONFLICT" });
  await recordPayment(customer.id, { ...input, amount: 1000, clientKey: "payment-test-002" });
  ledger = await getLedger(customer.id);
  assert.deepEqual(ledger.rows.map(r => r.balance), [50, 10, -990]);
  assert.equal(ledger.summary.totalPayments, 1040);
  assert.equal(ledger.summary.currentBalance, -990);
  const receipts = await getCustomerPaymentReceipts();
  assert.equal(receipts.length, 2);
  assert.equal(receipts.reduce((sum, r) => sum + Number(r.amount), 0), 1040);
  const page = await getLedger(customer.id, { offset: 2, limit: 1 });
  assert.equal(page.rows[0].balance, -990);
  assert.equal((await getBalances()).find(r => r.customer_id === customer.id).balance, -990);
  console.log("PASS order charges, drafts, colors, exact running balances, paging, duplicate payments and debtor balances");
  failOn = "insert into customer_account_transfers";
  await assert.rejects(() => openNewPeriod(customer.id, { id: actor.id, name: "Tester" }, { clientKey: "transfer-rollback", expectedPeriodId: periodId, effectiveDate: date }), /injected/);
  failOn = "";
  assert.equal((await getLedger(customer.id)).period.id, periodId);
  assert.equal((await q("select count(*)::int as n from customer_account_transfers")).rows[0].n, 0);
  const options = { clientKey: "transfer-test-001", expectedPeriodId: periodId, effectiveDate: date };
  const transfer = await openNewPeriod(customer.id, { id: actor.id, name: "Tester" }, options);
  assert.equal(transfer.preTransferBalance, -990);
  assert.equal((await openNewPeriod(customer.id, { id: actor.id, name: "Tester" }, options)).repeated, true);
  const old = await getLedger(customer.id, { periodId });
  assert.equal(old.period.closingBalance, 0);
  assert.equal(old.closing.preTransferBalance, -990);
  assert.equal(old.closing.transferredAmount, -990);
  assert.equal(old.closing.byName, "Tester");
  ledger = await getLedger(customer.id);
  assert.equal(ledger.period.carriedIn, -990);
  assert.equal(ledger.period.closingBalance, -990);
  assert.equal(ledger.summary.totalPayments, 0);
  assert.equal(ledger.summary.totalWork, 0);
  assert.equal(ledger.summary.currentBalance, -990);
  assert.equal((await recordPayment(customer.id, input)).id, first.id); // response lost before transfer
  assert.equal((await getCustomerPaymentReceipts()).length, 2); // transfers never become income
  await assert.rejects(() => recordPayment(customer.id, { ...input, clientKey: "closed-payment" }), { code: "ZUNION_PERIOD_CLOSED" });
  await assert.rejects(() => q("update customer_account_transfers set amount=0"), /immutable/);
  await q("update orders set total=60, price=6 where id=$1", [order.id]);
  ledger = await getLedger(customer.id);
  assert.equal(ledger.period.closingBalance, -980);
  assert.equal(ledger.summary.currentBalance, -980);
  assert.equal(ledger.rows.find(r => r.kind === "adjustment").debit, 10);
  console.log("PASS atomic rollback, negative credit transfer, immutable transfer history, replay after closure and order edit reconciliation");
  for (const bad of ["2026-02-30", "2025-02-29", "2026-13-01", "bad"]) assert.equal(isAccountDate(bad), false);
  assert.equal(isAccountDate("2024-02-29"), true);
  await assert.rejects(() => openNewPeriod(other.id, { id: actor.id, name: "Tester" }, { effectiveDate: "2099-01-01" }), { code: "ZUNION_BAD_OPEN_DATE" });
  console.log("PASS strict calendar validation and future period rejection");
  await q("insert into orders (customer_id,total,quantity,price,created_at,delivery_date) values ($1,0.30,3,0.10,now()-interval '1 day',current_date)", [other.id]);
  const positive = await getLedger(other.id);
  assert.equal(positive.summary.currentBalance, 0.3);
  const positiveTransfer = await openNewPeriod(other.id, { id: actor.id, name: "Tester" }, { clientKey: "transfer-positive", effectiveDate: date });
  assert.equal(positiveTransfer.preTransferBalance, 0.3);
  assert.equal((await getLedger(other.id, { periodId: positive.period.id })).period.closingBalance, 0);
  assert.equal((await getLedger(other.id)).period.closingBalance, 0.3);
  const settled = (await q("insert into customers (name) values ('حساب مسدد') returning id")).rows[0];
  await openNewPeriod(settled.id, { id: actor.id, name: "Tester" }, { clientKey: "transfer-zero", effectiveDate: date });
  const zero = await getLedger(settled.id);
  assert.equal(zero.period.closingBalance, 0);
  assert.equal(zero.rows.length, 0);
  console.log("PASS positive, zero and fractional-cent-safe balance transfers");

  // The same two receipts feed finance and monthly reports, without a second write.
  const reportBundle = await build({ entryPoints: ["src/services/statsService.ts"], bundle: true, platform: "browser", format: "esm", write: false,
    define: { "import.meta.env.VITE_USE_SERVER_AUTH": '"true"' },
    plugins: [{ name: "report-source", setup(b) {
      b.onResolve({ filter: /lib\/supabase$/ }, () => ({ path: "report-source", namespace: "test" }));
      b.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: "export const supabase = {from(){return {select(){return {order: async()=>({data: globalThis.__reportStored})}}}}};" }));
    } }],
  });
  const realFetch = globalThis.fetch;
  const realStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => null };
  globalThis.__reportStored = [{ id: "expense-1", transaction_type: "expense", date, created_at: date, amount: 5 }];
  globalThis.fetch = async () => new Response(JSON.stringify({ transactions: receipts }), { status: 200, headers: { "Content-Type": "application/json" } });
  try {
    const stats = await import(`data:text/javascript;base64,${Buffer.from(reportBundle.outputFiles[0].text).toString("base64")}`);
    const [year, month] = date.split("-").map(Number);
    const finance = await stats.getMonthlyFinancialStats(month, year);
    assert.equal(finance.incomeTotal, 1040);
    assert.equal(finance.expenseTotal, 5);
    assert.equal(finance.transactions.length, 3);
    assert.equal((await stats.getReportsData(month, year)).incomeTotal, 1040);
    globalThis.fetch = async () => new Response("{}", { status: 503 });
    const originalWarn = console.warn;
    try { console.warn = () => {}; await assert.rejects(() => stats.getReportsData(month, year)); }
    finally { console.warn = originalWarn; }
    console.log("PASS shared finance/report receipts, single counting and explicit report failure");
  } finally {
    globalThis.fetch = realFetch;
    if (realStorage) globalThis.localStorage = realStorage; else delete globalThis.localStorage;
    delete globalThis.__reportStored;
  }
} finally {
  await db.close();
  delete globalThis.__ledgerTestQuery;
  delete globalThis.__ledgerTestTx;
}
