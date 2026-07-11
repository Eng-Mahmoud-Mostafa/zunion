import { Component, Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import * as XLSX from "xlsx";
import {
  ArrowDownCircle,
  ArrowUpDown,
  BadgeInfo,
  Banknote,
  CircleDollarSign,
  ClipboardList,
  Cog,
  FilePlus,
  Image,
  KeyRound,
  Landmark,
  Menu,
  PackagePlus,
  Paintbrush,
  Plus,
  Receipt,
  Search,
  Send,
  Truck,
  UserPlus,
  Users,
  Wallet,
  WalletCards,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { BrandLogo } from "./components/BrandLogo";
import { formatDateArabic, formatMoney, formatNumber } from "./utils/formatters";
import {
  getDashboardStats,
  getMonthlyFinancialStats,
  getOperationStats,
  getReportsData,
  createTransaction,
  type DashboardStats,
  type DbOrder,
  type DbTransaction,
  type OperationStats,
  type ReportsData,
} from "./services/statsService";

type OrderStatus = "جديد" | "في التشغيل" | "في التشطيب" | "جاهز" | "تم التسليم" | "مشكلة جودة" | "متأخر";
type WorkflowStage = "أوردر جديد" | "يروح للتشغيل" | "التشغيل" | "يروح للتشطيب" | "التشطيب" | "الشغل جاهز" | "تم التسليم";
type View = "dashboard" | "orders" | "new" | "addCustomer" | "addProduct" | "search" | "worker" | "finish" | "customers" | "finance" | "reports" | "audit" | "import" | "alerts" | "settings";
type Role = "Master" | "Operator" | "Supervisor" | "Finishing" | "Helper" | "Worker" | "Finish";
type Session = { email: string; username?: string; fullName?: string; role: Role; expiresAt: string; loggedInAt: string };
type OrderItem = {
  id: string;
  product_name: string;
  details: string;
  product_image_url: string;
  logo_url: string;
  logo_place: string;
  quantity: number;
  price: number;
  total: number;
  quality: string;
  status: string;
};
type Customer = {
  id: string;
  source_person: string;
  client_name: string;
  client_code: string;
  phone: string;
  old_balance: number;
  notes: string;
  created_at: string;
};
type FinanceRecord = {
  id: string;
  kind: "expense" | "income";
  month: string;
  type: string;
  quantity: number;
  price: number;
  total: number;
  from_name: string;
  value: number;
  reason: string;
  created_at: string;
};
type Product = {
  id: string;
  name: string;
  details: string;
  price: number;
  created_at: string;
};
type AuditEntry = {
  id: string;
  user_email: string;
  user_role: Role;
  action: string;
  entity_type: string;
  entity_id?: string;
  old_value?: unknown;
  new_value?: unknown;
  created_at: string;
};
type Alert = { label: string; order: Order; tone?: "late" };

type Order = {
  id: string;
  created_by: string;
  order_number: string;
  source_person: string;
  client_name: string;
  client_code: string;
  phone: string;
  delivery_date: string;
  price: number;
  quantity: number;
  total: number;
  paid: number;
  remaining: number;
  old_balance: number;
  net_balance: number;
  order_type: string;
  details: string;
  logo_place: string;
  items: OrderItem[];
  logo_status: string;
  logo_image_url: string;
  work_order_image_url: string;
  quality_notes: string;
  damaged_pieces: number;
  operation_status: string;
  finishing_status: string;
  production_notes: string;
  finishing_notes: string;
  order_status: OrderStatus;
  workflow_stage: WorkflowStage;
  client_message: string;
  notes: string;
  internal_notes: string;
  created_at: string;
  updated_at: string;
};

const allowedEmail = "mahmoudmostafa3104@gmail.com";
const storageKey = "zunion-local-orders-v2";
const sessionKey = "zunion-local-session";
const auditKey = "zunion-local-audit-v1";
const customersKey = "zunion-local-customers-v1";
const financeKey = "zunion-local-finance-v1";
const productsKey = "zunion-local-products-v1";
const localPasswordsKey = "zunion-local-passwords-v1";
const partyOptions = ["أحمد", "حسن", "خليفة", "أخرى"];

const roleByEmail: Record<string, Role> = {
  "mahmoudmostafa3104@gmail.com": "Master",
  "mahmoudelwensh2007@gmail.com": "Helper",
  "mahmoudodo20072021@gmail.com": "Worker",
  "mahmoud.foly.2007@gmail.com": "Finish",
};

const localUsers: Record<string, { fullName: string; role: Role; password: string; email: string; mustChangePassword: boolean }> = {
  mahmoud: { fullName: "Mahmoud", role: "Master", password: "1234", email: "mahmoud@zunion.local", mustChangePassword: true },
  reda: { fullName: "Reda", role: "Master", password: "1234", email: "reda@zunion.local", mustChangePassword: true },
  hassan: { fullName: "Hassan", role: "Master", password: "1234", email: "hassan@zunion.local", mustChangePassword: true },
  omar: { fullName: "Omar", role: "Operator", password: "1234", email: "omar@zunion.local", mustChangePassword: true },
  youssef: { fullName: "Youssef", role: "Operator", password: "1234", email: "youssef@zunion.local", mustChangePassword: true },
  khalifa: { fullName: "Khalifa", role: "Operator", password: "1234", email: "khalifa@zunion.local", mustChangePassword: true },
  "opr 1": { fullName: "Opr 1", role: "Operator", password: "1234", email: "opr1@zunion.local", mustChangePassword: true },
  "opr 2": { fullName: "Opr 2", role: "Operator", password: "1234", email: "opr2@zunion.local", mustChangePassword: true },
  "opr 3": { fullName: "Opr 3", role: "Operator", password: "1234", email: "opr3@zunion.local", mustChangePassword: true },
  "supervisor 1": { fullName: "Supervisor 1", role: "Supervisor", password: "1234", email: "supervisor1@zunion.local", mustChangePassword: true },
  "supervisor 2": { fullName: "Supervisor 2", role: "Supervisor", password: "1234", email: "supervisor2@zunion.local", mustChangePassword: true },
  "supervisor 3": { fullName: "Supervisor 3", role: "Supervisor", password: "1234", email: "supervisor3@zunion.local", mustChangePassword: true },
  "finishing 1": { fullName: "Finishing 1", role: "Finishing", password: "1234", email: "finishing1@zunion.local", mustChangePassword: true },
  "finishing 2": { fullName: "Finishing 2", role: "Finishing", password: "1234", email: "finishing2@zunion.local", mustChangePassword: true },
};

function loadLocalPasswords(): Record<string, { password: string; mustChangePassword: boolean }> {
  try {
    return JSON.parse(localStorage.getItem(localPasswordsKey) || "{}") as Record<string, { password: string; mustChangePassword: boolean }>;
  } catch {
    localStorage.removeItem(localPasswordsKey);
    return {};
  }
}

function getLocalUser(username: string) {
  const base = localUsers[username];
  if (!base) return null;
  const saved = loadLocalPasswords()[username];
  return {
    ...base,
    password: saved?.password || base.password,
    mustChangePassword: saved?.mustChangePassword ?? base.mustChangePassword,
  };
}

function saveLocalPassword(username: string, password: string) {
  const current = loadLocalPasswords();
  localStorage.setItem(localPasswordsKey, JSON.stringify({
    ...current,
    [username]: { password, mustChangePassword: false },
  }));
}

const workflowStages: WorkflowStage[] = ["أوردر جديد", "يروح للتشغيل", "التشغيل", "يروح للتشطيب", "التشطيب", "الشغل جاهز", "تم التسليم"];
const statuses: OrderStatus[] = ["جديد", "في التشغيل", "في التشطيب", "جاهز", "تم التسليم", "مشكلة جودة", "متأخر"];

function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `order-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function nextOrderNumber(orders: Order[]) {
  const date = new Date();
  const prefix = `${String(date.getFullYear()).slice(-2)}-${date.getMonth() + 1}-${date.getDate()}`;
  const next = orders
    .map((order) => order.order_number)
    .filter((number) => number.startsWith(`${prefix}-`))
    .map((number) => {
      const parts = number.split("-");
      return Number(parts[parts.length - 1] || 0);
    })
    .reduce((max, number) => Math.max(max, Number.isFinite(number) ? number : 0), 0) + 1;
  return `${prefix}-${String(next).padStart(6, "0")}`;
}

function partyPrefix(value: string) {
  const normalized = value.trim();
  if (normalized.includes("أحمد") || normalized.includes("احمد")) return "A";
  if (normalized.includes("حسن")) return "H";
  if (normalized.includes("خليفة")) return "K";
  return "C";
}

function nextCustomerCode(customers: Customer[], party: string) {
  const prefix = partyPrefix(party);
  const next = customers
    .map((customer) => customer.client_code)
    .filter((code) => code.startsWith(`${prefix}-`))
    .map((code) => Number(code.split("-")[1] || 0))
    .reduce((max, value) => Math.max(max, Number.isFinite(value) ? value : 0), 0) + 1;
  return `${prefix}-${String(next).padStart(4, "0")}`;
}

function loadSession(): Session | null {
  try {
    const session = JSON.parse(localStorage.getItem(sessionKey) || "null") as Session | null;
    if (!session || new Date(session.expiresAt).getTime() <= Date.now()) {
      localStorage.removeItem(sessionKey);
      return null;
    }
    return session;
  } catch {
    localStorage.removeItem(sessionKey);
    return null;
  }
}

function loadAudit(): AuditEntry[] {
  try {
    return JSON.parse(localStorage.getItem(auditKey) || "[]") as AuditEntry[];
  } catch {
    localStorage.removeItem(auditKey);
    return [];
  }
}

function addAudit(session: Session | null, action: string, entityType: string, entityId?: string, oldValue?: unknown, newValue?: unknown) {
  const entry: AuditEntry = {
    id: createId(),
    user_email: session?.email || "local",
    user_role: session?.role || "Master",
    action,
    entity_type: entityType,
    entity_id: entityId,
    old_value: oldValue,
    new_value: newValue,
    created_at: new Date().toISOString(),
  };
  localStorage.setItem(auditKey, JSON.stringify([entry, ...loadAudit()].slice(0, 500)));
}

const arabicColumns: Record<keyof Order, string> = {
  id: "ID",
  created_by: "بواسطة",
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
  details: "تفاصيل",
  logo_place: "مكان اللوجو",
  items: "المنتجات",
  logo_status: "اللوجو",
  logo_image_url: "رابط اللوجو",
  work_order_image_url: "أمر الشغل",
  quality_notes: "الجودة",
  damaged_pieces: "قطعة مقطوعة",
  operation_status: "التشغيل",
  finishing_status: "التشطيب",
  production_notes: "ملاحظات التشغيل",
  finishing_notes: "ملاحظات التشطيب",
  order_status: "الحالة",
  workflow_stage: "مرحلة الشغل",
  client_message: "الرسالة",
  notes: "ملاحظات",
  internal_notes: "ملاحظات داخلية",
  created_at: "تاريخ الإنشاء",
  updated_at: "آخر تعديل",
};

const emptyOrder: Order = {
  id: "",
  created_by: "",
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
  details: "",
  logo_place: "",
  items: [],
  logo_status: "غير موجود",
  logo_image_url: "",
  work_order_image_url: "",
  quality_notes: "",
  damaged_pieces: 0,
  operation_status: "لم يبدأ",
  finishing_status: "لم يبدأ",
  production_notes: "",
  finishing_notes: "",
  order_status: "جديد",
  workflow_stage: "أوردر جديد",
  client_message: "",
  notes: "",
  internal_notes: "",
  created_at: "",
  updated_at: "",
};

const demoOrders: Order[] = [
  calculate({
    ...emptyOrder,
    id: createId(),
    created_by: "mahmoudmostafa3104@gmail.com",
    order_number: "26-6-8-000112",
    source_person: "احمد",
    client_name: "احمد عصام",
    client_code: "115",
    phone: "1111577055",
    delivery_date: isoOffset(0),
    price: 52,
    quantity: 50,
    paid: 1600,
    old_balance: 2000,
    order_type: "كتابة",
    details: "أوردر مطابق لمثال Excel",
    logo_place: "الصدر",
    logo_status: "موجود",
    order_status: "في التشغيل",
    workflow_stage: "التشغيل",
    operation_status: "جاري التشغيل",
    notes: "هنسلم بكره ان شاء الله",
    items: [{
      id: createId(),
      product_name: "كتابة",
      details: "هنسلم بكره ان شاء الله",
      product_image_url: "",
      logo_url: "",
      logo_place: "الصدر",
      quantity: 50,
      price: 52,
      total: 2600,
      quality: "",
      status: "جديد",
    }],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }),
  calculate({
    ...emptyOrder,
    id: createId(),
    created_by: "mahmoudelwensh2007@gmail.com",
    order_number: "1002",
    source_person: "واتساب",
    client_name: "شركة النور",
    client_code: "C-002",
    phone: "01111111111",
    delivery_date: isoOffset(1),
    price: 220,
    quantity: 15,
    paid: 2000,
    order_type: "تيشيرت",
    details: "تيشيرتات شركة",
    logo_place: "أمام",
    logo_status: "غير موجود",
    order_status: "جاهز",
    workflow_stage: "الشغل جاهز",
    finishing_status: "تم التشطيب",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }),
];

function isoOffset(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function calculate(order: Order): Order {
  const items = (order.items || []).map((item) => ({ ...item, total: Number(item.quantity || 0) * Number(item.price || 0) }));
  const lineTotal = items.reduce((sum, item) => sum + item.total, 0);
  const total = lineTotal || Number(order.price || 0) * Number(order.quantity || 0);
  const remaining = total - Number(order.paid || 0);
  return { ...order, items, total, remaining, net_balance: remaining + Number(order.old_balance || 0) };
}

function orderForStorage(order: Order): Order {
  return {
    ...order,
    logo_image_url: order.logo_image_url.startsWith("blob:") || order.logo_image_url.startsWith("data:") ? "" : order.logo_image_url,
    work_order_image_url: order.work_order_image_url.startsWith("blob:") || order.work_order_image_url.startsWith("data:") ? "" : order.work_order_image_url,
    items: (order.items || []).map((item) => ({
      ...item,
      product_image_url: item.product_image_url.startsWith("blob:") || item.product_image_url.startsWith("data:") ? "" : item.product_image_url,
      logo_url: item.logo_url.startsWith("blob:") || item.logo_url.startsWith("data:") ? "" : item.logo_url,
    })),
  };
}

function useOrders() {
  const [orders, setOrders] = useState<Order[]>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      const parsed = stored ? JSON.parse(stored) as Order[] : demoOrders;
      return parsed.map(orderForStorage);
    } catch {
      localStorage.removeItem(storageKey);
      return demoOrders;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(orders.map(orderForStorage)));
    } catch {
      localStorage.removeItem(storageKey);
    }
  }, [orders]);

  return { orders, setOrders };
}

function useStoredList<T>(key: string, fallback: T[]) {
  const [items, setItems] = useState<T[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) || "null") as T[] || fallback;
    } catch {
      localStorage.removeItem(key);
      return fallback;
    }
  });
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(items));
  }, [items, key]);
  return { items, setItems };
}

function daysUntil(date: string) {
  if (!date) return 9999;
  const today = new Date();
  const target = new Date(`${date}T00:00:00`);
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function buildAlerts(orders: Order[], includeFinancial = true): Alert[] {
  return orders.flatMap((order) => {
    const alerts: Alert[] = [];
    const diff = daysUntil(order.delivery_date);
    if (diff < 0 && order.order_status !== "تم التسليم") alerts.push({ label: "متأخر", order, tone: "late" });
    if (diff === 0 && order.order_status !== "تم التسليم") alerts.push({ label: "تسليم اليوم", order });
    if (diff === 1 && order.order_status !== "تم التسليم") alerts.push({ label: "تسليم غدا", order });
    if (order.order_status === "جاهز" && !order.client_message.trim()) alerts.push({ label: "جاهز ولم يتم إبلاغ العميل", order });
    if (includeFinancial && order.remaining > 0) alerts.push({ label: "يوجد باقي حساب", order });
    if (Date.now() - new Date(order.updated_at || order.created_at || Date.now()).getTime() > 3 * 86400000 && order.order_status !== "تم التسليم") alerts.push({ label: "متوقف في نفس المرحلة", order, tone: "late" });
    return alerts;
  });
}

function statusClass(status: OrderStatus) {
  return {
    "جديد": "badge badge-blue",
    "في التشغيل": "badge badge-amber",
    "في التشطيب": "badge badge-violet",
    "جاهز": "badge badge-green",
    "تم التسليم": "badge badge-gray",
    "مشكلة جودة": "badge badge-red",
    "متأخر": "badge badge-red",
  }[status];
}

function canManageFinancials(role: Role) {
  return role === "Master" || role === "Helper";
}

function canEditOrder(role: Role, order?: Order) {
  if (role === "Master") return true;
  if (role === "Operator") return !order || ["أوردر جديد", "يروح للتشغيل", "التشغيل"].includes(order.workflow_stage);
  if (role === "Supervisor") return Boolean(order && ["يروح للتشغيل", "التشغيل"].includes(order.workflow_stage));
  if (role === "Finishing") return Boolean(order && ["يروح للتشطيب", "التشطيب", "الشغل جاهز"].includes(order.workflow_stage));
  if (role === "Helper") return !order || ["أوردر جديد", "يروح للتشغيل"].includes(order.workflow_stage);
  return false;
}

function canDeleteOrder(role: Role) {
  return role === "Master";
}

function roleOrders(role: Role, orders: Order[]) {
  if (role === "Operator" || role === "Supervisor" || role === "Worker") return orders.filter((order) => ["يروح للتشغيل", "التشغيل"].includes(order.workflow_stage));
  if (role === "Finishing" || role === "Finish") return orders.filter((order) => ["يروح للتشطيب", "التشطيب", "الشغل جاهز"].includes(order.workflow_stage));
  return orders;
}

const useServerAuth = import.meta.env.VITE_USE_SERVER_AUTH === "true";
const isLocalHost = ["localhost", "127.0.0.1"].includes(window.location.hostname);

function Login({ onLogin }: { onLogin: (session: Session) => void }) {
  const [username, setUsername] = useState("mahmoud");
  const [password, setPassword] = useState("1234");
  const [stayLoggedIn, setStayLoggedIn] = useState(true);
  const [message, setMessage] = useState("");
  const [changeMode, setChangeMode] = useState(false);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [issuedPasswordCode, setIssuedPasswordCode] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const normalizedUsername = username.trim().toLowerCase();
    if (useServerAuth || !isLocalHost) {
      setMessage("جار تسجيل الدخول...");
      try {
        const response = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: normalizedUsername, password, stayLoggedIn }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "اسم المستخدم أو كلمة المرور غير صحيحة.");
        const session = payload.session as Session;
        localStorage.setItem(sessionKey, JSON.stringify(session));
        addAudit(session, "LOGIN", "auth", undefined, undefined, { username: normalizedUsername, role: session.role });
        onLogin(session);
        return;
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "تعذر تسجيل الدخول.");
        return;
      }
    }
    const user = getLocalUser(normalizedUsername);
    if (!user || user.password !== password) return setMessage("اسم المستخدم أو كلمة المرور غير صحيحة.");
    const expiresAt = new Date(Date.now() + (stayLoggedIn ? 14 * 24 : 8) * 60 * 60 * 1000).toISOString();
    const session = { email: user.email, username: normalizedUsername, fullName: user.fullName, role: user.role, loggedInAt: new Date().toISOString(), expiresAt };
    localStorage.setItem(sessionKey, JSON.stringify(session));
    addAudit(session, "LOGIN", "auth", undefined, undefined, { username: normalizedUsername, role: user.role });
    onLogin(session);
  }

  async function requestPasswordCode() {
    const normalizedUsername = username.trim().toLowerCase();
    if (!normalizedUsername) return setMessage("اكتب اسم المستخدم أولا.");
    if (newPassword.length < 4) return setMessage("كلمة المرور الجديدة يجب ألا تقل عن 4 أحرف.");
    if (newPassword !== confirmPassword) return setMessage("تأكيد كلمة المرور غير مطابق.");

    if (useServerAuth || !isLocalHost) {
      try {
        setMessage("جار إرسال كود التحقق...");
        const response = await fetch("/api/auth/request-password-code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: normalizedUsername }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "تعذر إرسال كود التحقق. تأكد من إعدادات Resend أو أضف دومين موثق.");
        setIssuedPasswordCode("");
        setMessage(payload.devCode ? `كود التحقق التجريبي: ${payload.devCode}` : "تم إرسال كود التحقق إلى البريد المسؤول.");
        return;
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "تعذر إرسال كود التحقق. تأكد من إعدادات Resend أو أضف دومين موثق.");
        return;
      }
    }

    const user = getLocalUser(normalizedUsername);
    if (!user || user.password !== oldPassword) return setMessage("كلمة المرور القديمة غير صحيحة.");
    const code = String(Math.floor(100000 + Math.random() * 900000));
    setIssuedPasswordCode(code);
    setMessage(`كود التحقق المحلي: ${code}`);
  }

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    const normalizedUsername = username.trim().toLowerCase();
    if (newPassword.length < 4) return setMessage("كلمة المرور الجديدة يجب ألا تقل عن 4 أحرف.");
    if (newPassword !== confirmPassword) return setMessage("تأكيد كلمة المرور غير مطابق.");

    if (useServerAuth) {
      try {
        setMessage("جار تغيير كلمة المرور...");
        const response = await fetch("/api/auth/change-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: normalizedUsername, oldPassword, newPassword, code: verificationCode }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "تعذر تغيير كلمة المرور.");
        setPassword(newPassword);
        setOldPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setVerificationCode("");
        setChangeMode(false);
        setMessage("تم تغيير كلمة المرور بنجاح. يمكنك تسجيل الدخول الآن.");
        return;
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "تعذر تغيير كلمة المرور.");
        return;
      }
    }

    const user = getLocalUser(normalizedUsername);
    if (!user || user.password !== oldPassword) return setMessage("كلمة المرور القديمة غير صحيحة.");
    if (!issuedPasswordCode || verificationCode !== issuedPasswordCode) return setMessage("كود التحقق غير صحيح.");
    saveLocalPassword(normalizedUsername, newPassword);
    addAudit(null, "PASSWORD_CHANGED", "auth", normalizedUsername, undefined, { username: normalizedUsername });
    setPassword(newPassword);
    setOldPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setVerificationCode("");
    setIssuedPasswordCode("");
    setChangeMode(false);
    setMessage("تم تغيير كلمة المرور بنجاح. يمكنك تسجيل الدخول الآن.");
  }

  if (changeMode) {
    return (
      <main className="login-page" dir="rtl">
        <form className="login-card" onSubmit={changePassword}>
          <BrandLogo className="login-logo" />
          <h1>تغيير كلمة المرور</h1>
          <p>سيتم إرسال كود التحقق إلى بريد المسؤول المحدد في إعدادات Resend.</p>
          <label>اسم المستخدم</label>
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
          <label>كلمة المرور القديمة</label>
          <input value={oldPassword} onChange={(event) => setOldPassword(event.target.value)} type="password" />
          <label>كلمة المرور الجديدة</label>
          <input value={newPassword} onChange={(event) => setNewPassword(event.target.value)} type="password" />
          <label>تأكيد كلمة المرور الجديدة</label>
          <input value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} type="password" />
          <button className="ghost-btn" type="button" onClick={requestPasswordCode}>إرسال كود التحقق</button>
          <label>كود التحقق</label>
          <input value={verificationCode} onChange={(event) => setVerificationCode(event.target.value)} inputMode="numeric" />
          {message && <div className="notice">{message}</div>}
          <button className="primary-btn">حفظ كلمة المرور الجديدة</button>
          <button className="ghost-btn" type="button" onClick={() => { setChangeMode(false); setMessage(""); }}>العودة لتسجيل الدخول</button>
        </form>
      </main>
    );
  }

  return (
    <main className="login-page" dir="rtl">
      <form className="login-card" onSubmit={submit}>
        <BrandLogo className="login-logo" />
        <h1>نظام Zunion لإدارة الأوردرات</h1>
        <p>واجهة داخلية عربية لإدارة التصنيع والتسليم والحسابات.</p>
        <label>اسم المستخدم</label>
        <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
        <label>كلمة المرور</label>
        <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" />
        <button className="ghost-btn" type="button" onClick={() => { setChangeMode(true); setMessage(""); }}>تغيير كلمة المرور</button>
        <label className="check stay-check"><input type="checkbox" checked={stayLoggedIn} onChange={(event) => setStayLoggedIn(event.target.checked)} /> البقاء مسجلا لمدة 14 يوم</label>
        {message && <div className="notice">{message}</div>}
        <button className="primary-btn">دخول لوحة التحكم</button>
      </form>
    </main>
  );
}

function cardIconFor(title: string): LucideIcon {
  if (title.includes("إيراد") || title.includes("الإيرادات")) return Banknote;
  if (title.includes("مصروف")) return Receipt;
  if (title.includes("الصافي")) return CircleDollarSign;
  if (title.includes("أوردر") || title.includes("اوردر")) return ClipboardList;
  if (title.includes("تشغيل")) return Cog;
  if (title.includes("تشطيب")) return Paintbrush;
  if (title.includes("جاهز") || title.includes("إرسال")) return Send;
  if (title.includes("تسليم")) return Truck;
  if (title.includes("مستخدم")) return Users;
  if (title.includes("مرور")) return KeyRound;
  if (title.includes("حساب")) return WalletCards;
  if (title.includes("شعار")) return Image;
  if (title.includes("عميل")) return UserPlus;
  if (title.includes("بحث")) return Search;
  if (title.includes("منتج")) return PackagePlus;
  return Wallet;
}

function StatCard({ title, value, tone = "", icon: Icon }: { title: string; value: ReactNode; tone?: string; icon?: LucideIcon }) {
  const CardIcon = Icon || cardIconFor(title);
  const valueText = typeof value === "string" || typeof value === "number" ? String(value) : "";
  const isLong = valueText.length > 14;
  return (
    <div className={`stat-card ${tone} ${isLong ? "long-value" : ""}`}>
      <div className="stat-text">
        <span>{title}</span>
        <strong>{value}</strong>
      </div>
      <div className="stat-icon" aria-hidden="true">
        <CardIcon size={24} strokeWidth={2.4} />
      </div>
    </div>
  );
}

function ActionCard({ title, onClick, icon: Icon }: { title: string; onClick: () => void; icon?: LucideIcon }) {
  const CardIcon = Icon || cardIconFor(title);
  return (
    <button className="action-card" onClick={onClick} type="button">
      <span className="action-copy">
        <strong>{title}</strong>
      </span>
      <span className="action-icon" aria-hidden="true">
        <CardIcon size={26} strokeWidth={2.5} />
      </span>
    </button>
  );
}

function LoadingPanel() {
  return <section className="panel"><p className="muted">جار تحميل البيانات...</p></section>;
}

function ErrorPanel({ message }: { message: string }) {
  return <section className="panel"><p className="notice">{message}</p></section>;
}

function EmptyRow({ colSpan }: { colSpan: number }) {
  return <tr><td colSpan={colSpan} className="empty-cell">لا توجد بيانات</td></tr>;
}

function orderClientName(order: DbOrder) {
  return order.customer_name || order.client_name || "-";
}

function orderParty(order: DbOrder) {
  return order.party || order.source_person || "-";
}

function orderPieces(order: DbOrder) {
  return order.pieces_count ?? order.quantity ?? 0;
}

function Dashboard({ setView, canSeeFinancials }: { setView: (view: View) => void; canSeeFinancials: boolean }) {
  const [data, setData] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    getDashboardStats()
      .then((stats) => { if (active) setData(stats); })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : "تعذر تحميل بيانات Supabase."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  if (loading) return <LoadingPanel />;
  if (error || !data) return <ErrorPanel message={error || "تعذر تحميل البيانات."} />;

  return (
    <div className="stack screenshot-dashboard">
      <section className="stats-grid screenshot-stats">
        {canSeeFinancials && <StatCard title="إجمالي الإيرادات" value={formatMoney(data.incomeTotal)} />}
        {canSeeFinancials && <StatCard title="الصافي" value={formatMoney(data.netTotal)} />}
        {canSeeFinancials && <StatCard title="إجمالي المصروفات" value={formatMoney(data.expenseTotal)} tone="danger" />}
        <StatCard title="أوردرات جديدة" value={formatNumber(data.newOrders)} />
        <StatCard title="في التشغيل" value={formatNumber(data.inOperation)} />
        <StatCard title="في التشطيب" value={formatNumber(data.inFinishing)} />
        <StatCard title="جاهز" value={formatNumber(data.ready)} />
      </section>
      <section className="quick-grid">
        <ActionCard title="أوردر جديد" icon={FilePlus} onClick={() => setView("new")} />
        <ActionCard title="بحث" icon={Search} onClick={() => setView("search")} />
        <ActionCard title="إضافة عميل" icon={UserPlus} onClick={() => setView("addCustomer")} />
        {canSeeFinancials && <ActionCard title="مصروفات وإيرادات" icon={ArrowUpDown} onClick={() => setView("finance")} />}
      </section>
      <section className="dashboard-grid">
        <div className="panel">
          <div className="panel-head"><h2>آخر الأوردرات</h2><button className="ghost-btn compact" onClick={() => setView("search")}>عرض الكل</button></div>
          <div className="table-wrap dashboard-table"><table><thead><tr>{["تاريخ التسليم", "أمر شغل رقم", "العميل", "الطرف", "إجمالي", "مدفوع", "متبقي", "الحالة"].map((head) => <th key={head}>{head}</th>)}</tr></thead><tbody>
            {data.latestOrders.length === 0 && <EmptyRow colSpan={8} />}
            {data.latestOrders.map((order) => <tr key={order.id}><td>{formatDateArabic(order.delivery_date)}</td><td>{order.order_number || "-"}</td><td>{orderClientName(order)}</td><td>{orderParty(order)}</td><td>{formatMoney(order.total)}</td><td>{formatMoney(order.paid)}</td><td>{formatMoney(order.remaining)}</td><td><span className="badge badge-blue">{order.delivery_status || order.operation_status || "-"}</span></td></tr>)}
          </tbody></table></div>
        </div>
        <div className="panel">
          <div className="panel-head"><h2>تنبيهات هامة</h2></div>
          <div className="alerts-list">
            {data.latestOrders.length === 0 && <p className="muted">لا توجد بيانات</p>}
            {data.latestOrders.slice(0, 5).map((order) => <div className="alert-item" key={order.id}><strong>{order.delivery_date ? "موعد تسليم" : "أوردر"}</strong><span>{orderClientName(order)}</span><small>{formatDateArabic(order.delivery_date)}</small></div>)}
          </div>
        </div>
      </section>
      {canSeeFinancials && <section className="dashboard-grid three">
        <FinanceMiniTable title="آخر المصروفات" rows={data.latestExpenses} />
        <FinanceMiniTable title="آخر الإيرادات" rows={data.latestRevenues} />
        <div className="panel"><div className="panel-head"><h2>ملخص الشهر</h2></div><div className="donut-card"><div className="donut-ring" /><strong>{formatMoney(data.netTotal)}</strong><span>الصافي</span></div></div>
      </section>}
    </div>
  );
}

function FinanceMiniTable({ title, rows }: { title: string; rows: DbTransaction[] }) {
  return (
    <div className="panel">
      <div className="panel-head"><h2>{title}</h2></div>
      <div className="table-wrap accounts-table"><table><thead><tr><th>التاريخ</th><th>البيان</th><th>القيمة</th></tr></thead><tbody>
        {rows.length === 0 && <EmptyRow colSpan={3} />}
        {rows.map((row) => <tr key={row.id}><td>{formatDateArabic(row.date || row.created_at)}</td><td>{row.description || row.expense_type || "-"}</td><td>{formatMoney(row.amount ?? row.value ?? row.total)}</td></tr>)}
      </tbody></table></div>
    </div>
  );
}

function LegacyDashboardAlerts({ orders, setView }: { orders: Order[]; setView: (view: View) => void }) {
  const alerts = buildAlerts(orders);
  return (
    <section className="panel">
        <div className="panel-head">
          <h2>تنبيهات التسليم</h2>
          <button className="ghost-btn compact" onClick={() => setView("alerts")}>عرض الكل</button>
        </div>
        <div className="alerts-list">
          {alerts.length === 0 && <p className="muted">لا توجد تنبيهات حالية.</p>}
          {alerts.slice(0, 8).map((alert, index) => <AlertItem key={`${alert.order.id}-${index}`} alert={alert} />)}
        </div>
      </section>
  );
}

function AlertItem({ alert }: { alert: Alert }) {
  const { order } = alert;
  return (
    <div className={`alert-item ${alert.tone === "late" ? "late" : ""}`}>
      <strong>{alert.label}</strong>
      <span>#{order.order_number} - {order.client_name}</span>
      <small>{order.delivery_date}</small>
    </div>
  );
}

function OrderForm({ initial, orderNumber, customers = [], onCancel, onSave }: { initial?: Order; orderNumber?: string; customers?: Customer[]; onCancel?: () => void; onSave: (order: Order) => void }) {
  const [form, setForm] = useState<Order>(() => initial ?? { ...emptyOrder, id: createId(), order_number: orderNumber || String(Date.now()).slice(-6) });
  const computed = calculate(form);

  function set<K extends keyof Order>(key: K, value: Order[K]) {
    setForm((current) => calculate({ ...current, [key]: value, updated_at: new Date().toISOString() }));
  }

  function setClientName(value: string) {
    setForm((current) => {
      const existing = customers.find((customer) => customer.client_name.trim().toLowerCase() === value.trim().toLowerCase() || customer.phone === current.phone);
      const source = current.source_person || partyOptions[0];
      const clientCode = existing?.client_code || current.client_code || nextCustomerCode(customers, source);
      return calculate({ ...current, client_name: value, client_code: clientCode, updated_at: new Date().toISOString() });
    });
  }

  function filePreview(file?: File) {
    if (!file) return;
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    if (!allowedTypes.includes(file.type)) {
      alert("نوع الملف غير مسموح. استخدم jpg أو jpeg أو png أو webp أو pdf.");
      return "";
    }
    if (file.size > 10 * 1024 * 1024) {
      alert("حجم الملف أكبر من 10MB.");
      return "";
    }
    return URL.createObjectURL(file);
  }

  function upload(key: "logo_image_url" | "work_order_image_url", file?: File) {
    const previewUrl = filePreview(file);
    if (!previewUrl) return;
    const previous = form[key];
    if (previous.startsWith("blob:")) URL.revokeObjectURL(previous);
    set(key, previewUrl as Order[typeof key]);
  }

  function addItem() {
    const item: OrderItem = { id: createId(), product_name: "", details: "", product_image_url: "", logo_url: "", logo_place: "", quantity: 1, price: 0, total: 0, quality: "", status: "جديد" };
    set("items", [...form.items, item]);
  }

  function updateItem(id: string, patch: Partial<OrderItem>) {
    set("items", form.items.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  function uploadItem(id: string, key: "product_image_url" | "logo_url", file?: File) {
    const previewUrl = filePreview(file);
    if (!previewUrl) return;
    updateItem(id, { [key]: previewUrl });
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const now = new Date().toISOString();
    onSave(calculate({ ...computed, client_code: computed.client_code || nextCustomerCode(customers, computed.source_person || partyOptions[0]), created_at: computed.created_at || now, updated_at: now }));
  }

  return (
    <form className="panel order-form" onSubmit={submit}>
      <div className="panel-head">
        <h2>{initial ? "تعديل أوردر" : "إضافة أوردر جديد"}</h2>
        {onCancel && <button type="button" className="ghost-btn compact" onClick={onCancel}>إلغاء</button>}
      </div>
      <div className="form-grid">
        <Field label="رقم الأوردر" value={form.order_number} onChange={(value) => set("order_number", value)} />
        <PartyField value={form.source_person} onChange={(value) => set("source_person", value)} />
        <Field label="اسم العميل" value={form.client_name} onChange={setClientName} />
        <ReadonlyText label="كود العميل" value={form.client_code || nextCustomerCode(customers, form.source_person || partyOptions[0])} />
        <Field label="رقم التليفون" value={form.phone} onChange={(value) => set("phone", value)} />
        <Field label="تاريخ التسليم" type="date" value={form.delivery_date} onChange={(value) => set("delivery_date", value)} />
        <Field label="السعر" type="number" value={form.price} onChange={(value) => set("price", Number(value))} />
        <Field label="العدد" type="number" value={form.quantity} onChange={(value) => set("quantity", Number(value))} />
        <Readonly label="الإجمالي" value={computed.total} />
        <Field label="المدفوع" type="number" value={form.paid} onChange={(value) => set("paid", Number(value))} />
        <Readonly label="باقي الحساب" value={computed.remaining} />
        <Field label="حساب قديم" type="number" value={form.old_balance} onChange={(value) => set("old_balance", Number(value))} />
        <Readonly label="صافي حساب العميل" value={computed.net_balance} />
        <Field label="النوع" value={form.order_type} onChange={(value) => set("order_type", value)} />
        <Select label="لوجو موجود/غير موجود" value={form.logo_status} options={["موجود", "غير موجود"]} onChange={(value) => set("logo_status", value)} />
        <Select label="مرحلة الشغل" value={form.workflow_stage} options={workflowStages} onChange={(value) => set("workflow_stage", value as WorkflowStage)} />
        <Select label="الحالة" value={form.order_status} options={statuses} onChange={(value) => set("order_status", value as OrderStatus)} />
        <Field label="التشغيل" value={form.operation_status} onChange={(value) => set("operation_status", value)} />
        <Field label="التشطيب" value={form.finishing_status} onChange={(value) => set("finishing_status", value)} />
        <Field label="قطعة مقطوعة" type="number" value={form.damaged_pieces} onChange={(value) => set("damaged_pieces", Number(value))} />
        <label>
          رفع صورة اللوجو
          <input type="file" accept="image/*" onChange={(event) => upload("logo_image_url", event.target.files?.[0])} />
          {form.logo_image_url && <a className="file-preview-link" href={form.logo_image_url} target="_blank">Preview logo</a>}
        </label>
        <label>
          رفع صورة أمر الشغل
          <input type="file" accept="image/*,.pdf" onChange={(event) => upload("work_order_image_url", event.target.files?.[0])} />
          {form.work_order_image_url && <a className="file-preview-link" href={form.work_order_image_url} target="_blank">Preview work order</a>}
        </label>
      </div>
      <section className="line-items">
        <div className="panel-head">
          <h3>المنتجات</h3>
          <button type="button" className="ghost-btn compact" onClick={addItem}>+ إضافة منتج</button>
        </div>
        {form.items.length === 0 && <p className="muted">اضغط إضافة منتج لإضافة أكثر من منتج داخل نفس الأوردر.</p>}
        {form.items.map((item, index) => (
          <div className="line-item" key={item.id}>
            <h4>منتج {index + 1}</h4>
            <Field label="المنتج" value={item.product_name} onChange={(value) => updateItem(item.id, { product_name: value })} />
            <Field label="التفاصيل" value={item.details} onChange={(value) => updateItem(item.id, { details: value })} />
            <Field label="مكان اللوجو" value={item.logo_place} onChange={(value) => updateItem(item.id, { logo_place: value })} />
            <Field label="العدد" type="number" value={item.quantity} onChange={(value) => updateItem(item.id, { quantity: Number(value) })} />
            <Field label="السعر" type="number" value={item.price} onChange={(value) => updateItem(item.id, { price: Number(value) })} />
            <Readonly label="الإجمالي" value={item.total} />
            <Field label="الجودة" value={item.quality} onChange={(value) => updateItem(item.id, { quality: value })} />
            <Field label="الحالة" value={item.status} onChange={(value) => updateItem(item.id, { status: value })} />
            <label>صورة المنتج<input type="file" accept="image/*" onChange={(event) => uploadItem(item.id, "product_image_url", event.target.files?.[0])} />{item.product_image_url && <a className="file-preview-link" href={item.product_image_url} target="_blank">Preview product</a>}</label>
            <label>اللوجو<input type="file" accept="image/*" onChange={(event) => uploadItem(item.id, "logo_url", event.target.files?.[0])} />{item.logo_url && <a className="file-preview-link" href={item.logo_url} target="_blank">Preview logo</a>}</label>
            <button type="button" className="danger-text line-remove" onClick={() => set("items", form.items.filter((current) => current.id !== item.id))}>حذف المنتج</button>
          </div>
        ))}
      </section>
      <div className="form-grid two">
        <Textarea label="الجودة" value={form.quality_notes} onChange={(value) => set("quality_notes", value)} />
        <Textarea label="ملاحظات التشغيل" value={form.production_notes} onChange={(value) => set("production_notes", value)} />
        <Textarea label="ملاحظات التشطيب" value={form.finishing_notes} onChange={(value) => set("finishing_notes", value)} />
        <Textarea label="رسالة العميل" value={form.client_message} onChange={(value) => set("client_message", value)} />
        <Textarea label="ملاحظات" value={form.notes} onChange={(value) => set("notes", value)} />
        <Textarea label="ملاحظات داخلية" value={form.internal_notes} onChange={(value) => set("internal_notes", value)} />
      </div>
      <button className="primary-btn">حفظ الأوردر</button>
    </form>
  );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string | number; onChange: (value: string) => void; type?: string }) {
  return <label>{label}<input type={type} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function PartyField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const selected = partyOptions.includes(value) ? value : "أخرى";
  return (
    <label>
      طرف
      <select value={selected} onChange={(event) => onChange(event.target.value === "أخرى" ? "" : event.target.value)}>
        {partyOptions.map((option) => <option key={option}>{option}</option>)}
      </select>
      {selected === "أخرى" && <input placeholder="اكتب الطرف" value={value === "أخرى" ? "" : value} onChange={(event) => onChange(event.target.value)} />}
    </label>
  );
}

function Readonly({ label, value }: { label: string; value: number }) {
  return <label>{label}<input value={value.toLocaleString("ar-EG")} readOnly /></label>;
}

function ReadonlyText({ label, value }: { label: string; value: string }) {
  return <label>{label}<input value={value} readOnly /></label>;
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <label>{label}<select value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option}>{option}</option>)}</select></label>;
}

function Textarea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label>{label}<textarea rows={3} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function OrdersPage({ orders, setOrders, session, queue }: { orders: Order[]; setOrders: React.Dispatch<React.SetStateAction<Order[]>>; session: Session; queue?: "worker" | "finish" }) {
  const [remoteOps, setRemoteOps] = useState<OperationStats | null>(null);
  const [remoteLoading, setRemoteLoading] = useState(Boolean(queue));
  const [remoteError, setRemoteError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [date, setDate] = useState("");
  const [source, setSource] = useState("");
  const [qualityOnly, setQualityOnly] = useState(false);
  const [editing, setEditing] = useState<Order | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!queue) return;
    let active = true;
    setRemoteLoading(true);
    getOperationStats()
      .then((stats) => { if (active) setRemoteOps(stats); })
      .catch((err) => { if (active) setRemoteError(err instanceof Error ? err.message : "تعذر تحميل بيانات التشغيل."); })
      .finally(() => { if (active) setRemoteLoading(false); });
    return () => { active = false; };
  }, [queue]);

  if (queue) {
    if (remoteLoading) return <LoadingPanel />;
    if (remoteError || !remoteOps) return <ErrorPanel message={remoteError || "تعذر تحميل البيانات."} />;
    const filteredRemote = remoteOps.orders.filter((order) => {
      const text = `${order.order_number || ""} ${orderClientName(order)} ${order.phone || ""} ${order.service_type || order.order_type || ""}`.toLowerCase();
      return (!query || text.includes(query.toLowerCase()))
        && (!status || [order.operation_status, order.finishing_status, order.delivery_status].includes(status))
        && (!date || order.delivery_date === date);
    });
    const pagesRemote = Math.max(1, Math.ceil(filteredRemote.length / 8));
    const visibleRemote = filteredRemote.slice((page - 1) * 8, page * 8);
    return (
      <div className="stack operation-screen">
        <section className="stats-grid">
          <StatCard title="قيد التشغيل" value={formatNumber(remoteOps.inOperation)} tone="danger" />
          <StatCard title="قيد التشطيب" value={formatNumber(remoteOps.inFinishing)} />
          <StatCard title="جاهز للإرسال" value={formatNumber(remoteOps.readyToSend)} />
          <StatCard title="تسليم اليوم" value={formatNumber(remoteOps.deliveryToday)} />
        </section>
        <section className="panel filters">
          <Field label="تاريخ التسليم" type="date" value={date} onChange={setDate} />
          <Field label="رقم الأوردر" value={query} onChange={setQuery} />
          <Select label="الحالة" value={status} options={["", "قيد التشغيل", "قيد التشطيب", "جاهز للإرسال", "مكتمل", "جديدة"]} onChange={setStatus} />
          <button className="primary-btn" onClick={() => setPage(1)}>بحث</button>
          <button className="ghost-btn" onClick={() => { setQuery(""); setStatus(""); setDate(""); }}>مسح الفلاتر</button>
        </section>
        <section className="table-wrap accounts-table"><table><thead><tr>{["رقم الأوردر", "اسم العميل", "تاريخ التسليم", "عدد القطع", "حالة التشغيل", "حالة التشطيب", "حالة تسليم"].map((head) => <th key={head}>{head}</th>)}</tr></thead><tbody>
          {visibleRemote.length === 0 && <EmptyRow colSpan={7} />}
          {visibleRemote.map((order) => <tr key={order.id}><td>{order.order_number || "-"}</td><td>{orderClientName(order)}</td><td>{formatDateArabic(order.delivery_date)}</td><td>{formatNumber(orderPieces(order))}</td><td><span className="badge badge-blue">{order.operation_status || "-"}</span></td><td><span className="badge badge-green">{order.finishing_status || "-"}</span></td><td><span className="badge badge-amber">{order.delivery_status || "-"}</span></td></tr>)}
        </tbody></table></section>
        <div className="pagination"><button disabled={page === 1} onClick={() => setPage((value) => value - 1)}>السابق</button><span>{page} / {pagesRemote}</span><button disabled={page === pagesRemote} onClick={() => setPage((value) => value + 1)}>التالي</button></div>
      </div>
    );
  }

  const baseOrders = useMemo(() => {
    if (queue === "worker") return orders.filter((order) => ["يروح للتشغيل", "التشغيل"].includes(order.workflow_stage));
    if (queue === "finish") return orders.filter((order) => ["يروح للتشطيب", "التشطيب", "الشغل جاهز"].includes(order.workflow_stage));
    return roleOrders(session.role, orders);
  }, [orders, queue, session.role]);

  const filtered = useMemo(() => baseOrders.filter((order) => {
    const products = [order.order_type, ...(order.items || []).map((item) => `${item.product_name} ${item.details}`)].join(" ");
    const text = `${order.order_number} ${order.client_name} ${order.client_code} ${order.phone} ${order.source_person} ${products}`.toLowerCase();
    return (!query || text.includes(query.toLowerCase()))
      && (!status || order.order_status === status)
      && (!date || order.delivery_date === date)
      && (!source || order.source_person === source)
      && (!qualityOnly || Boolean(order.quality_notes.trim()) || order.order_status === "مشكلة جودة");
  }), [baseOrders, query, status, date, source, qualityOnly]);

  const pages = Math.max(1, Math.ceil(filtered.length / 8));
  const visible = filtered.slice((page - 1) * 8, page * 8);
  const sources = Array.from(new Set(baseOrders.map((order) => order.source_person).filter(Boolean)));

  function save(order: Order) {
    const previous = orders.find((item) => item.id === order.id);
    setOrders((current) => current.map((item) => item.id === order.id ? order : item));
    addAudit(session, previous?.paid !== order.paid ? "PAYMENT_UPDATED" : "ORDER_EDITED", "orders", order.id, previous, order);
    setEditing(null);
  }

  function changeStatus(order: Order, orderStatus: OrderStatus) {
    const next = { ...order, order_status: orderStatus, updated_at: new Date().toISOString() };
    setOrders((current) => current.map((item) => item.id === order.id ? next : item));
    addAudit(session, "STATUS_CHANGED", "orders", order.id, { order_status: order.order_status }, { order_status: orderStatus });
  }

  function transition(order: Order, label: string, patch: Partial<Order>) {
    const next = calculate({ ...order, ...patch, updated_at: new Date().toISOString() });
    setOrders((current) => current.map((item) => item.id === order.id ? next : item));
    addAudit(session, label, "orders", order.id, order, next);
  }

  function remove(id: string) {
    if (!confirm("هل تريد حذف الأوردر؟")) return;
    setOrders((current) => current.filter((order) => order.id !== id));
    addAudit(session, "ORDER_DELETED", "orders", id);
  }

  function printOrder(order: Order) {
    const money = (value: number) => value.toLocaleString("ar-EG");
    const rows = [
      ["رقم الأوردر", order.order_number],
      ["الطرف", order.source_person],
      ["اسم العميل", order.client_name],
      ["كود العميل", order.client_code],
      ["رقم التليفون", order.phone],
      ["تاريخ التسليم", order.delivery_date],
      ["النوع", order.order_type],
      ["العدد", order.quantity],
      ["السعر", money(order.price)],
      ["الإجمالي", money(order.total)],
      ["المدفوع", money(order.paid)],
      ["باقي الحساب", money(order.remaining)],
      ["حساب قديم", money(order.old_balance)],
      ["صافي حساب العميل", money(order.net_balance)],
      ["اللوجو", order.logo_status],
      ["مرحلة الشغل", order.workflow_stage],
      ["الحالة", order.order_status],
      ["التشغيل", order.operation_status],
      ["التشطيب", order.finishing_status],
      ["الجودة", order.quality_notes],
      ["رسالة العميل", order.client_message],
      ["ملاحظات", order.notes],
    ];
    const popup = window.open("", "_blank", "width=980,height=720");
    if (!popup) {
      window.print();
      return;
    }
    addAudit(session, "ORDER_PRINTED", "orders", order.id);
    popup.document.write(`<!doctype html>
      <html lang="ar" dir="rtl">
        <head>
          <meta charset="utf-8" />
          <title>أمر شغل ${order.order_number}</title>
          <style>
            body{font-family:Tahoma,Arial,sans-serif;margin:28px;color:#27272a}
            .head{display:flex;align-items:center;justify-content:space-between;border-bottom:4px solid #ed1c24;padding-bottom:14px;margin-bottom:18px}
            img{width:220px;height:auto;object-fit:contain}
            h1{margin:0;font-size:26px}.muted{color:#71717a;margin-top:6px}
            .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
            .box{border:1px solid #ddd;border-radius:6px;padding:10px;min-height:52px}
            .box strong{display:block;color:#555;font-size:12px;margin-bottom:5px}
            .signatures{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:28px}
            .sign{height:90px;border:1px dashed #999;border-radius:6px;padding:10px}
            .toolbar{margin-bottom:14px}.toolbar button{background:#ed1c24;color:white;border:0;border-radius:6px;padding:10px 18px;font-weight:700}
            @media print{.toolbar{display:none}body{margin:12mm}.box,.sign{break-inside:avoid}}
          </style>
        </head>
        <body>
          <div class="toolbar"><button onclick="window.print()">طباعة</button></div>
          <div class="head">
            <div><h1>أمر شغل</h1><div class="muted">Zunion Quality First</div></div>
            <img src="/zunion-logo.png" />
          </div>
          <div class="grid">
            ${rows.map(([label, value]) => `<div class="box"><strong>${label}</strong>${String(value ?? "").replace(/</g, "&lt;")}</div>`).join("")}
          </div>
          ${(order.logo_image_url || order.work_order_image_url) ? `<h2>الملفات</h2><div class="grid">
            ${order.logo_image_url ? `<div class="box"><strong>اللوجو</strong><img style="width:100%;max-height:260px;object-fit:contain" src="${order.logo_image_url}" /></div>` : ""}
            ${order.work_order_image_url ? `<div class="box"><strong>أمر الشغل</strong><img style="width:100%;max-height:260px;object-fit:contain" src="${order.work_order_image_url}" /></div>` : ""}
          </div>` : ""}
          ${order.items?.length ? `<h2>المنتجات</h2><div class="grid">${order.items.map((item) => `<div class="box"><strong>${item.product_name || "منتج"}</strong>
            <div>التفاصيل: ${item.details || ""}</div>
            <div>مكان اللوجو: ${item.logo_place || ""}</div>
            <div>العدد: ${item.quantity} | السعر: ${item.price} | الإجمالي: ${item.total}</div>
            <div>الجودة: ${item.quality || ""} | الحالة: ${item.status || ""}</div>
            ${item.product_image_url ? `<img style="width:100%;max-height:220px;object-fit:contain;margin-top:8px" src="${item.product_image_url}" />` : ""}
          </div>`).join("")}</div>` : ""}
          <div class="signatures">
            <div class="sign">توقيع التشغيل</div>
            <div class="sign">توقيع التشطيب</div>
            <div class="sign">توقيع التسليم</div>
          </div>
        </body>
      </html>`);
    popup.document.close();
    popup.focus();
    setTimeout(() => popup.print(), 300);
  }

  return (
    <div className="stack">
      {editing && <OrderForm initial={editing} onSave={save} onCancel={() => setEditing(null)} />}
      <section className="panel">
        <div className="filters">
          <input placeholder="بحث بالهاتف / رقم الأوردر / اسم العميل" value={query} onChange={(event) => setQuery(event.target.value)} />
          <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">كل الحالات</option>{statuses.map((item) => <option key={item}>{item}</option>)}</select>
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          <select value={source} onChange={(event) => setSource(event.target.value)}><option value="">كل الأطراف</option>{sources.map((item) => <option key={item}>{item}</option>)}</select>
          <label className="check"><input type="checkbox" checked={qualityOnly} onChange={(event) => setQualityOnly(event.target.checked)} /> مشاكل جودة</label>
        </div>
      </section>
      <section className="table-wrap">
        <table>
          <thead>
            <tr>
              {["رقم الأوردر", "الطرف", "اسم العميل", "كود العميل", "رقم التليفون", "تاريخ التسليم", ...(canManageFinancials(session.role) ? ["السعر", "الإجمالي", "المدفوع", "باقي الحساب", "حساب قديم", "صافي حساب العميل"] : []), "النوع", "العدد", "اللوجو", "أمر الشغل", "الجودة", "تشغيل", "تشطيب", "قطع تالفة", "مرحلة", "الحالة", "الرسالة", "ملاحظات", "إجراءات"].map((head) => <th key={head}>{head}</th>)}
            </tr>
          </thead>
          <tbody>
            {visible.map((order) => (
              <tr key={order.id} className={daysUntil(order.delivery_date) < 0 && order.order_status !== "تم التسليم" ? "overdue" : ""}>
                <td>{order.order_number}</td>
                <td>{order.source_person}</td>
                <td>{order.client_name}</td>
                <td>{order.client_code}</td>
                <td>{order.phone}</td>
                <td>{order.delivery_date}</td>
                {canManageFinancials(session.role) && <td>{order.price}</td>}
                {canManageFinancials(session.role) && <td>{order.total}</td>}
                {canManageFinancials(session.role) && <td>{order.paid}</td>}
                {canManageFinancials(session.role) && <td>{order.remaining}</td>}
                {canManageFinancials(session.role) && <td>{order.old_balance}</td>}
                {canManageFinancials(session.role) && <td>{order.net_balance}</td>}
                <td>{order.order_type}</td>
                <td>{order.quantity}</td>
                <td>{order.logo_image_url ? <a href={order.logo_image_url} target="_blank">فتح اللوجو</a> : order.logo_status}</td>
                <td>{order.work_order_image_url ? <a href={order.work_order_image_url} target="_blank">فتح أمر الشغل</a> : "-"}</td>
                <td>{order.quality_notes}</td>
                <td>{order.operation_status}</td>
                <td>{order.finishing_status}</td>
                <td>{order.damaged_pieces}</td>
                <td>{order.workflow_stage}</td>
                <td><span className={statusClass(order.order_status)}>{order.order_status}</span></td>
                <td>{order.client_message}</td>
                <td>{order.notes}</td>
                <td className="actions">
                  <button onClick={() => printOrder(order)}>طباعة</button>
                  {(session.role === "Master" || session.role === "Helper") && order.workflow_stage === "أوردر جديد" && <button onClick={() => transition(order, "SENT_TO_WORKER", { workflow_stage: "يروح للتشغيل", order_status: "في التشغيل" })}>يروح التشغيل</button>}
                  {(session.role === "Master" || session.role === "Worker") && order.workflow_stage === "يروح للتشغيل" && <button onClick={() => transition(order, "WORKER_STARTED", { workflow_stage: "التشغيل", operation_status: "بدأ التشغيل", order_status: "في التشغيل" })}>بدء التشغيل</button>}
                  {(session.role === "Master" || session.role === "Worker") && order.workflow_stage === "التشغيل" && <button onClick={() => transition(order, "WORKER_DONE", { operation_status: "تم التشغيل" })}>تم التشغيل</button>}
                  {(session.role === "Master" || session.role === "Worker") && ["التشغيل", "يروح للتشغيل"].includes(order.workflow_stage) && <button onClick={() => transition(order, "SENT_TO_FINISH", { workflow_stage: "يروح للتشطيب", order_status: "في التشطيب" })}>يروح التشطيب</button>}
                  {(session.role === "Master" || session.role === "Finish") && order.workflow_stage === "يروح للتشطيب" && <button onClick={() => transition(order, "FINISH_STARTED", { workflow_stage: "التشطيب", finishing_status: "بدأ التشطيب", order_status: "في التشطيب" })}>بدء التشطيب</button>}
                  {(session.role === "Master" || session.role === "Finish") && order.workflow_stage === "التشطيب" && <button onClick={() => transition(order, "FINISH_DONE", { finishing_status: "تم التشطيب" })}>تم التشطيب</button>}
                  {(session.role === "Master" || session.role === "Finish") && ["التشطيب", "يروح للتشطيب"].includes(order.workflow_stage) && <button onClick={() => transition(order, "READY", { workflow_stage: "الشغل جاهز", order_status: "جاهز" })}>جاهز</button>}
                  {(session.role === "Master" || session.role === "Helper") && order.order_status === "جاهز" && <button onClick={() => {
                    const message = order.client_message || `أوردر ${order.order_number} جاهز للاستلام`;
                    navigator.clipboard?.writeText(message).catch(() => undefined);
                    transition(order, "CUSTOMER_MESSAGED", { order_status: "جاهز", client_message: message });
                    alert(message);
                  }}>رسالة للعميل</button>}
                  {(session.role === "Master" || session.role === "Helper") && order.order_status !== "تم التسليم" && <button onClick={() => transition(order, "DELIVERED", { workflow_stage: "تم التسليم", order_status: "تم التسليم" })}>تم التسليم</button>}
                  {canEditOrder(session.role, order) && <button onClick={() => setEditing(order)}>تعديل</button>}
                  <select value={order.order_status} onChange={(event) => changeStatus(order, event.target.value as OrderStatus)}>
                    {statuses.map((item) => <option key={item}>{item}</option>)}
                  </select>
                  {canDeleteOrder(session.role) && <button className="danger-text" onClick={() => remove(order.id)}>حذف</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <div className="pagination">
        <button disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>السابق</button>
        <span>{page} / {pages}</span>
        <button disabled={page >= pages} onClick={() => setPage((current) => current + 1)}>التالي</button>
      </div>
    </div>
  );
}

function ImportExport({ orders, setOrders, session }: { orders: Order[]; setOrders: React.Dispatch<React.SetStateAction<Order[]>>; session: Session }) {
  const [summary, setSummary] = useState("");

  function exportRows(rows: Order[], filename: string) {
    const data = rows.map((order) => Object.fromEntries((Object.keys(arabicColumns) as Array<keyof Order>).map((key) => [arabicColumns[key], order[key]])));
    const sheet = XLSX.utils.json_to_sheet(data);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Zunion Orders");
    XLSX.writeFile(book, filename);
    addAudit(session, "ORDERS_EXPORTED", "orders", undefined, undefined, { filename, rows: rows.length });
  }

  async function importFile(file?: File) {
    if (!file) return;
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, string | number>>(sheet, { defval: "" });
    const errors: string[] = [];
    const imported = rows.flatMap((row, index) => {
      const order = rowToOrder(row);
      if (!order.order_number || !order.client_name || !order.phone) {
        errors.push(`صف ${index + 2}: رقم الأوردر واسم العميل ورقم التليفون مطلوبة.`);
        return [];
      }
      return [order];
    });
    setOrders((current) => [...imported, ...current]);
    addAudit(session, "ORDERS_IMPORTED", "orders", undefined, undefined, { imported: imported.length, skipped: errors.length });
    setSummary(`تم استيراد ${imported.length} صف. تم تخطي ${errors.length} صف. ${errors.slice(0, 3).join(" ")}`);
  }

  return (
    <section className="panel">
      <h2>الاستيراد والتصدير</h2>
      <div className="import-actions">
        <label className="primary-btn file-btn">Import Excel<input type="file" accept=".xlsx,.xls" onChange={(event) => importFile(event.target.files?.[0])} /></label>
        <button className="ghost-btn" onClick={() => exportRows(orders, "zunion-orders-all.xlsx")}>Export Excel</button>
        <button className="ghost-btn" onClick={() => exportRows(orders.filter((order) => order.order_status !== "تم التسليم"), "zunion-orders-active.xlsx")}>Export Filtered Active</button>
      </div>
      {summary && <div className="notice">{summary}</div>}
      <p className="muted">يحافظ التصدير على أسماء الأعمدة العربية ويضيف كل الحسابات المالية المحسوبة.</p>
    </section>
  );
}

function CustomerAccounts({ orders, customers: savedCustomers, session, setOrders }: { orders: Order[]; customers: Customer[]; session: Session; setOrders: React.Dispatch<React.SetStateAction<Order[]>> }) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState("");
  const customers = useMemo(() => {
    const grouped = new Map<string, { name: string; code: string; phone: string; source: string; old: number; totalOrders: number; paid: number; remaining: number; net: number; orders: Order[] }>();
    for (const customer of savedCustomers) {
      grouped.set(customer.client_code || customer.phone || customer.client_name, { name: customer.client_name, code: customer.client_code, phone: customer.phone, source: customer.source_person, old: customer.old_balance, totalOrders: 0, paid: 0, remaining: 0, net: customer.old_balance, orders: [] });
    }
    for (const order of orders) {
      const key = order.client_code || order.phone || order.client_name;
      const current = grouped.get(key) ?? { name: order.client_name, code: order.client_code, phone: order.phone, source: order.source_person, old: order.old_balance, totalOrders: 0, paid: 0, remaining: 0, net: 0, orders: [] };
      current.totalOrders += 1;
      current.paid += order.paid;
      current.remaining += order.remaining;
      current.net = current.old + current.remaining;
      current.orders.push(order);
      grouped.set(key, current);
    }
    return Array.from(grouped.values()).filter((customer) => `${customer.name} ${customer.code} ${customer.phone}`.toLowerCase().includes(search.toLowerCase()));
  }, [orders, savedCustomers, search]);

  function updateOldBalance(code: string, value: number) {
    const before = orders.filter((order) => order.client_code === code);
    setOrders((current) => current.map((order) => order.client_code === code ? calculate({ ...order, old_balance: value, updated_at: new Date().toISOString() }) : order));
    addAudit(session, "CUSTOMER_BALANCE_UPDATED", "customers", code, before, { old_balance: value });
  }

  if (session.role !== "Master" && session.role !== "Helper") {
    return <section className="panel"><h2>حسابات العملاء</h2><p className="muted">لا توجد صلاحية لعرض الحسابات المالية.</p></section>;
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>حسابات العملاء</h2>
        <input placeholder="بحث باسم العميل / الكود / الهاتف" value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>
      <div className="table-wrap accounts-table">
        <table>
          <thead><tr>{["اسم العميل", "الكود", "الهاتف", "الطرف", "حساب قديم", "إجمالي الأوردرات", "إجمالي المدفوع", "المتبقي", "صافي الحساب", "تاريخ الأوردرات"].map((head) => <th key={head}>{head}</th>)}</tr></thead>
          <tbody>
            {customers.map((customer) => (
              <Fragment key={customer.code || customer.phone || customer.name}>
                <tr key={customer.code || customer.phone}>
                  <td>{customer.name}</td>
                  <td>{customer.code}</td>
                  <td>{customer.phone}</td>
                  <td>{customer.source}</td>
                  <td>{session.role === "Master" ? <input type="number" value={customer.old} onChange={(event) => updateOldBalance(customer.code, Number(event.target.value))} /> : customer.old}</td>
                  <td>{customer.totalOrders}</td>
                  <td>{customer.paid}</td>
                  <td>{customer.remaining}</td>
                  <td>{customer.net}</td>
                  <td><button className="ghost-btn compact" onClick={() => setExpanded(expanded === customer.code ? "" : customer.code)}>عرض</button></td>
                </tr>
                {expanded === customer.code && <tr><td colSpan={10}><div className="history-list">{customer.orders.map((order) => <span key={order.id}>#{order.order_number} - {order.order_type} - {order.order_status}</span>)}</div></td></tr>}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AddCustomerPage({ customers, setCustomers, session }: { customers: Customer[]; setCustomers: React.Dispatch<React.SetStateAction<Customer[]>>; session: Session }) {
  const [party, setParty] = useState("أحمد");
  const [customParty, setCustomParty] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const selectedParty = party === "أخرى" ? customParty : party;
  const code = nextCustomerCode(customers, selectedParty || party);
  function submit(event: React.FormEvent) {
    event.preventDefault();
    const customer: Customer = { id: createId(), source_person: selectedParty, client_name: name, client_code: code, phone, old_balance: 0, notes: "", created_at: new Date().toISOString() };
    setCustomers((current) => [customer, ...current]);
    addAudit(session, "CUSTOMER_CREATED", "customers", customer.id, undefined, customer);
    setName("");
    setPhone("");
  }
  return (
    <form className="panel order-form" onSubmit={submit}>
      <h2>إضافة عميل</h2>
      <div className="form-grid">
        <Select label="طرف" value={party} options={partyOptions} onChange={setParty} />
        {party === "أخرى" && <Field label="طرف آخر" value={customParty} onChange={setCustomParty} />}
        <Field label="اسم العميل" value={name} onChange={setName} />
        <ReadonlyText label="كود العميل" value={code} />
        <Field label="تليفون" value={phone} onChange={setPhone} />
      </div>
      <button className="primary-btn">حفظ العميل</button>
    </form>
  );
}

function SearchPage({ orders, setOrders, session }: { orders: Order[]; setOrders: React.Dispatch<React.SetStateAction<Order[]>>; session: Session }) {
  return <OrdersPage orders={orders} setOrders={setOrders} session={session} />;
}

function FinancePage({ session }: { session: Session }) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [account, setAccount] = useState("");
  const [data, setData] = useState<{ incomeTotal: number; expenseTotal: number; netTotal: number; transactions: DbTransaction[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [year, selectedMonth] = month.split("-").map(Number);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getMonthlyFinancialStats(selectedMonth, year, account)
      .then((stats) => { if (active) setData(stats); })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : "تعذر تحميل البيانات."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [account, selectedMonth, year]);

  if (loading) return <LoadingPanel />;
  if (error || !data) return <ErrorPanel message={error || "تعذر تحميل البيانات."} />;

  return (
    <div className="stack finance-screen">
      <section className="panel">
        <div className="panel-head"><h2>مصروفات وإيرادات</h2><input type="month" value={month} onChange={(event) => { setMonth(event.target.value); addAudit(session, "MONTH_OPENED", "monthly_periods", event.target.value); }} /></div>
        <div className="stats-grid"><StatCard title="الإيرادات" value={formatMoney(data.incomeTotal)} /><StatCard title="الصافي" value={formatMoney(data.netTotal)} /><StatCard title="المصروفات" value={formatMoney(data.expenseTotal)} tone="danger" /></div>
      </section>
      <section className="panel account-buttons">
        {["سامح", "احمد", "شيكات", "بنك"].map((name) => <button key={name} className={account === name ? "primary-btn" : "ghost-btn"} onClick={() => setAccount(account === name ? "" : name)}>{name}</button>)}
      </section>
      <section className="table-wrap accounts-table"><table><thead><tr>{["التاريخ", "نوع المصروف", "البيان", "المبلغ", "الحساب / الوجهة", "التاريخ"].map((head) => <th key={head}>{head}</th>)}</tr></thead><tbody>
        {data.transactions.length === 0 && <EmptyRow colSpan={6} />}
        {data.transactions.map((record) => <tr key={record.id}><td>{formatDateArabic(record.date)}</td><td>{record.transaction_type || record.kind || "-"}</td><td>{record.description || "-"}</td><td>{formatMoney(record.amount ?? record.value ?? record.total)}</td><td>{record.account_destination || "-"}</td><td>{formatDateArabic(record.created_at)}</td></tr>)}
      </tbody></table></section>
    </div>
  );
}

function FinancePageModern({ session }: { session: Session }) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [account, setAccount] = useState("");
  const [transactionType, setTransactionType] = useState<"مصروف" | "إيراد">("مصروف");
  const [formDate, setFormDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState(0);
  const [expenseType, setExpenseType] = useState("");
  const [selectedAccount, setSelectedAccount] = useState("سامح");
  const [data, setData] = useState<{ incomeTotal: number; expenseTotal: number; netTotal: number; transactions: DbTransaction[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [year, selectedMonth] = month.split("-").map(Number);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    getMonthlyFinancialStats(selectedMonth, year, account)
      .then((stats) => { if (active) setData(stats); })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : "تعذر تحميل البيانات."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [account, selectedMonth, year, reloadKey]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setNotice("");
    setError("");
    try {
      await createTransaction({
        transaction_type: transactionType,
        date: formDate,
        description,
        amount: Number(amount || 0),
        expense_type: expenseType || transactionType,
        account_destination: selectedAccount,
        added_by: session.username || session.fullName || session.email,
      });
      addAudit(session, transactionType === "مصروف" ? "EXPENSE_ADDED" : "INCOME_ADDED", "transactions", undefined, undefined, { transactionType, amount, selectedAccount });
      setDescription("");
      setAmount(0);
      setExpenseType("");
      setNotice("تم حفظ المعاملة بنجاح");
      setReloadKey((key) => key + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر حفظ المعاملة.");
    }
  }

  if (loading) return <LoadingPanel />;
  if (!data) return <ErrorPanel message={error || "تعذر تحميل البيانات."} />;

  return (
    <div className="stack finance-screen finance-modern">
      <section className="finance-hero">
        <div className="finance-title">
          <h2>مصروفات وإيرادات</h2>
          <span>فتح شهر</span>
        </div>
        <div className="finance-month">
          <select value={String(selectedMonth)} onChange={(event) => {
            const nextMonth = String(event.target.value).padStart(2, "0");
            setMonth(`${year}-${nextMonth}`);
            addAudit(session, "MONTH_OPENED", "monthly_periods", `${year}-${nextMonth}`);
          }}>
            {Array.from({ length: 12 }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{new Date(2026, value - 1, 1).toLocaleDateString("ar-EG", { month: "long" })}</option>)}
          </select>
          <select value={String(year)} onChange={(event) => {
            const nextYear = event.target.value;
            setMonth(`${nextYear}-${String(selectedMonth).padStart(2, "0")}`);
            addAudit(session, "MONTH_OPENED", "monthly_periods", `${nextYear}-${selectedMonth}`);
          }}>
            {[2025, 2026, 2027].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>
        <div className="finance-stat-row">
          <StatCard title="الإيرادات" value={formatMoney(data.incomeTotal)} />
          <StatCard title="الصافي" value={formatMoney(data.netTotal)} />
          <StatCard title="المصروفات" value={formatMoney(data.expenseTotal)} tone="danger" />
        </div>
      </section>

      <section className="panel finance-form-card">
        <div className="panel-head">
          <h2>إضافة معاملة جديدة</h2>
          <div className="finance-type-actions">
            <button type="button" className={transactionType === "مصروف" ? "primary-btn compact" : "ghost-btn compact"} onClick={() => setTransactionType("مصروف")}>إضافة مصروف</button>
            <button type="button" className={transactionType === "إيراد" ? "success-btn compact" : "ghost-btn compact"} onClick={() => setTransactionType("إيراد")}>إضافة إيراد</button>
          </div>
        </div>
        <form onSubmit={submit} className="finance-form">
          <label>نوع المصروف
            <select value={expenseType} onChange={(event) => setExpenseType(event.target.value)}>
              <option value="">اختر نوع المصروف</option>
              <option value="سامح">سامح</option>
              <option value="كاش">كاش</option>
              <option value="احمد">احمد</option>
              <option value="رضا">رضا</option>
              <option value="كريم">كريم</option>
              <option value="إيراد">إيراد</option>
            </select>
          </label>
          <label>المبلغ *
            <input type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(Number(event.target.value))} placeholder="0.00" required />
          </label>
          <label>البيان / الوصف
            <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="اكتب البيان أو الوصف" />
          </label>
          <label>التاريخ *
            <input type="date" value={formDate} onChange={(event) => setFormDate(event.target.value)} required />
          </label>
          <div className="finance-account-select">
            <span>الحساب / الوجهة *</span>
            <div className="account-buttons">
              {["سامح", "احمد", "شيكات", "بنك"].map((name) => (
                <button key={name} type="button" className={selectedAccount === name ? "account-active" : ""} onClick={() => setSelectedAccount(name)}>{name}</button>
              ))}
            </div>
          </div>
          <div className="finance-save-row">
            <button className="primary-btn" type="submit">حفظ المعاملة</button>
            <button className="ghost-btn" type="button" onClick={() => { setDescription(""); setAmount(0); setExpenseType(""); }}>إلغاء</button>
          </div>
        </form>
        {notice && <p className="success-note">{notice}</p>}
        {error && <p className="notice">{error}</p>}
      </section>

      <section className="finance-toolbar">
        <button className="primary-btn compact" type="button" onClick={() => setAccount("")}>بحث</button>
        {["سامح", "احمد", "شيكات", "بنك"].map((name) => <button key={name} className={account === name ? "account-filter active" : "account-filter"} onClick={() => setAccount(account === name ? "" : name)}>{name}</button>)}
      </section>

      <section className="table-wrap accounts-table finance-table">
        <table>
          <thead><tr>{["التاريخ", "نوع المصروف", "البيان", "المبلغ", "الحساب / الوجهة", "اسم العميل", "رقم التفصيل", "المضاف", "التاريخ"].map((head) => <th key={head}>{head}</th>)}</tr></thead>
          <tbody>
            {data.transactions.length === 0 && <EmptyRow colSpan={9} />}
            {data.transactions.map((record) => <tr key={record.id}><td>{formatDateArabic(record.date)}</td><td>{record.expense_type || record.transaction_type || record.kind || "-"}</td><td>{record.description || "-"}</td><td className={String(record.transaction_type || record.kind).includes("مصروف") ? "danger-text" : ""}>{formatMoney(record.amount ?? record.value ?? record.total)}</td><td><span className="mini-pill">{record.account_destination || "-"}</span></td><td>{record.customer_name || "-"}</td><td>{record.detail_number || "-"}</td><td>{record.added_by || "-"}</td><td>{formatDateArabic(record.created_at)}</td></tr>)}
          </tbody>
        </table>
      </section>

      <section className="finance-bottom-totals">
        <StatCard title="إجمالي الإيرادات" value={formatMoney(data.incomeTotal)} />
        <StatCard title="الصافي" value={formatMoney(data.netTotal)} />
        <StatCard title="إجمالي المصروفات" value={formatMoney(data.expenseTotal)} tone="danger" />
      </section>
    </div>
  );
}

function ReportsPage() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<ReportsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [year, selectedMonth] = month.split("-").map(Number);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getReportsData(selectedMonth, year)
      .then((stats) => { if (active) setData(stats); })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : "تعذر تحميل التقارير."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [selectedMonth, year]);

  if (loading) return <LoadingPanel />;
  if (error || !data) return <ErrorPanel message={error || "تعذر تحميل البيانات."} />;

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head"><h2>التقارير</h2><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></div>
        <div className="stats-grid"><StatCard title="الإيرادات" value={formatMoney(data.incomeTotal)} /><StatCard title="المصروفات" value={formatMoney(data.expenseTotal)} tone="danger" /><StatCard title="الصافي" value={formatMoney(data.netTotal)} /></div>
      </section>
      <section className="panel dashboard-grid">
        <div className="donut-card"><div className="donut-ring" /><strong>{formatMoney(data.netTotal)}</strong><span>الصافي</span></div>
        <div className="table-wrap accounts-table"><table><thead><tr><th>الشهر</th><th>إيرادات</th><th>مصروفات</th><th>صافي</th></tr></thead><tbody>
          {data.monthlyRows.length === 0 && <EmptyRow colSpan={4} />}
          {data.monthlyRows.map((row) => <tr key={row.month}><td>{row.month}</td><td>{formatMoney(row.income)}</td><td>{formatMoney(row.expense)}</td><td>{formatMoney(row.net)}</td></tr>)}
        </tbody></table></div>
      </section>
    </div>
  );
}

function AuditLog() {
  const rows = loadAudit();
  return (
    <section className="panel">
      <h2>سجل العمليات</h2>
      <div className="table-wrap audit-table">
        <table>
          <thead><tr>{["التاريخ", "المستخدم", "الدور", "الإجراء", "النوع", "ID"].map((head) => <th key={head}>{head}</th>)}</tr></thead>
          <tbody>{rows.map((row) => <tr key={row.id}><td>{new Date(row.created_at).toLocaleString("ar-EG")}</td><td>{row.user_email}</td><td>{row.user_role}</td><td>{row.action}</td><td>{row.entity_type}</td><td>{row.entity_id}</td></tr>)}</tbody>
        </table>
      </div>
      {rows.length === 0 && <p className="muted">لا توجد عمليات مسجلة بعد.</p>}
    </section>
  );
}

function rowToOrder(row: Record<string, string | number>): Order {
  const pick = (...names: string[]) => names.map((name) => row[name]).find((value) => value !== undefined && value !== "") ?? "";
  const now = new Date().toISOString();
  return calculate({
    ...emptyOrder,
    id: createId(),
    order_number: String(pick("رقم الأوردر", "order_number")),
    source_person: String(pick("الطرف", "source_person")),
    client_name: String(pick("اسم العميل", "client_name")),
    client_code: String(pick("كود العميل", "client_code")),
    phone: String(pick("رقم التليفون", "phone")),
    delivery_date: excelDate(pick("تاريخ التسليم", "delivery_date")),
    price: Number(pick("السعر", "price") || 0),
    quantity: Number(pick("العدد", "quantity") || 1),
    paid: Number(pick("المدفوع", "paid") || 0),
    old_balance: Number(pick("حساب قديم", "old_balance") || 0),
    order_type: String(pick("النوع", "order_type")),
    logo_status: String(pick("اللوجو", "logo_status") || "غير موجود"),
    quality_notes: String(pick("الجودة", "quality_notes")),
    operation_status: String(pick("التشغيل", "operation_status")),
    finishing_status: String(pick("التشطيب", "finishing_status")),
    order_status: (String(pick("الحالة", "order_status") || "جديد") as OrderStatus),
    client_message: String(pick("الرسالة", "client_message")),
    notes: String(pick("ملاحظات", "notes")),
    created_at: now,
    updated_at: now,
  });
}

function excelDate(value: string | number) {
  if (typeof value === "number") {
    const date = XLSX.SSF.parse_date_code(value);
    return date ? `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}` : "";
  }
  return String(value || "").slice(0, 10);
}

function SettingsPage() {
  const users = Object.entries(localUsers);
  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head">
          <h2>الإعدادات</h2>
          <span className="badge badge-red">Master فقط</span>
        </div>
        <div className="stats-grid">
          <StatCard title="عدد المستخدمين" value={users.length} icon={Users} />
          <StatCard title="كلمة المرور الافتراضية" value="1234" icon={KeyRound} />
          <StatCard title="حسابات" icon={WalletCards} value={<span className="account-pills"><i>سامح</i><i>أحمد</i><i>شيكات</i><i>بنك</i></span>} />
          <StatCard title="الشعار" icon={Image} value={<span className="logo-preview-value"><BrandLogo /><small>src/assets/logo.png</small></span>} />
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>إدارة المستخدمين</h2>
          <button className="ghost-btn compact" type="button">إعادة تعيين كلمة المرور إلى 1234</button>
        </div>
        <div className="table-wrap accounts-table">
          <table>
            <thead>
              <tr>
                <th>اسم المستخدم</th>
                <th>الاسم</th>
                <th>الدور</th>
                <th>الحالة</th>
                <th>تغيير كلمة المرور</th>
              </tr>
            </thead>
            <tbody>
              {users.map(([username, user]) => (
                <tr key={username}>
                  <td>{username}</td>
                  <td>{user.fullName}</td>
                  <td>{user.role}</td>
                  <td><span className="badge badge-green">مفعل</span></td>
                  <td>{user.mustChangePassword ? "مطلوب عند أول دخول" : "لا"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

class AppErrorBoundary extends Component<{ children: ReactNode }, { message: string }> {
  state = { message: "" };

  static getDerivedStateFromError(error: unknown) {
    return { message: error instanceof Error ? error.message : "حدث خطأ غير متوقع." };
  }

  render() {
    if (this.state.message) {
      return (
        <main className="error-page" dir="rtl">
          <BrandLogo className="login-logo" />
          <section className="panel error-card">
            <h1>حدث خطأ في الصفحة</h1>
            <p>{this.state.message}</p>
            <button className="primary-btn" onClick={() => window.location.reload()}>إعادة تحميل النظام</button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}

function AddProductPage({ products, setProducts, session }: { products: Product[]; setProducts: React.Dispatch<React.SetStateAction<Product[]>>; session: Session }) {
  const [name, setName] = useState("");
  const [details, setDetails] = useState("");
  const [price, setPrice] = useState(0);

  function save(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    const product: Product = { id: createId(), name: name.trim(), details, price: Number(price || 0), created_at: new Date().toISOString() };
    setProducts((current) => [product, ...current]);
    addAudit(session, "PRODUCT_CREATED", "products", product.id, undefined, product);
    setName("");
    setDetails("");
    setPrice(0);
  }

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head"><h2>إضافة منتج</h2></div>
        <form className="order-form compact-form" onSubmit={save}>
          <label>اسم المنتج<input value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label>الوصف<input value={details} onChange={(event) => setDetails(event.target.value)} /></label>
          <label>السعر<input type="number" value={price} onChange={(event) => setPrice(Number(event.target.value))} /></label>
          <button className="primary-btn" type="submit">حفظ المنتج</button>
        </form>
      </section>
      <section className="table-wrap accounts-table">
        <table>
          <thead><tr><th>اسم المنتج</th><th>الوصف</th><th>السعر</th><th>تاريخ الإضافة</th></tr></thead>
          <tbody>
            {products.length === 0 && <EmptyRow colSpan={4} />}
            {products.map((product) => <tr key={product.id}><td>{product.name}</td><td>{product.details || "-"}</td><td>{formatMoney(product.price)}</td><td>{formatDateArabic(product.created_at)}</td></tr>)}
          </tbody>
        </table>
      </section>
    </div>
  );
}

type SidebarSubItemConfig = {
  id: View;
  label: string;
  visible: boolean;
  icon?: LucideIcon;
};

type SidebarSectionConfig = {
  id: string;
  label: string;
  icon: LucideIcon;
  items: SidebarSubItemConfig[];
};

function SidebarSubItem({ item, active, onSelect }: { item: SidebarSubItemConfig; active: boolean; onSelect: (view: View) => void }) {
  const Icon = item.icon;
  return (
    <button type="button" className={`sidebar-subitem${active ? " active" : ""}`} onClick={() => onSelect(item.id)}>
      {Icon && <Icon size={16} />}
      <span>{item.label}</span>
    </button>
  );
}

function SidebarSection({ section, activeView, open, onToggle, onSelect }: { section: SidebarSectionConfig; activeView: View; open: boolean; onToggle: () => void; onSelect: (view: View) => void }) {
  const Icon = section.icon;
  const hasActiveItem = section.items.some((item) => item.id === activeView);
  return (
    <div className={`sidebar-section${open ? " open" : ""}${hasActiveItem ? " has-active" : ""}`}>
      <button type="button" className="sidebar-parent" onClick={onToggle} aria-expanded={open}>
        <span className="sidebar-parent-copy"><Icon size={22} /><span>{section.label}</span></span>
        <span className="sidebar-toggle">{open ? "−" : "+"}</span>
      </button>
      <div className="sidebar-submenu">
        <div className="sidebar-submenu-inner">
          {section.items.map((item) => <SidebarSubItem key={item.id} item={item} active={item.id === activeView} onSelect={onSelect} />)}
        </div>
      </div>
    </div>
  );
}

function Sidebar({ sections, activeView, openSection, drawerOpen, onToggleSection, onSelect, onLogout, onCloseDrawer }: {
  sections: SidebarSectionConfig[];
  activeView: View;
  openSection: string;
  drawerOpen: boolean;
  onToggleSection: (sectionId: string) => void;
  onSelect: (view: View) => void;
  onLogout: () => void;
  onCloseDrawer: () => void;
}) {
  return (
    <>
      <aside className={`sidebar${drawerOpen ? " drawer-open" : ""}`}>
        <button type="button" className="sidebar-close" aria-label="إغلاق القائمة" onClick={onCloseDrawer}><X size={22} /></button>
        <BrandLogo className="sidebar-logo" />
        <nav className="sidebar-menu" aria-label="القائمة الرئيسية">
          {sections.map((section) => (
            <SidebarSection
              key={section.id}
              section={section}
              activeView={activeView}
              open={openSection === section.id}
              onToggle={() => onToggleSection(section.id)}
              onSelect={onSelect}
            />
          ))}
        </nav>
        <button className="sidebar-logout" type="button" onClick={onLogout}>تسجيل الخروج</button>
      </aside>
      <button type="button" className="sidebar-overlay" aria-label="إغلاق القائمة" onClick={onCloseDrawer} />
    </>
  );
}

const knownViews: View[] = ["dashboard", "orders", "new", "addCustomer", "addProduct", "search", "worker", "finish", "customers", "finance", "reports", "audit", "import", "alerts", "settings"];

function viewFromHash(): View {
  const raw = window.location.hash.replace(/^#\/?/, "");
  return knownViews.includes(raw as View) ? raw as View : "dashboard";
}

function ZunionApp() {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [view, setViewState] = useState<View>(() => viewFromHash());
  const [openSection, setOpenSection] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { orders, setOrders } = useOrders();
  const { items: customers, setItems: setCustomers } = useStoredList<Customer>(customersKey, []);
  const { items: financeRecords, setItems: setFinanceRecords } = useStoredList<FinanceRecord>(financeKey, []);
  const { items: products, setItems: setProducts } = useStoredList<Product>(productsKey, []);

  function setView(nextView: View) {
    setViewState(nextView);
    window.history.replaceState(null, "", `#${nextView}`);
  }

  function saveNew(order: Order) {
    setOrders((current) => [order, ...current]);
    addAudit(session, "ORDER_CREATED", "orders", order.id, undefined, order);
    setView("search");
  }

  const currentRole = session?.role ?? "Master";
  const visibleOrders = roleOrders(currentRole, orders);
  const isMaster = currentRole === "Master";
  const isOperator = currentRole === "Operator" || currentRole === "Helper";
  const isSupervisor = currentRole === "Supervisor" || currentRole === "Worker";
  const isFinishing = currentRole === "Finishing" || currentRole === "Finish";
  const sidebarSections = useMemo<SidebarSectionConfig[]>(() => {
    const sections: SidebarSectionConfig[] = [
      {
        id: "home",
        label: "الرئيسية",
        icon: ClipboardList,
        items: [
          { id: "search", label: "متابعة أوردرات", visible: !isFinishing, icon: ClipboardList },
          { id: "new", label: "أوردر جديد", visible: isMaster || isOperator, icon: FilePlus },
          { id: "addCustomer", label: "إضافة عميل", visible: isMaster || isOperator, icon: UserPlus },
          { id: "addProduct", label: "إضافة منتج", visible: isMaster || isOperator, icon: PackagePlus },
        ],
      },
      {
        id: "search",
        label: "بحث",
        icon: Search,
        items: [
          { id: "search", label: "بحث", visible: !isFinishing, icon: Search },
          { id: "customers", label: "العملاء", visible: isMaster || isOperator || isSupervisor, icon: Users },
        ],
      },
      {
        id: "finance",
        label: "مصروفات وإيرادات",
        icon: ArrowUpDown,
        items: [
          { id: "finance", label: "مصروفات وإيرادات", visible: isMaster || isOperator, icon: WalletCards },
          { id: "reports", label: "التقارير", visible: isMaster || isOperator, icon: BadgeInfo },
          { id: "import", label: "الاستيراد والتصدير", visible: isMaster, icon: ArrowUpDown },
        ],
      },
      {
        id: "operation",
        label: "التشغيل",
        icon: Cog,
        items: [
          { id: "worker", label: "التشغيل", visible: isMaster || isOperator || isSupervisor, icon: Cog },
          { id: "alerts", label: "التنبيهات", visible: true, icon: BadgeInfo },
        ],
      },
      {
        id: "finishing",
        label: "التشطيب",
        icon: Wrench,
        items: [
          { id: "finish", label: "التشطيب", visible: isMaster || isFinishing, icon: Wrench },
        ],
      },
      {
        id: "system",
        label: "الإعدادات",
        icon: Cog,
        items: [
          { id: "audit", label: "سجل العمليات", visible: isMaster, icon: ClipboardList },
          { id: "settings", label: "الإعدادات", visible: isMaster, icon: Cog },
        ],
      },
    ];
    return sections
      .map((section) => ({ ...section, items: section.items.filter((item) => item.visible) }))
      .filter((section) => section.items.length > 0);
  }, [isFinishing, isMaster, isOperator, isSupervisor]);

  useEffect(() => {
    const activeSection = sidebarSections.find((section) => section.items.some((item) => item.id === view));
    if (activeSection) setOpenSection(activeSection.id);
    else if (view === "dashboard") setOpenSection("home");
  }, [sidebarSections, view]);

  function selectSidebarView(nextView: View) {
    setView(nextView);
    setDrawerOpen(false);
  }

  function toggleSidebarSection(sectionId: string) {
    setOpenSection((current) => current === sectionId ? "" : sectionId);
  }

  function logout() {
    localStorage.removeItem(sessionKey);
    addAudit(session, "LOGOUT", "auth");
    setSession(null);
  }

  if (!session) return <Login onLogin={setSession} />;

  return (
    <div className="app" dir="rtl">
      <Sidebar
        sections={sidebarSections}
        activeView={view}
        openSection={openSection}
        drawerOpen={drawerOpen}
        onToggleSection={toggleSidebarSection}
        onSelect={selectSidebarView}
        onLogout={logout}
        onCloseDrawer={() => setDrawerOpen(false)}
      />
      <main className="content">
        <header className="topbar">
          <button type="button" className="hamburger-btn" aria-label="فتح القائمة" onClick={() => setDrawerOpen(true)}><Menu size={24} /></button>
          <div>
            <h1>نظام Zunion لإدارة الأوردرات</h1>
            <p>{session.fullName || session.username || session.email} - {session.role}</p>
          </div>
          <BrandLogo className="top-logo" />
        </header>
        <section className="page">
          {view === "dashboard" && <Dashboard setView={setView} canSeeFinancials={canManageFinancials(session.role)} />}
          {view === "new" && <OrderForm orderNumber={nextOrderNumber(orders)} customers={customers} onSave={saveNew} />}
          {view === "addCustomer" && <AddCustomerPage customers={customers} setCustomers={setCustomers} session={session} />}
          {view === "addProduct" && <AddProductPage products={products} setProducts={setProducts} session={session} />}
          {view === "search" && <SearchPage orders={orders} setOrders={setOrders} session={session} />}
          {view === "worker" && <OrdersPage orders={orders} setOrders={setOrders} session={session} queue="worker" />}
          {view === "finish" && <OrdersPage orders={orders} setOrders={setOrders} session={session} queue="finish" />}
          {view === "customers" && <CustomerAccounts orders={orders} customers={customers} session={session} setOrders={setOrders} />}
          {view === "finance" && (canManageFinancials(session.role) ? <FinancePageModern session={session} /> : <ErrorPanel message="ليس لديك صلاحية للوصول لهذه الصفحة" />)}
          {view === "reports" && (canManageFinancials(session.role) ? <ReportsPage /> : <ErrorPanel message="ليس لديك صلاحية للوصول لهذه الصفحة" />)}
          {view === "import" && <ImportExport orders={orders} setOrders={setOrders} session={session} />}
          {view === "audit" && <AuditLog />}
          {view === "settings" && <SettingsPage />}
          {view === "alerts" && <section className="panel"><h2>تنبيهات التسليم</h2><div className="alerts-list">{buildAlerts(visibleOrders, canManageFinancials(session.role)).map((alert, index) => <AlertItem key={`${alert.order.id}-${index}`} alert={alert} />)}</div></section>}
        </section>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AppErrorBoundary>
      <ZunionApp />
    </AppErrorBoundary>
  );
}

