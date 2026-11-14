import { query } from "./db.js";
import { roleDefaultPermissions, type PermissionKey } from "./permissions.js";

type Profile = {
  id: string;
  username: string;
  email: string | null;
  full_name: string;
  role: string;
  is_active: boolean;
  permission_overrides: { allow?: string[]; deny?: string[] } | null;
  shadow_id?: string | null;
};
export type OrderRecord = {
  [column: string]: unknown;
  id: string;
  order_number: string;
  work_stage: string;
  status: string;
  draft: boolean;
  updated_at?: string | Date;
  delivery_date?: string | null;
  created_by?: string | null;
  worker_name?: string | null;
  sewing_worker?: string | null;
  printing_worker?: string | null;
  finishing_worker?: string | null;
  operation_workers?: unknown;
  operation_supervisors?: unknown;
  remaining?: number;
  paid?: number;
};
export type Notice = {
  id: string;
  recipient_key: string;
  event_key: string;
  kind: string;
  title: string;
  body: string;
  target_kind: string;
  target_id: string | null;
  created_at: string;
  read_at: string | null;
};

const financePermissions: PermissionKey[] = ["dailyAccounts.view"];
const key = (value: string) => value.trim().toLocaleLowerCase();
const list = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; }
  }
  return [];
};

export function permissionSet(profile: Profile, rolePermissions: Record<string, string[]>): Set<string> {
  const base = new Set<string>(rolePermissions[profile.role] ?? roleDefaultPermissions[profile.role] ?? []);
  for (const value of profile.permission_overrides?.allow ?? []) base.add(value);
  for (const value of profile.permission_overrides?.deny ?? []) base.delete(value);
  return base;
}

export function assignedTo(profile: Profile, order: OrderRecord): boolean {
  const names = [profile.username, profile.full_name].filter(Boolean).map(key);
  return [order.worker_name, order.sewing_worker, order.printing_worker, order.finishing_worker,
    ...list(order.operation_workers), ...list(order.operation_supervisors)]
    .some((name) => name && names.includes(key(String(name))));
}

export function canReceive(kind: string, profile: Profile, permissions: Set<string>, order?: OrderRecord): boolean {
  if (!profile.is_active) return false;
  if (kind === "finance") return financePermissions.some((permission) => permissions.has(permission));
  if (!order || order.draft) return false;
  if (kind === "operation") return permissions.has("operation.view") && profile.role !== "Worker" && order.work_stage === "operation";
  if (kind === "assignment") return permissions.has("operation.view") && order.work_stage === "operation" && assignedTo(profile, order);
  if (kind === "finishing") return permissions.has("finishing.view") && order.work_stage === "finishing";
  if (kind === "delivery" || kind === "completed") {
    return permissions.has("orders.view");
  }
  return false;
}

async function directory() {
  const [profiles, roles] = await Promise.all([
    query<Profile>(`select p.id, p.username, p.email, p.full_name, p.role, p.is_active, p.permission_overrides,
      u.id as shadow_id from users_profile p left join users u on lower(u.username) = lower(p.username) where p.is_active = true`),
    query<{ name: string; permissions: unknown }>("select name, permissions from roles where status = 'active'"),
  ]);
  const rolePermissions: Record<string, string[]> = {};
  for (const role of roles.rows) rolePermissions[role.name] = list(role.permissions);
  return { profiles: profiles.rows, rolePermissions };
}

async function add(recipient: Profile, eventKey: string, kind: string, title: string, body: string, targetKind: string, targetId: string | null) {
  await query(`insert into notifications (recipient_key, event_key, kind, title, body, target_kind, target_id)
    values ($1,$2,$3,$4,$5,$6,$7) on conflict (recipient_key, event_key) do nothing`,
    [key(recipient.username), eventKey, kind, title, body, targetKind, targetId]);
}

async function publish(kind: string, eventKey: string, title: string, body: string, targetKind: string, targetId: string | null, order?: OrderRecord) {
  const { profiles, rolePermissions } = await directory();
  await Promise.all(profiles.filter((profile) => canReceive(kind, profile, permissionSet(profile, rolePermissions), order))
    .map((profile) => add(profile, eventKey, kind, title, body, targetKind, targetId)));
}

export async function orderChanged(previous: OrderRecord | null, current: OrderRecord) {
  if (current.draft) return;
  const version = new Date(current.updated_at ?? Date.now()).toISOString();
  const number = current.order_number;
  if (current.work_stage === "operation" && previous?.work_stage !== "operation") {
    await publish("operation", `operation:${current.id}:${version}`, "أوردر جديد في التشغيل", `الأوردر ${number} جاهز للتشغيل`, "operation", current.id, current);
  }
  if (current.work_stage === "finishing" && previous?.work_stage !== "finishing") {
    await publish("finishing", `finishing:${current.id}:${version}`, "أوردر جاهز للتشطيب", `تم تحويل الأوردر ${number} إلى التشطيب`, "finishing", current.id, current);
  }
  if (current.work_stage === "completed" && previous?.work_stage !== "completed") {
    await publish("completed", `completed:${current.id}:${version}`, "تم الانتهاء من الأوردر", `الأوردر ${number} تم الانتهاء منه`, "order", current.id, current);
  }
  if (Number(current.paid ?? 0) > Number(previous?.paid ?? 0)) {
    await publish("finance", `payment:${current.id}:${version}`, "دفعة جديدة للأوردر", `تم تسجيل دفعة للأوردر ${number}`, "finance", current.id);
  }
}

