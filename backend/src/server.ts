import fs from "node:fs";
import path from "node:path";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import multer from "multer";
import { z } from "zod";
import { config, roleByEmail, type UserRole } from "./config.js";
import { query, tx } from "./db.js";
import { audit, canSeeFinancials, hashSecret, otpCode, randomToken, requireAuth, requireRole } from "./security.js";
import { sendOtpEmail, sendVerificationEmail } from "./mailer.js";
import { customerSchema, orderSchema, statusSchema } from "./validation.js";
import { ensureCustomer, loadOrder, nextOrderNumber } from "./orders.js";

const app = express();
fs.mkdirSync(config.uploadDir, { recursive: true });

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: config.appOrigin, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

const serviceRoutedPrefixes = [
  "/auth",
  "/orders",
  "/customers",
  "/search",
  "/monthly-periods",
  "/expenses",
  "/incomes",
  "/reports",
  "/dashboard",
  "/audit",
];

app.use((req, _res, next) => {
  if (req.path === "/health" || serviceRoutedPrefixes.some((prefix) => req.path === prefix || req.path.startsWith(`${prefix}/`))) {
    req.url = `/api${req.url}`;
  }
  next();
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

const otpRate = new Map<string, number[]>();
const upload = multer({
  dest: config.uploadDir,
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    cb(null, allowed.includes(file.mimetype));
  },
});

function sanitizeFileName(name: string) {
  return name.replace(/[^\w.\-]+/g, "-").slice(0, 120);
}

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value ?? "";
}

function orderVisibility(role: UserRole) {
  if (role === "Worker") return " where status in ('SENT_TO_WORKER','WORKER_STARTED','WORKER_DONE')";
  if (role === "Finish") return " where status in ('SENT_TO_FINISH','FINISH_STARTED','FINISH_DONE','READY')";
  return "";
}

function stripFinancial<T extends Record<string, unknown>>(row: T, role: UserRole): T {
  if (canSeeFinancials(role)) return row;
  const clone = { ...row };
  for (const key of ["price", "total", "paid", "remaining", "old_account", "net_account"]) delete clone[key];
  return clone as T;
}

