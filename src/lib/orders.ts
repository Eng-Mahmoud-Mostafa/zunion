import { hasSupabaseConfig } from "./supabase";
import { supabase } from "./supabase";
import type { Filters, Order, OrderInput, OrderStatus } from "./types";

type XlsxModule = {
  read(buffer: ArrayBuffer, options: { type: "array" }): { SheetNames: string[]; Sheets: Record<string, unknown> };
  utils: {
    sheet_to_json<T>(sheet: unknown, options: Record<string, unknown>): T[];
    book_new(): unknown;
    json_to_sheet(data: unknown[]): unknown;
    book_append_sheet(workbook: unknown, sheet: unknown, name: string): void;
  };
  SSF: {
    parse_date_code(value: number): { y: number; m: number; d: number } | null;
  };
  writeFile(workbook: unknown, fileName: string, options: { compression: boolean }): void;
};

export const ALLOWED_EMAIL = "mahmoudmostafa3104@gmail.com";
export const STORAGE_BUCKET = "order-files";
const LOCAL_ORDERS_KEY = "zunion-local-orders";

export const workflowStages: OrderStatus[] = [
  "أوردر جديد",
  "يروح للتشغيل",
  "التشغيل",
  "يروح للتشطيب",
  "التشطيب",
  "الشغل جاهز",
  "تم التسليم",
];

export const emptyOrder: OrderInput = {
  order_number: "",
  source_person: "",
  client_name: "",
  client_code: "",
  phone: "",
  delivery_date: "",
  price: 0,
  quantity: 1,
  total: 0,
  paid: 0,
  remaining: 0,
  old_balance: 0,
  net_balance: 0,
  order_type: "",
  logo_status: "غير موجود",
  logo_image_url: null,
  work_order_image_url: null,
  quality_notes: "",
  operation_status: "",
  finishing_status: "",
  order_status: "أوردر جديد",
  client_message: "",
  notes: "",
};

export const arabicColumns: Record<keyof OrderInput, string> = {
  order_number: "رقم الأوردر",
  source_person: "الطرف",
  client_name: "اسم العميل",
  client_code: "كود العميل",
  phone: "رقم التليفون",
  delivery_date: "تاريخ التسليم",
  price: "السعر",
  quantity: "العدد",
  total: "الإجمالي",
  paid: "المدفوع",
  remaining: "باقي الحساب",
  old_balance: "حساب قديم",
  net_balance: "صافي حساب العميل",
  order_type: "النوع",
  logo_status: "اللوجو",
  logo_image_url: "رابط اللوجو",
  work_order_image_url: "رابط أمر الشغل",
  quality_notes: "الجودة",
  operation_status: "التشغيل",
  finishing_status: "التشطيب",
  order_status: "الحالة",
  client_message: "الرسالة",
  notes: "ملاحظات",
};

const excelAliases: Record<keyof OrderInput, string[]> = {
  order_number: ["رقم الأوردر", "رقم الاوردر", "order_number"],
  source_person: ["الطرف", "source_person"],
  client_name: ["اسم العميل", "client_name"],
  client_code: ["كود العميل", "client_code"],
  phone: ["رقم التليفون", "رقم الهاتف", "phone"],
  delivery_date: ["تاريخ التسليم", "delivery_date"],
  price: ["السعر", "price"],
  quantity: ["العدد", "quantity"],
  total: ["الإجمالي", "الاجمالي", "total"],
  paid: ["المدفوع", "paid"],
  remaining: ["باقي الحساب", "remaining"],
  old_balance: ["حساب قديم", "old_balance"],
  net_balance: ["صافي حساب العميل", "net_balance"],
  order_type: ["النوع", "order_type"],
  logo_status: ["اللوجو", "لوجو موجود/غير موجود", "logo_status"],
  logo_image_url: ["رابط اللوجو", "logo_image_url"],
  work_order_image_url: ["أمر الشغل", "رابط أمر الشغل", "work_order_image_url"],
  quality_notes: ["الجودة", "quality_notes"],
  operation_status: ["التشغيل", "operation_status"],
  finishing_status: ["التشطيب", "finishing_status"],
  order_status: ["الحالة", "order_status"],
  client_message: ["الرسالة", "رسالة العميل", "client_message"],
  notes: ["ملاحظات", "notes"],
};

