import { z } from "zod";

export const orderStatuses = [
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
] as const;

export const workStages = ["new", "operation", "finishing", "completed", "cancelled"] as const;
export const paymentMethods = ["cash", "bank_transfer", "instapay", "wallet", "deferred", "other"] as const;
export const materialsStatuses = ["available", "unavailable"] as const;
export const productStatuses = ["active", "inactive"] as const;

function normalizeMaterialsStatus(value: unknown) {
  const raw = String(value ?? "").trim();
  if (raw === "available" || raw === "موجود" || raw === "متوفرة") return "available";
  if (raw === "unavailable" || raw === "غير موجود" || raw === "غير متوفرة") return "unavailable";
  return raw;
}

export const productSchema = z.object({
  productName: z.string().trim().min(1, "اسم المنتج مطلوب"),
  details: z.string().optional().default(""),
  logoPlacement: z.string().optional().default(""),
  defaultQuantity: z.coerce.number().int().min(1, "العدد يجب أن يكون 1 على الأقل").default(1),
  defaultPrice: z.coerce.number().min(0, "السعر لا يمكن أن يكون بالسالب").nullable().optional(),
  quality: z.string().optional().default(""),
  status: z.enum(productStatuses, { message: "حالة المنتج غير صحيحة" }).default("active"),
  productImage: z.string().optional().default(""),
  logoImage: z.string().optional().default(""),
}).transform((product) => ({
  ...product,
  defaultTotal: product.defaultPrice == null ? null : product.defaultQuantity * product.defaultPrice,
}));

export const orderSchema = z.object({
  source_party: z.string().default(""),
  customer_name_snapshot: z.string().default(""),
  customer_code_snapshot: z.string().optional().default(""),
  phone_snapshot: z.string().optional().default(""),
  delivery_date: z.string().optional().nullable(),
  type: z.string().optional().default(""),
  productId: z.string().uuid().optional(),
  productName: z.string().optional().default(""),
  paymentMethod: z.enum(paymentMethods).default("cash"),
  customPaymentMethod: z.string().optional().default(""),
  materialsStatus: z.preprocess(normalizeMaterialsStatus, z.enum(materialsStatuses).default("available").optional()),
  operationMethods: z.array(z.string().trim()).default(["not_started"]),
  quantity: z.coerce.number().default(0),
  price: z.coerce.number().min(0).default(0),
  paid: z.coerce.number().min(0).default(0),
  old_account: z.coerce.number().default(0),
  status: z.enum(orderStatuses).default("NEW"),
  workStage: z.enum(workStages).default("new"),
  notes: z.string().optional().default(""),
  message_text: z.string().optional().default(""),
  quality_notes: z.string().optional().default(""),
  damaged_pieces: z.coerce.number().int().min(0).default(0),
  production_notes: z.string().optional().default(""),
  finishing_notes: z.string().optional().default(""),
  details: z.string().optional().default(""),
  draft: z.boolean().optional().default(false),
  operation_attachments: z.array(z.object({
    method: z.string().default(""),
    workOrder: z.boolean().optional().default(false),
    logo: z.boolean().optional().default(false),
  })).optional().default([]),
}).superRefine((order, ctx) => {
  const isDraft = order.draft === true;
  if (isDraft) {
    order.quantity = Math.max(0, Math.abs(order.quantity));
    return;
  }
  if (!order.source_party.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["source_party"], message: "الطرف مطلوب" });
  }
  if (!order.customer_name_snapshot.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["customer_name_snapshot"], message: "اسم العميل مطلوب" });
  }
  if (order.quantity < 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["quantity"], message: "العدد يجب أن يكون 1 على الأقل" });
  }
  if (!order.materialsStatus) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["materialsStatus"], message: "يجب تحديد حالة الخامات" });
  }
  if (!order.operationMethods.length || order.operationMethods.some((m) => !m.trim())) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["operationMethods"], message: "يجب إضافة طريقة تشغيل واحدة على الأقل" });
  }
  const total = order.quantity * order.price;
  if (order.paid > total) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["paid"], message: "المدفوع لا يمكن أن يكون أكبر من الإجمالي" });
  }
  if (order.paymentMethod === "other" && !order.customPaymentMethod.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["customPaymentMethod"], message: "اكتب طريقة الدفع" });
  }
});

export const statusSchema = z.object({
  status: z.enum(orderStatuses),
  workStage: z.enum(workStages).optional(),
  production_notes: z.string().optional(),
  finishing_notes: z.string().optional(),
  damaged_pieces: z.coerce.number().int().min(0).optional(),
});

export const customerSchema = z.object({
  name: z.string().min(1),
  code: z.string().optional().default(""),
  phone: z.string().min(1),
  email: z.string().trim().toLowerCase().email().or(z.literal("")).optional().default(""),
  address: z.string().trim().optional().default(""),
  source_party: z.string().optional().default(""),
  old_balance: z.coerce.number().default(0),
  notes: z.string().optional().default(""),
});