export async function staffChanged(previous: OrderRecord, current: OrderRecord) {
  const oldNames = new Set([previous.worker_name, previous.sewing_worker, previous.printing_worker,
    ...list(previous.operation_workers)].filter(Boolean).map((name) => key(String(name))));
  const newNames = [current.worker_name, current.sewing_worker, current.printing_worker,
    ...list(current.operation_workers)].filter(Boolean).map((name) => key(String(name)));
  const { profiles, rolePermissions } = await directory();
  const version = new Date(current.updated_at ?? Date.now()).toISOString();
  await Promise.all(profiles.filter((profile) =>
    newNames.some((name) => [profile.username, profile.full_name].some((identity) => key(identity) === name))
    && !oldNames.has(key(profile.username)) && !oldNames.has(key(profile.full_name))
    && canReceive("assignment", profile, permissionSet(profile, rolePermissions), current))
    .map((profile) => add(profile, `assignment:${current.id}:${version}`, "assignment", "تم إسناد عمل إليك",
      `تم إسناد الأوردر ${current.order_number} إليك`, "operation", current.id)));
}

export async function financeChanged(eventKey: string, title: string, body: string, targetId: string | null) {
  await publish("finance", eventKey, title, body, "finance", targetId);
}

async function viewer(username: string) {
  const { profiles, rolePermissions } = await directory();
  const profile = profiles.find((row) => key(row.username) === key(username));
  return profile ? { profile, permissions: permissionSet(profile, rolePermissions) } : null;
}

async function readable(notice: Notice, profile: Profile, permissions: Set<string>): Promise<boolean> {
  if (notice.kind === "finance") return canReceive("finance", profile, permissions);
  if (!notice.target_id) return false;
  const result = await query<OrderRecord>(`select id, order_number, work_stage, status, draft, created_by, worker_name,
    sewing_worker, printing_worker, finishing_worker, operation_workers, operation_supervisors from orders where id::text=$1`, [notice.target_id]);
  const order = result.rows[0];
  return Boolean(order && canReceive(notice.kind, profile, permissions, order));
}

async function dueAlerts(profile: Profile, permissions: Set<string>) {
  if (!permissions.has("orders.view")) return;
  const { rows } = await query<OrderRecord>(`select id, order_number, work_stage, status, draft, created_by, worker_name,
    sewing_worker, printing_worker, finishing_worker, operation_workers, operation_supervisors, delivery_date
    from orders where draft=false and delivery_date is not null and delivery_date <= (now() at time zone 'Africa/Cairo')::date + 2
    and work_stage not in ('completed','cancelled') order by delivery_date desc limit 200`);
  const dateParts = new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const today = ["year", "month", "day"].map((part) => dateParts.find((item) => item.type === part)?.value ?? "").join("-");
  await Promise.all(rows.filter((order) => canReceive("delivery", profile, permissions, order)).map((order) => {
    const overdue = String(order.delivery_date) < today;
    return add(profile, `delivery:${overdue ? "overdue" : "upcoming"}:${order.id}:${order.delivery_date}`, "delivery",
      overdue ? "موعد تسليم متأخر" : "موعد تسليم قريب",
      `الأوردر ${order.order_number} · ${order.delivery_date}`, "order", order.id);
  }));
}

export async function notificationsFor(username: string) {
  const current = await viewer(username);
  if (!current) return { notifications: [], unreadCount: 0 };
  await dueAlerts(current.profile, current.permissions);
  const { rows } = await query<Notice>(`select * from notifications where recipient_key=$1 order by created_at desc`, [key(username)]);
  const visible = (await Promise.all(rows.map(async (notice) => ({ notice, allowed: await readable(notice, current.profile, current.permissions) }))))
    .filter((item) => item.allowed).map((item) => item.notice);
  return { notifications: visible.slice(0, 50), unreadCount: visible.filter((notice) => !notice.read_at).length };
}

export async function readNotification(username: string, id: string) {
  const current = await viewer(username);
  if (!current) return false;
  const { rows } = await query<Notice>("select * from notifications where id=$1 and recipient_key=$2", [id, key(username)]);
  if (!rows[0] || !await readable(rows[0], current.profile, current.permissions)) return false;
  await query("update notifications set read_at=coalesce(read_at,now()) where id=$1 and recipient_key=$2", [id, key(username)]);
  return true;
}

export async function readAllNotifications(username: string) {
  const current = await viewer(username);
  if (!current) return;
  const { rows } = await query<Notice>("select * from notifications where recipient_key=$1 and read_at is null", [key(username)]);
  const ids = (await Promise.all(rows.map(async (notice) => ({ notice, allowed: await readable(notice, current.profile, current.permissions) }))))
    .filter((item) => item.allowed).map((item) => item.notice.id);
  if (ids.length) await query("update notifications set read_at=now() where id=any($1::uuid[]) and recipient_key=$2", [ids, key(username)]);
}