export function calculateFinancials(order: OrderInput): OrderInput {
  const price = Number(order.price) || 0;
  const quantity = Number(order.quantity) || 0;
  const paid = Number(order.paid) || 0;
  const oldBalance = Number(order.old_balance) || 0;
  const total = price * quantity;
  const remaining = total - paid;

  return {
    ...order,
    price,
    quantity,
    paid,
    old_balance: oldBalance,
    total,
    remaining,
    net_balance: remaining + oldBalance,
  };
}

function orderPayload(order: OrderInput): OrderInput {
  const calculated = calculateFinancials(order);
  return Object.fromEntries(
    (Object.keys(arabicColumns) as Array<keyof OrderInput>).map((field) => [field, calculated[field] ?? null]),
  ) as OrderInput;
}

export function normalizeStatus(value: string): OrderStatus {
  const trimmed = value?.trim();
  if (workflowStages.includes(trimmed as OrderStatus) || trimmed === "مشكلة جودة") {
    return trimmed as OrderStatus;
  }
  return "أوردر جديد";
}

export function badgeLabel(order: Order): string {
  if (isOverdue(order)) return "متأخر";
  if (order.order_status === "مشكلة جودة" || order.quality_notes) return "مشكلة جودة";
  if (order.order_status === "تم التسليم") return "تم التسليم";
  if (order.order_status === "الشغل جاهز") return "جاهز";
  if (order.order_status.includes("التشطيب")) return "في التشطيب";
  if (order.order_status.includes("التشغيل")) return "في التشغيل";
  return "جديد";
}

export function badgeClasses(label: string): string {
  const map: Record<string, string> = {
    جديد: "bg-blue-100 text-blue-800",
    "في التشغيل": "bg-amber-100 text-amber-800",
    "في التشطيب": "bg-purple-100 text-purple-800",
    جاهز: "bg-emerald-100 text-emerald-800",
    "تم التسليم": "bg-zinc-200 text-zinc-700",
    "مشكلة جودة": "bg-rose-100 text-rose-800",
    متأخر: "bg-red-100 text-red-800",
  };
  return map[label] ?? "bg-zinc-100 text-zinc-800";
}

export function dateDiffDays(date: string): number | null {
  if (!date) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${date}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

export function isOverdue(order: Order): boolean {
  const diff = dateDiffDays(order.delivery_date);
  return diff !== null && diff < 0 && order.order_status !== "تم التسليم";
}

export function filterOrders(orders: Order[], filters: Filters): Order[] {
  const term = filters.search.trim().toLowerCase();
  return orders.filter((order) => {
    const matchesSearch =
      !term ||
      order.phone?.toLowerCase().includes(term) ||
      order.order_number?.toLowerCase().includes(term) ||
      order.client_name?.toLowerCase().includes(term);
    const matchesStatus = !filters.status || order.order_status === filters.status;
    const matchesDate = !filters.deliveryDate || order.delivery_date === filters.deliveryDate;
    const matchesSource = !filters.sourcePerson || order.source_person === filters.sourcePerson;
    const matchesQuality = !filters.qualityIssue || Boolean(order.quality_notes || order.order_status === "مشكلة جودة");
    return matchesSearch && matchesStatus && matchesDate && matchesSource && matchesQuality;
  });
}

function readLocalOrders(): Order[] {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_ORDERS_KEY) || "[]") as Order[];
  } catch {
    return [];
  }
}

function writeLocalOrders(orders: Order[]): void {
  localStorage.setItem(LOCAL_ORDERS_KEY, JSON.stringify(orders));
}

