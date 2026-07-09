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

export const orderSchema = z.object({
  source_party: z.string().min(1),
  customer_name_snapshot: z.string().min(1),
  customer_code_snapshot: z.string().optional().default(""),
  phone_snapshot: z.string().min(1),
  delivery_date: z.string().optional().nullable(),
  type: z.string().optional().default(""),
  quantity: z.coerce.number().int().min(0).default(1),
  price: z.coerce.number().min(0).default(0),
  paid: z.coerce.number().min(0).default(0),
  old_account: z.coerce.number().default(0),
  status: z.enum(orderStatuses).default("NEW"),
  notes: z.string().optional().default(""),
  message_text: z.string().optional().default(""),
  quality_notes: z.string().optional().default(""),
  damaged_pieces: z.coerce.number().int().min(0).default(0),
  production_notes: z.string().optional().default(""),
  finishing_notes: z.string().optional().default(""),
});

export const statusSchema = z.object({
  status: z.enum(orderStatuses),
  production_notes: z.string().optional(),
  finishing_notes: z.string().optional(),
  damaged_pieces: z.coerce.number().int().min(0).optional(),
});

export const customerSchema = z.object({
  name: z.string().min(1),
  code: z.string().optional().default(""),
  phone: z.string().min(1),
  source_party: z.string().optional().default(""),
  old_balance: z.coerce.number().default(0),
  notes: z.string().optional().default(""),
});