app.post("/api/auth/request-otp", async (req, res) => {
  const parsed = z.object({ email: z.string().email() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid email" });
  const email = parsed.data.email.toLowerCase();
  if (!(email in roleByEmail)) return res.status(403).json({ message: "Email is not allowed" });
  const now = Date.now();
  const events = (otpRate.get(email) ?? []).filter((time) => now - time < 15 * 60 * 1000);
  if (events.length >= 5) return res.status(429).json({ message: "Too many OTP requests" });
  otpRate.set(email, [...events, now]);

  const otp = otpCode();
  await query("insert into otp_codes (email, otp_hash, expires_at) values ($1,$2,now() + interval '10 minutes')", [email, hashSecret(otp)]);
  await audit(null, "OTP_REQUESTED", "auth", undefined, undefined, { email });
  await sendOtpEmail(email, otp);
  return res.json({ ok: true, devOtp: config.otpDevMode ? otp : undefined });
});

app.post("/api/auth/verify-otp", async (req, res) => {
  const parsed = z.object({ email: z.string().email(), otp: z.string().min(4), stayLoggedIn: z.boolean().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid OTP request" });
  const email = parsed.data.email.toLowerCase();
  if (!(email in roleByEmail)) return res.status(403).json({ message: "Email is not allowed" });
  const otpHash = hashSecret(parsed.data.otp);

  const result = await tx(async (client) => {
    const otp = await client.query<{ id: string }>(
      `select id from otp_codes where email=$1 and otp_hash=$2 and used_at is null and expires_at > now()
       order by created_at desc limit 1 for update`,
      [email, otpHash],
    );
    if (!otp.rows[0]) return null;
    await client.query("update otp_codes set used_at = now() where id = $1", [otp.rows[0].id]);
    const user = await client.query<{ id: string; email: string; role: UserRole }>("select id, email, role from users where email = $1", [email]);
    const token = randomToken();
    const expires = parsed.data.stayLoggedIn ? "14 days" : "8 hours";
    await client.query("insert into sessions (user_id, token_hash, expires_at) values ($1,$2,now() + $3::interval)", [user.rows[0].id, hashSecret(token), expires]);
    return { user: user.rows[0], token, maxAge: parsed.data.stayLoggedIn ? 14 * 24 * 60 * 60 * 1000 : 8 * 60 * 60 * 1000 };
  });

  if (!result) return res.status(401).json({ message: "Invalid or expired OTP" });
  res.cookie(config.cookieName, result.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.nodeEnv === "production",
    maxAge: result.maxAge,
  });
  await audit(result.user, "LOGIN", "auth", undefined, undefined, { email });
  return res.json({ user: result.user });
});

app.post("/api/auth/request-password-code", async (req, res) => {
  const parsed = z.object({ username: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "اسم المستخدم مطلوب." });
  const username = parsed.data.username.trim().toLowerCase();
  const code = otpCode();
  await query(
    "insert into password_reset_codes (username, code_hash, expires_at) values ($1,$2,now() + interval '10 minutes')",
    [username, hashSecret(code)],
  );
  try {
    await sendVerificationEmail(config.resend.passwordChangeEmail, code, "كود تغيير كلمة مرور Zunion");
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "تعذر إرسال كود التحقق. تأكد من إعدادات Resend أو أضف دومين موثق." });
  }
  await audit(null, "PASSWORD_CODE_REQUESTED", "auth", undefined, undefined, { username });
  return res.json({ ok: true, devCode: config.otpDevMode ? code : undefined });
});

app.post("/api/auth/change-password", async (req, res) => {
  const parsed = z.object({
    username: z.string().min(1),
    oldPassword: z.string().min(1),
    newPassword: z.string().min(4),
    code: z.string().min(4),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "كل الحقول مطلوبة." });
  const username = parsed.data.username.trim().toLowerCase();
  const codeHash = hashSecret(parsed.data.code);

  const result = await tx(async (client) => {
    const code = await client.query<{ id: string }>(
      `select id from password_reset_codes
       where username=$1 and code_hash=$2 and used_at is null and expires_at > now()
       order by created_at desc limit 1 for update`,
      [username, codeHash],
    );
    if (!code.rows[0]) return null;
    await client.query("update password_reset_codes set used_at = now() where id = $1", [code.rows[0].id]);
    return true;
  });

  if (!result) return res.status(401).json({ error: "كود التحقق غير صحيح أو انتهت صلاحيته." });
  await audit(null, "PASSWORD_CHANGED", "auth", undefined, undefined, { username });
  return res.json({ ok: true });
});

app.post("/api/auth/logout", requireAuth, async (req, res) => {
  const token = req.cookies?.[config.cookieName];
  if (token) await query("delete from sessions where token_hash=$1", [hashSecret(token)]);
  res.clearCookie(config.cookieName);
  return res.json({ ok: true });
});

app.get("/api/auth/me", requireAuth, (req, res) => res.json({ user: req.user }));

app.get("/api/orders", requireAuth, async (req, res) => {
  const where = orderVisibility(req.user!.role);
  const { search = "", status = "", delivery_date = "", source_party = "" } = req.query as Record<string, string>;
  const filters: string[] = [];
  const params: unknown[] = [];
  if (where) filters.push(where.replace(" where ", ""));
  if (search) {
    params.push(`%${search}%`);
    filters.push(`(order_number ilike $${params.length} or customer_name_snapshot ilike $${params.length} or phone_snapshot ilike $${params.length})`);
  }
  if (status) {
    params.push(status);
    filters.push(`status = $${params.length}`);
  }
  if (delivery_date) {
    params.push(delivery_date);
    filters.push(`delivery_date = $${params.length}`);
  }
  if (source_party) {
    params.push(source_party);
    filters.push(`source_party = $${params.length}`);
  }
  const sqlWhere = filters.length ? `where ${filters.join(" and ")}` : "";
  const { rows } = await query(`select * from orders ${sqlWhere} order by created_at desc`, params);
  res.json({ orders: rows.map((row) => stripFinancial(row, req.user!.role)) });
});

app.post("/api/orders", requireAuth, requireRole("Master", "Helper"), async (req, res) => {
  const parsed = orderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid order", issues: parsed.error.issues });
  const order = parsed.data;
  const inserted = await tx(async (client) => {
    const customerId = await ensureCustomer(client, {
      name: order.customer_name_snapshot,
      code: order.customer_code_snapshot,
      phone: order.phone_snapshot,
      source_party: order.source_party,
      old_balance: order.old_account,
    });
    const result = await client.query<{ id: string }>(
      `insert into orders (
        order_number, customer_id, source_party, customer_name_snapshot, customer_code_snapshot, phone_snapshot,
        delivery_date, type, quantity, price, paid, old_account, status, notes, message_text, quality_notes,
        damaged_pieces, production_notes, finishing_notes, created_by, updated_by
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$20) returning id`,
      [
        nextOrderNumber(), customerId, order.source_party, order.customer_name_snapshot, order.customer_code_snapshot,
        order.phone_snapshot, order.delivery_date || null, order.type, order.quantity, order.price, order.paid,
        order.old_account, order.status, order.notes, order.message_text, order.quality_notes, order.damaged_pieces,
        order.production_notes, order.finishing_notes, req.user!.id,
      ],
    );
    return result.rows[0];
  });
  await audit(req.user!, "ORDER_CREATED", "orders", inserted.id, undefined, order);
  res.status(201).json(inserted);
});

app.get("/api/orders/:id", requireAuth, async (req, res) => {
  const id = param(req.params.id);
  const order = await loadOrder(id);
  if (!order) return res.status(404).json({ message: "Order not found" });
  const files = await query("select id, file_type, original_name, mime_type, size, created_at from order_files where order_id=$1 order by created_at desc", [id]);
  res.json({ order: stripFinancial(order, req.user!.role), files: files.rows });
});

app.put("/api/orders/:id", requireAuth, async (req, res) => {
  const id = param(req.params.id);
  const oldOrder = await loadOrder(id);
  if (!oldOrder) return res.status(404).json({ message: "Order not found" });
  const role = req.user!.role;
  if (role === "Worker" || role === "Finish") return res.status(403).json({ message: "Forbidden" });
  if (role === "Helper" && !["NEW", "SENT_TO_WORKER"].includes(oldOrder.status)) return res.status(403).json({ message: "Production already started" });
  const parsed = orderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid order", issues: parsed.error.issues });
  const order = parsed.data;
  await query(
    `update orders set source_party=$1, customer_name_snapshot=$2, customer_code_snapshot=$3, phone_snapshot=$4,
     delivery_date=$5, type=$6, quantity=$7, price=$8, paid=$9, old_account=$10, status=$11, notes=$12,
     message_text=$13, quality_notes=$14, damaged_pieces=$15, production_notes=$16, finishing_notes=$17, updated_by=$18
     where id=$19`,
    [order.source_party, order.customer_name_snapshot, order.customer_code_snapshot, order.phone_snapshot, order.delivery_date || null, order.type, order.quantity, order.price, order.paid, order.old_account, order.status, order.notes, order.message_text, order.quality_notes, order.damaged_pieces, order.production_notes, order.finishing_notes, req.user!.id, id],
  );
  await audit(req.user!, "ORDER_EDITED", "orders", id, oldOrder, order);
  res.json({ ok: true });
});

app.patch("/api/orders/:id/status", requireAuth, async (req, res) => {
  const id = param(req.params.id);
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid status", issues: parsed.error.issues });
  const oldOrder = await loadOrder(id);
  if (!oldOrder) return res.status(404).json({ message: "Order not found" });
  const role = req.user!.role;
  const allowed =
    role === "Master" ||
    (role === "Helper" && ["SENT_TO_WORKER", "CUSTOMER_MESSAGED"].includes(parsed.data.status)) ||
    (role === "Worker" && ["WORKER_STARTED", "WORKER_DONE"].includes(parsed.data.status)) ||
    (role === "Finish" && ["FINISH_STARTED", "FINISH_DONE", "READY"].includes(parsed.data.status));
  if (!allowed) return res.status(403).json({ message: "Forbidden status transition" });
  await query(
    `update orders set status=$1, production_notes=coalesce($2, production_notes), finishing_notes=coalesce($3, finishing_notes),
     damaged_pieces=coalesce($4, damaged_pieces), updated_by=$5 where id=$6`,
    [parsed.data.status, parsed.data.production_notes ?? null, parsed.data.finishing_notes ?? null, parsed.data.damaged_pieces ?? null, req.user!.id, id],
  );
  await audit(req.user!, "STATUS_CHANGED", "orders", id, { status: oldOrder.status }, parsed.data);
  res.json({ ok: true });
});

app.delete("/api/orders/:id", requireAuth, requireRole("Master"), async (req, res) => {
  const id = param(req.params.id);
  const oldOrder = await loadOrder(id);
  await query("delete from orders where id=$1", [id]);
  await audit(req.user!, "ORDER_DELETED", "orders", id, oldOrder, undefined);
  res.json({ ok: true });
});

app.get("/api/orders/:id/print", requireAuth, async (req, res) => {
  const id = param(req.params.id);
  const order = await loadOrder(id);
  if (!order) return res.status(404).send("Order not found");
  await audit(req.user!, "ORDER_PRINTED", "orders", id);
  res.type("html").send(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${order.order_number}</title><style>
    body{font-family:Arial,Tahoma,sans-serif;margin:32px;color:#222}.header{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #ed1c24;padding-bottom:16px}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-top:24px}.box{border:1px solid #ddd;padding:12px;border-radius:6px}.sign{height:80px}.print{background:#ed1c24;color:white;border:0;border-radius:6px;padding:10px 20px}@media print{.print{display:none}body{margin:12mm}.box{break-inside:avoid}}
  </style></head><body><button class="print" onclick="print()">طباعة</button><div class="header"><h1>Zunion</h1><h2>أمر شغل</h2></div><div class="grid">
    ${Object.entries(order).map(([key, value]) => `<div class="box"><strong>${key}</strong><br>${value ?? ""}</div>`).join("")}
    <div class="box sign">توقيع التشغيل</div><div class="box sign">توقيع التشطيب</div>
  </div></body></html>`);
});

app.post("/api/orders/:id/files", requireAuth, requireRole("Master", "Helper", "Worker", "Finish"), upload.array("files", 5), async (req, res) => {
  const id = param(req.params.id);
  const order = await loadOrder(id);
  if (!order) return res.status(404).json({ message: "Order not found" });
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const saved = [];
  for (const file of files) {
    const ext = path.extname(file.originalname).toLowerCase();
    const storedName = `${file.filename}${ext}`;
    const nextPath = path.join(config.uploadDir, storedName);
    fs.renameSync(file.path, nextPath);
    const result = await query<{ id: string }>(
      `insert into order_files (order_id, file_type, original_name, stored_name, mime_type, size, path, uploaded_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [id, req.body.file_type ?? "attachment", sanitizeFileName(file.originalname), storedName, file.mimetype, file.size, storedName, req.user!.id],
    );
    saved.push(result.rows[0]);
  }
  await audit(req.user!, "FILE_UPLOADED", "orders", id, undefined, saved);
  res.status(201).json({ files: saved });
});

app.get("/api/orders/:id/files/:fileId", requireAuth, async (req, res) => {
  const id = param(req.params.id);
  const fileId = param(req.params.fileId);
  const { rows } = await query<{ path: string; original_name: string }>("select path, original_name from order_files where id=$1 and order_id=$2", [fileId, id]);
  if (!rows[0]) return res.status(404).json({ message: "File not found" });
  res.download(path.join(config.uploadDir, rows[0].path), rows[0].original_name);
});

app.get("/api/customers", requireAuth, requireRole("Master", "Helper"), async (req, res) => {
  const search = String(req.query.search ?? "");
  const params = search ? [`%${search}%`] : [];
  const where = search ? "where c.name ilike $1 or c.phone ilike $1 or c.code ilike $1" : "";
  const { rows } = await query(
    `select c.*, count(o.id)::int as total_orders, coalesce(sum(o.paid),0) as total_paid,
     coalesce(sum(o.remaining),0) as remaining_balance, c.old_balance + coalesce(sum(o.remaining),0) as net_account
     from customers c left join orders o on o.customer_id=c.id ${where}
     group by c.id order by c.updated_at desc`,
    params,
  );
  res.json({ customers: rows });
});

app.post("/api/customers", requireAuth, requireRole("Master", "Helper"), async (req, res) => {
  const parsed = customerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid customer", issues: parsed.error.issues });
  const customer = parsed.data;
  const { rows } = await query<{ id: string }>(
    "insert into customers (name, code, phone, source_party, old_balance, notes) values ($1,$2,$3,$4,$5,$6) returning id",
    [customer.name, customer.code, customer.phone, customer.source_party, customer.old_balance, customer.notes],
  );
  await audit(req.user!, "CUSTOMER_CREATED", "customers", rows[0].id, undefined, customer);
  res.status(201).json(rows[0]);
});

app.get("/api/customers/:id", requireAuth, requireRole("Master", "Helper"), async (req, res) => {
  const id = param(req.params.id);
  const customer = await query("select * from customers where id=$1", [id]);
  if (!customer.rows[0]) return res.status(404).json({ message: "Customer not found" });
  res.json({ customer: customer.rows[0] });
});

app.put("/api/customers/:id", requireAuth, requireRole("Master"), async (req, res) => {
  const id = param(req.params.id);
  const parsed = customerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid customer", issues: parsed.error.issues });
  const old = await query("select * from customers where id=$1", [id]);
  await query("update customers set name=$1, code=$2, phone=$3, source_party=$4, old_balance=$5, notes=$6 where id=$7", [parsed.data.name, parsed.data.code, parsed.data.phone, parsed.data.source_party, parsed.data.old_balance, parsed.data.notes, id]);
  await audit(req.user!, "CUSTOMER_BALANCE_UPDATED", "customers", id, old.rows[0], parsed.data);
  res.json({ ok: true });
});

app.get("/api/customers/:id/orders", requireAuth, requireRole("Master", "Helper"), async (req, res) => {
  const id = param(req.params.id);
  const { rows } = await query("select * from orders where customer_id=$1 order by created_at desc", [id]);
  res.json({ orders: rows });
});

app.get("/api/search/orders", requireAuth, async (req, res) => {
  const search = String(req.query.q ?? "");
  const params = search ? [`%${search}%`] : [];
  const where = search ? "where o.order_number ilike $1 or o.customer_name_snapshot ilike $1 or o.customer_code_snapshot ilike $1 or o.phone_snapshot ilike $1 or o.source_party ilike $1 or i.product_name ilike $1" : "";
  const { rows } = await query(`select distinct o.* from orders o left join order_items i on i.order_id=o.id ${where} order by o.created_at desc`, params);
  res.json({ orders: rows.map((row) => stripFinancial(row, req.user!.role)) });
});

const itemBody = z.object({
  product_name: z.string().min(1),
  details: z.string().optional().default(""),
  logo_place: z.string().optional().default(""),
  quantity: z.coerce.number().int().min(0).default(1),
  price: z.coerce.number().min(0).default(0),
  quality: z.string().optional().default(""),
  status: z.string().optional().default("NEW"),
});

app.post("/api/orders/:id/items", requireAuth, requireRole("Master", "Helper"), async (req, res) => {
  const id = param(req.params.id);
  const parsed = itemBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid item", issues: parsed.error.issues });
  const { rows } = await query<{ id: string }>(
    "insert into order_items (order_id, product_name, details, logo_place, quantity, price, quality, status) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id",
    [id, parsed.data.product_name, parsed.data.details, parsed.data.logo_place, parsed.data.quantity, parsed.data.price, parsed.data.quality, parsed.data.status],
  );
  await audit(req.user!, "ORDER_ITEM_CREATED", "orders", id, undefined, parsed.data);
  res.status(201).json(rows[0]);
});

app.put("/api/orders/:id/items/:itemId", requireAuth, requireRole("Master", "Helper", "Worker", "Finish"), async (req, res) => {
  const id = param(req.params.id);
  const itemId = param(req.params.itemId);
  const parsed = itemBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid item", issues: parsed.error.issues });
  await query("update order_items set product_name=$1, details=$2, logo_place=$3, quantity=$4, price=$5, quality=$6, status=$7 where id=$8 and order_id=$9", [parsed.data.product_name, parsed.data.details, parsed.data.logo_place, parsed.data.quantity, parsed.data.price, parsed.data.quality, parsed.data.status, itemId, id]);
  await audit(req.user!, "ORDER_ITEM_UPDATED", "orders", id, undefined, parsed.data);
  res.json({ ok: true });
});

app.delete("/api/orders/:id/items/:itemId", requireAuth, requireRole("Master", "Helper"), async (req, res) => {
  const id = param(req.params.id);
  const itemId = param(req.params.itemId);
  await query("delete from order_items where id=$1 and order_id=$2", [itemId, id]);
  await audit(req.user!, "ORDER_ITEM_DELETED", "orders", id, { itemId });
  res.json({ ok: true });
});

app.get("/api/monthly-periods", requireAuth, requireRole("Master", "Helper"), async (_req, res) => {
  const { rows } = await query("select * from monthly_periods order by year desc, month desc");
  res.json({ periods: rows });
});

app.post("/api/monthly-periods", requireAuth, requireRole("Master", "Helper"), async (req, res) => {
  const parsed = z.object({ month: z.coerce.number().int().min(1).max(12), year: z.coerce.number().int().min(2000), notes: z.string().optional().default("") }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid month", issues: parsed.error.issues });
  const { rows } = await query<{ id: string }>("insert into monthly_periods (month, year, notes, opened_by) values ($1,$2,$3,$4) on conflict (month, year) do update set notes=excluded.notes returning id", [parsed.data.month, parsed.data.year, parsed.data.notes, req.user!.id]);
  await audit(req.user!, "MONTH_OPENED", "monthly_periods", rows[0].id, undefined, parsed.data);
  res.status(201).json(rows[0]);
});

app.get("/api/expenses", requireAuth, requireRole("Master", "Helper"), async (_req, res) => {
  const { rows } = await query("select * from expenses order by created_at desc");
  res.json({ expenses: rows });
});

app.post("/api/expenses", requireAuth, requireRole("Master", "Helper"), async (req, res) => {
  const parsed = z.object({ monthly_period_id: z.string().uuid(), type: z.string().min(1), quantity: z.coerce.number().min(0), price: z.coerce.number().min(0) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid expense", issues: parsed.error.issues });
  const { rows } = await query<{ id: string }>("insert into expenses (monthly_period_id, type, quantity, price, created_by) values ($1,$2,$3,$4,$5) returning id", [parsed.data.monthly_period_id, parsed.data.type, parsed.data.quantity, parsed.data.price, req.user!.id]);
  await audit(req.user!, "EXPENSE_ADDED", "expenses", rows[0].id, undefined, parsed.data);
  res.status(201).json(rows[0]);
});

app.get("/api/incomes", requireAuth, requireRole("Master", "Helper"), async (_req, res) => {
  const { rows } = await query("select * from incomes order by created_at desc");
  res.json({ incomes: rows });
});

app.post("/api/incomes", requireAuth, requireRole("Master", "Helper"), async (req, res) => {
  const parsed = z.object({ monthly_period_id: z.string().uuid(), from_name: z.string().min(1), value: z.coerce.number().min(0), reason: z.string().optional().default("") }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid income", issues: parsed.error.issues });
  const { rows } = await query<{ id: string }>("insert into incomes (monthly_period_id, from_name, value, reason, created_by) values ($1,$2,$3,$4,$5) returning id", [parsed.data.monthly_period_id, parsed.data.from_name, parsed.data.value, parsed.data.reason, req.user!.id]);
  await audit(req.user!, "INCOME_ADDED", "incomes", rows[0].id, undefined, parsed.data);
  res.status(201).json(rows[0]);
});

app.get("/api/reports/monthly-summary", requireAuth, requireRole("Master", "Helper"), async (_req, res) => {
  const { rows } = await query(`select p.id, p.month, p.year,
    coalesce(sum(e.total),0) as expenses,
    coalesce((select sum(i.value) from incomes i where i.monthly_period_id=p.id),0) as incomes
    from monthly_periods p left join expenses e on e.monthly_period_id=p.id
    group by p.id order by p.year desc, p.month desc`);
  res.json({ summary: rows.map((row) => ({ ...row, net: Number(row.incomes) - Number(row.expenses) })) });
});

app.get("/api/dashboard/summary", requireAuth, async (req, res) => {
  const where = orderVisibility(req.user!.role);
  const { rows } = await query(`select
    count(*)::int as total_orders,
    count(*) filter (where status='NEW')::int as new_orders,
    count(*) filter (where status in ('SENT_TO_WORKER','WORKER_STARTED'))::int as in_production,
    count(*) filter (where status in ('SENT_TO_FINISH','FINISH_STARTED'))::int as in_finishing,
    count(*) filter (where status='READY')::int as ready_orders,
    count(*) filter (where status='DELIVERED')::int as delivered_orders,
    coalesce(sum(remaining),0) as total_unpaid_balance,
    count(*) filter (where delivery_date in (current_date, current_date + interval '1 day'))::int as today_tomorrow_deliveries
    from orders ${where}`);
  res.json({ summary: stripFinancial(rows[0], req.user!.role) });
});

app.get("/api/dashboard/alerts", requireAuth, async (req, res) => {
  const where = orderVisibility(req.user!.role);
  const { rows } = await query(`select id, order_number, customer_name_snapshot, delivery_date, status, remaining, updated_at
    from orders ${where}
    order by delivery_date asc nulls last`);
  const now = Date.now();
  const alerts = rows.flatMap((order) => {
    const result = [];
    const delivery = order.delivery_date ? new Date(order.delivery_date) : null;
    if (delivery) {
      const diff = Math.round((delivery.setHours(0,0,0,0) - new Date().setHours(0,0,0,0)) / 86400000);
      if (diff === 0) result.push({ type: "DELIVERY_TODAY", order });
      if (diff === 1) result.push({ type: "DELIVERY_TOMORROW", order });
    }
    if (order.status === "READY") result.push({ type: "READY_NOT_MESSAGED", order });
    if (Number(order.remaining) > 0 && canSeeFinancials(req.user!.role)) result.push({ type: "REMAINING_BALANCE", order });
    if (now - new Date(order.updated_at).getTime() > 3 * 86400000 && !["DELIVERED", "CANCELLED"].includes(order.status)) result.push({ type: "STUCK_STAGE", order });
    return result;
  });
  res.json({ alerts });
});

app.get("/api/audit", requireAuth, requireRole("Master"), async (_req, res) => {
  const { rows } = await query("select * from audit_logs order by created_at desc limit 500");
  res.json({ audit: rows });
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  const message = error instanceof Error ? error.message : "Internal server error";
  res.status(500).json({ message: config.nodeEnv === "production" ? "Internal server error" : message });
});

app.listen(config.port, () => console.log(`Zunion API listening on ${config.port}`));
