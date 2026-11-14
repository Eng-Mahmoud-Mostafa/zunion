import { query } from "./db.js";
import { loadOrder } from "./orders.js";
import type { OrderRecord } from "./notifications.js";

export type ProductionKind = "sewing" | "printing";

export async function completeProductionOrder(id: string, stage: ProductionKind, userId: string) {
  const previous = await loadOrder(id);
  if (!previous) return { outcome: "missing" as const };
  const expectedTypes = stage === "sewing" ? ["خياطه", "خياطة"] : ["طباعه", "طباعة"];
  if (!expectedTypes.includes(String(previous.type ?? ""))) return { outcome: "wrong-type" as const };
  if (previous.draft) return { outcome: "draft" as const };
  const statusColumn = stage === "sewing" ? "sewing_status" : "printing_status";
  const { rows } = await query<OrderRecord>(
    `update orders set ${statusColumn}='done', status='WORKER_DONE', work_stage='finishing', updated_by=$2
     where id=$1 and work_stage in ('new','operation') and draft=false returning *`,
    [id, userId],
  );
  if (rows[0]) return { outcome: "transferred" as const, previous, current: rows[0], statusColumn };
  const current = await loadOrder(id);
  if (current?.work_stage === "finishing") return { outcome: "already-transferred" as const, current };
  return { outcome: "ineligible" as const };
}
