import { build } from "../backend/node_modules/esbuild/lib/main.js";

const people = [
  { id: "p-master", username: "mahmoud", full_name: "Mahmoud", role: "Master", is_active: true, permission_overrides: {}, shadow_id: "u-master" },
  { id: "p-operator", username: "omar", full_name: "Omar", role: "Operator", is_active: true, permission_overrides: {}, shadow_id: "u-operator" },
  { id: "p-worker", username: "worker1", full_name: "Worker One", role: "Worker", is_active: true, permission_overrides: {}, shadow_id: "u-worker" },
  { id: "p-other", username: "worker2", full_name: "Worker Two", role: "Worker", is_active: true, permission_overrides: {}, shadow_id: "u-other" },
  { id: "p-finish", username: "finishing1", full_name: "Finishing One", role: "Finishing", is_active: true, permission_overrides: {}, shadow_id: "u-finish" },
  { id: "p-finance", username: "finance1", full_name: "Finance One", role: "CustomFinance", is_active: true, permission_overrides: {}, shadow_id: "u-finance" },
];
const roleRows = [{ name: "CustomFinance", permissions: ["dailyAccounts.view"] }];
const notices = [];
const orders = new Map();
const db = { query: async (sql, params = []) => {
  if (sql.includes("from users_profile p")) return { rows: people };
  if (sql.includes("from roles where")) return { rows: roleRows };
  if (sql.includes("insert into notifications")) {
    const [recipient_key, event_key, kind, title, body, target_kind, target_id] = params;
    if (!notices.some(n => n.recipient_key === recipient_key && n.event_key === event_key)) notices.push({ id: `00000000-0000-0000-0000-${String(notices.length + 1).padStart(12, "0")}`, recipient_key, event_key, kind, title, body, target_kind, target_id, created_at: new Date().toISOString(), read_at: null });
    return { rows: [] };
  }
  if (sql.includes("from orders where id::text")) return { rows: orders.has(params[0]) ? [orders.get(params[0])] : [] };
  if (sql.includes("from orders where draft=false")) return { rows: [] };
  if (sql.includes("select * from notifications")) {
    const rows = notices.filter(n => n.recipient_key === (params[1] ?? params[0]) && (!sql.includes("read_at is null") || !n.read_at));
    return { rows: sql.includes("where id=$1") ? rows.filter(n => n.id === params[0]) : rows };
  }
  if (sql.includes("update notifications set read_at")) {
    const ids = Array.isArray(params[0]) ? params[0] : [params[0]];
    for (const notice of notices) if (ids.includes(notice.id) && notice.recipient_key === params[1]) notice.read_at ||= new Date().toISOString();
    return { rows: [] };
  }
  throw new Error(`Unexpected SQL: ${sql}`);
} };
globalThis.__notificationTestDb = db;
const bundle = await build({ entryPoints: ["backend/src/notifications.ts"], bundle: true, platform: "node", format: "esm", write: false,
  plugins: [{ name: "mock-db", setup(api) {
    api.onResolve({ filter: /^\.\/db\.js$/ }, () => ({ path: "db", namespace: "mock" }));
    api.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ contents: "export async function query(sql, params) { return globalThis.__notificationTestDb.query(sql, params); }", loader: "js" }));
  } }],
});
const module = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const check = (name, pass) => { console.log(`${pass ? "PASS" : "FAIL"} ${name}`); if (!pass) process.exitCode = 1; };
const base = { id: "order-1", order_number: "100", draft: false, status: "NEW", work_stage: "new", updated_at: "2026-11-14T08:00:00Z", worker_name: "", operation_workers: [], operation_supervisors: [] };
const production = { ...base, status: "SENT_TO_WORKER", work_stage: "operation", updated_at: "2026-11-14T08:01:00Z" };
orders.set(base.id, production);
await module.orderChanged(base, production);
check("production transfer alerts operator and Master", notices.some(n => n.recipient_key === "omar" && n.kind === "operation") && notices.some(n => n.recipient_key === "mahmoud" && n.kind === "operation"));
check("production transfer excludes finishing and unassigned workers", !notices.some(n => ["finishing1", "worker1", "worker2"].includes(n.recipient_key)));
await module.orderChanged(base, production);
check("retried transition does not duplicate alerts", notices.filter(n => n.kind === "operation").length === 2);
const assigned = { ...production, worker_name: "Worker One", operation_workers: ["Worker One"], updated_at: "2026-11-14T08:02:00Z" };
orders.set(base.id, assigned);
await module.staffChanged(production, assigned);
check("assignment alerts only the selected worker", notices.some(n => n.recipient_key === "worker1" && n.kind === "assignment") && !notices.some(n => n.recipient_key === "worker2" && n.kind === "assignment"));
const finishing = { ...assigned, status: "SENT_TO_FINISH", work_stage: "finishing", updated_at: "2026-11-14T08:03:00Z" };
orders.set(base.id, finishing);
await module.orderChanged(assigned, finishing);
check("finishing transfer alerts finishing team", notices.some(n => n.recipient_key === "finishing1" && n.kind === "finishing"));
check("finishing transfer excludes worker and finance-only role", !notices.some(n => ["worker1", "finance1"].includes(n.recipient_key) && n.kind === "finishing"));
await module.financeChanged("payment-1", "دفعة", "تم الدفع", "record-1");
await module.financeChanged("payment-1", "دفعة", "تم الدفع", "record-1");
check("finance alerts only authorized accounts", notices.some(n => n.recipient_key === "finance1" && n.kind === "finance") && notices.some(n => n.recipient_key === "mahmoud" && n.kind === "finance") && !notices.some(n => ["worker1", "finishing1", "omar"].includes(n.recipient_key) && n.kind === "finance"));
check("retried finance event stays unique", notices.filter(n => n.kind === "finance").length === 2);
const feed = await module.notificationsFor("finance1");
check("finance unread count is per user", feed.unreadCount === 1);
await module.readNotification("finance1", feed.notifications[0].id);
check("read state persists on next fetch", (await module.notificationsFor("finance1")).unreadCount === 0 && (await module.notificationsFor("mahmoud")).unreadCount > 0);
check("another user cannot mark it read", !await module.readNotification("worker1", feed.notifications[0].id));
await module.readAllNotifications("mahmoud");
check("mark all read affects only current user", (await module.notificationsFor("mahmoud")).unreadCount === 0 && (await module.notificationsFor("omar")).unreadCount > 0);