function toOrder(input: OrderInput, id: string = crypto.randomUUID()): Order {
  const now = new Date().toISOString();
  return {
    ...calculateFinancials(input),
    id,
    created_at: now,
    updated_at: now,
  };
}

export async function fetchOrders(): Promise<Order[]> {
  if (!hasSupabaseConfig) return readLocalOrders();
  const { data, error } = await supabase.from("orders").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function upsertOrder(order: OrderInput, id?: string): Promise<void> {
  const payload = orderPayload(order);
  if (!hasSupabaseConfig) {
    const orders = readLocalOrders();
    if (id) {
      writeLocalOrders(orders.map((item) => (item.id === id ? { ...toOrder(payload, id), created_at: item.created_at } : item)));
      return;
    }
    writeLocalOrders([toOrder(payload), ...orders]);
    return;
  }
  if (id) {
    const { error } = await supabase.from("orders").update(payload).eq("id", id);
    if (error) throw error;
    return;
  }
  const { error } = await supabase.from("orders").insert(payload);
  if (error) throw error;
}

export async function deleteOrder(id: string): Promise<void> {
  if (!hasSupabaseConfig) {
    writeLocalOrders(readLocalOrders().filter((order) => order.id !== id));
    return;
  }
  const { error } = await supabase.from("orders").delete().eq("id", id);
  if (error) throw error;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export async function uploadOrderFile(file: File, folder: "logos" | "work-orders"): Promise<string> {
  if (!hasSupabaseConfig) return fileToDataUrl(file);
  const safeName = file.name.replace(/[^\w.\-]+/g, "-");
  const path = `${folder}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(path, file, { upsert: false });
  if (error) throw error;
  return path;
}

export async function openPrivateFile(path: string): Promise<void> {
  if (!hasSupabaseConfig || path.startsWith("data:") || path.startsWith("blob:")) {
    window.open(path, "_blank", "noopener,noreferrer");
    return;
  }
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(path, 120);
  if (error) throw error;
  window.open(data.signedUrl, "_blank", "noopener,noreferrer");
}

function readCell(row: Record<string, unknown>, keys: string[]): unknown {
  const found = Object.keys(row).find((key) => keys.includes(key.trim()));
  return found ? row[found] : undefined;
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  const normalized = String(value ?? "").replace(/,/g, "").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toDate(value: unknown, XLSX: XlsxModule): string {
  if (!value) return "";
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return "";
    return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }
  const date = new Date(String(value));
  if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  return String(value);
}

function cell(rows: unknown[][], row: number, column: number): unknown {
  return rows[row]?.[column] ?? "";
}

function looksLikeZunionWorkflow(rows: unknown[][]): boolean {
  return String(cell(rows, 1, 0)).includes("اودرد") || String(cell(rows, 1, 0)).includes("اوردر");
}

function parseZunionWorkflowRows(rows: unknown[][], XLSX: XlsxModule): { orders: OrderInput[]; errors: string[] } {
  const order: OrderInput = {
    ...emptyOrder,
    order_number: String(cell(rows, 3, 0) || "").trim(),
    source_person: String(cell(rows, 3, 1) || cell(rows, 2, 1) || "").trim(),
    client_name: String(cell(rows, 3, 2) || "").trim(),
    client_code: String(cell(rows, 3, 3) || "").trim(),
    phone: String(cell(rows, 7, 0) || "").trim(),
    delivery_date: toDate(cell(rows, 6, 1), XLSX),
    price: toNumber(cell(rows, 6, 2)),
    quantity: toNumber(cell(rows, 11, 1)),
    total: toNumber(cell(rows, 6, 3)),
    paid: toNumber(cell(rows, 6, 4)),
    remaining: toNumber(cell(rows, 6, 5)),
    old_balance: toNumber(cell(rows, 6, 6)),
    net_balance: toNumber(cell(rows, 6, 7)),
    order_type: String(cell(rows, 11, 0) || "").trim(),
    logo_status: String(cell(rows, 11, 2) || "").trim() || "غير موجود",
    work_order_image_url: null,
    quality_notes: [cell(rows, 11, 5), cell(rows, 11, 6)].filter(Boolean).join(" - "),
    operation_status: String(cell(rows, 9, 6) || "").trim(),
    finishing_status: String(cell(rows, 9, 7) || "").trim(),
    order_status: "أوردر جديد",
    client_message: String(cell(rows, 9, 9) || "").trim(),
    notes: String(cell(rows, 11, 4) || "").trim(),
  };

  const errors: string[] = [];
  if (!order.order_number) errors.push("ملف Excel: رقم الأوردر غير موجود في الخلية A4.");
  if (!order.client_name) errors.push("ملف Excel: اسم العميل غير موجود في الخلية C4.");
  if (!order.phone) errors.push("ملف Excel: رقم التليفون غير موجود في الخلية A8.");
  return { orders: errors.length ? [] : [calculateFinancials(order)], errors };
}

export async function importExcel(file: File): Promise<{ imported: number; skipped: number; errors: string[] }> {
  const XLSX = (await import("xlsx")) as XlsxModule;
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const matrixRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: true });

  if (looksLikeZunionWorkflow(matrixRows)) {
    const parsed = parseZunionWorkflowRows(matrixRows, XLSX);
    if (parsed.orders.length > 0) {
      if (!hasSupabaseConfig) {
        writeLocalOrders([...parsed.orders.map((order) => toOrder(order)), ...readLocalOrders()]);
      } else {
        const { error } = await supabase.from("orders").insert(parsed.orders);
        if (error) throw error;
      }
    }
    return { imported: parsed.orders.length, skipped: parsed.orders.length ? 0 : 1, errors: parsed.errors };
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  const valid: OrderInput[] = [];
  const errors: string[] = [];
  let skipped = 0;

  rows.forEach((row, index) => {
    const order: OrderInput = { ...emptyOrder };
    (Object.keys(excelAliases) as Array<keyof OrderInput>).forEach((field) => {
      const value = readCell(row, excelAliases[field]);
      if (["price", "quantity", "total", "paid", "remaining", "old_balance", "net_balance"].includes(field)) {
        (order[field] as number) = toNumber(value);
      } else if (field === "delivery_date") {
        order.delivery_date = toDate(value, XLSX);
      } else if (field === "order_status") {
        order.order_status = normalizeStatus(String(value));
      } else {
        (order[field] as string | null) = value ? String(value).trim() : "";
      }
    });

    if (!order.order_number || !order.client_name || !order.phone) {
      skipped += 1;
      errors.push(`صف ${index + 2}: رقم الأوردر واسم العميل ورقم التليفون حقول مطلوبة.`);
      return;
    }
    valid.push(calculateFinancials(order));
  });

  if (valid.length > 0) {
    if (!hasSupabaseConfig) {
      writeLocalOrders([...valid.map((order) => toOrder(order)), ...readLocalOrders()]);
      return { imported: valid.length, skipped, errors };
    }
    const { error } = await supabase.from("orders").insert(valid);
    if (error) throw error;
  }

  return { imported: valid.length, skipped, errors };
}

export async function exportExcel(orders: Order[], fileName = "zunion-orders.xlsx"): Promise<void> {
  const XLSX = (await import("xlsx")) as XlsxModule;
  const data = orders.map((order) => {
    const calculated = calculateFinancials(order);
    return Object.fromEntries(
      (Object.keys(arabicColumns) as Array<keyof OrderInput>).map((field) => [arabicColumns[field], calculated[field] ?? ""]),
    );
  });
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(data);
  XLSX.utils.book_append_sheet(workbook, sheet, "الأوردرات");
  XLSX.writeFile(workbook, fileName, { compression: true });
}
