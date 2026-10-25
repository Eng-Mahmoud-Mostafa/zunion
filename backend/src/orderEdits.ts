import type { PoolClient } from "pg";
import { query } from "./db.js";
import type { AuthUser } from "./security.js";

/** Order columns an edit can change, with the label shown in the edit history. */
export const ORDER_EDIT_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ["source_party", "الطرف"],
  ["customer_name_snapshot", "اسم العميل"],
  ["customer_code_snapshot", "كود العميل"],
  ["phone_snapshot", "الهاتف"],
  ["delivery_date", "تاريخ التسليم"],
  ["type", "نوع الأوردر"],
  ["product_name_snapshot", "المنتج"],
  ["color", "اللون"],
  ["payment_method", "طريقة الدفع"],
  ["custom_payment_method", "طريقة دفع أخرى"],
  ["materials_status", "الخامات"],
  ["machine_name", "الماكينة"],
  ["worker_name", "العامل"],
  ["operation_methods", "طرق التشغيل"],
  ["operation_attachments", "أمر الشغل / اللوجو"],
  ["quantity", "العدد"],
  ["price", "السعر"],
  ["paid", "المدفوع"],
  ["old_account", "الحساب القديم"],
  ["status", "الحالة"],
  ["work_stage", "المرحلة"],
  ["notes", "ملاحظات"],
  ["message_text", "رسالة العميل"],
  ["quality_notes", "ملاحظات الجودة"],
  ["damaged_pieces", "القطع التالفة"],
  ["production_notes", "ملاحظات التشغيل"],
  ["finishing_notes", "ملاحظات التشطيب"],
  ["details", "التفاصيل"],
  ["draft", "مسودة"],
];

export type OrderFieldChange = { field: string; label: string; from: unknown; to: unknown };

const NUMERIC_FIELDS = new Set(["quantity", "price", "paid", "old_account", "damaged_pieces"]);

/** Key-sorted JSON so jsonb (which reorders keys) compares equal to the incoming payload. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function comparable(field: string, value: unknown): string {
  if (value === null || value === undefined) return "";
  if (NUMERIC_FIELDS.has(field)) {
    const n = Number(value);
    return Number.isFinite(n) ? String(n) : String(value);
  }
  if (field === "delivery_date") return String(value).slice(0, 10);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        return stableJson(JSON.parse(trimmed));
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }
  if (typeof value === "object") return stableJson(value);
  return String(value);
}

function displayValue(field: string, value: unknown): unknown {
  if (value === null || value === undefined) return "";
  if (field === "delivery_date") return String(value).slice(0, 10);
  if (typeof value === "string") {
    try {
      return value.trim().startsWith("[") || value.trim().startsWith("{") ? JSON.parse(value) : value;
    } catch {
      return value;
    }
  }
  return value;
}

/** Fields whose stored value differs from the value about to be written. */
export function diffOrder(oldRow: Record<string, unknown>, next: Record<string, unknown>): OrderFieldChange[] {
  const changes: OrderFieldChange[] = [];
  for (const [field, label] of ORDER_EDIT_FIELDS) {
    if (!(field in next)) continue;
    if (comparable(field, oldRow[field]) === comparable(field, next[field])) continue;
    changes.push({ field, label, from: displayValue(field, oldRow[field]), to: displayValue(field, next[field]) });
  }
  return changes;
}

export async function recordOrderEdit(client: PoolClient, orderId: string, user: AuthUser, changes: OrderFieldChange[]) {
  await client.query(
    `insert into order_edits (order_id, editor_id, editor_name, changes)
     select $1, u.id, coalesce(nullif(btrim(u.full_name), ''), u.username, $3), $4::jsonb
     from (select $2::uuid as id) req left join users u on u.id = req.id`,
    [orderId, user.id, user.email ?? "", JSON.stringify(changes)],
  );
}

/**
 * Select list + join adding edit_count / last_editor_name / last_edited_at to an
 * `orders o` query. Falls back to zeros if the table is not there yet (first cold
 * start before the schema bootstrap finished).
 */
export const ORDER_EDIT_SUMMARY_SELECT = "coalesce(ed.edit_count, 0) as edit_count, ed.last_editor_name, ed.last_edited_at";
export const ORDER_EDIT_SUMMARY_JOIN = `left join lateral (
  select count(*)::int as edit_count,
         (array_agg(e.editor_name order by e.created_at desc))[1] as last_editor_name,
         max(e.created_at) as last_edited_at
  from order_edits e where e.order_id = o.id
) ed on true`;

export async function queryWithEditSummary<T extends Record<string, unknown>>(build: (withEdits: boolean) => string, params: unknown[]) {
  try {
    return await query<T>(build(true), params);
  } catch (error) {
    if ((error as { code?: string })?.code !== "42P01") throw error;
    return query<T>(build(false), params);
  }
}

export async function loadOrderHistory(orderId: string) {
  const order = await query<{ created_at: string; creator_name: string | null }>(
    `select o.created_at, coalesce(nullif(btrim(u.full_name), ''), u.username) as creator_name
     from orders o left join users u on u.id = o.created_by where o.id = $1`,
    [orderId],
  );
  if (!order.rows[0]) return null;
  let edits: Array<{ id: string; editor_name: string; changes: OrderFieldChange[]; created_at: string }> = [];
  try {
    edits = (await query<{ id: string; editor_name: string; changes: OrderFieldChange[]; created_at: string }>(
      "select id, editor_name, changes, created_at from order_edits where order_id = $1 order by created_at desc",
      [orderId],
    )).rows;
  } catch (error) {
    if ((error as { code?: string })?.code !== "42P01") throw error;
  }
  return { created_at: order.rows[0].created_at, creator_name: order.rows[0].creator_name ?? "", edits };
}
