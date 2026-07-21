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
  Printer,
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
import { formatDateArabic, formatDateTimeEnglish, formatMoney, formatNumber, normalizeDigitsToEnglish } from "./utils/formatters";
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
type WorkStage = "new" | "operation" | "finishing" | "completed" | "cancelled";
type View = "dashboard" | "orders" | "new" | "addCustomer" | "addProduct" | "search" | "worker" | "finish" | "customers" | "finance" | "reports" | "audit" | "import" | "alerts" | "settings";
type Role = string;
type Session = { email: string; username?: string; fullName?: string; role: Role; expiresAt: string; loggedInAt: string; mustChangePassword?: boolean; tokenVersion?: number };
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
type OperationItem = {
  method: string;
  logoImage: string;
  logoFileName?: string;
  logoImageSource?: "upload" | "clipboard";
  logoImageSize?: number;
  workOrderImage: string;
  workOrderFileName?: string;
  workOrderImageSource?: "upload" | "clipboard";
  workOrderImageSize?: number;
};
type Customer = {
  id: string;
  source_person: string;
  client_name: string;
  client_code: string;
  phone: string;
  email?: string;
  address?: string;
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
  price?: number;
  active?: boolean;
  status?: "active" | "inactive";
  logoPlacement?: string;
  defaultQuantity?: number;
  defaultPrice?: number | null;
  defaultTotal?: number | null;
  quality?: string;
  productImage?: string;
  logoImage?: string;
  productImageName?: string;
  logoImageName?: string;
  materials?: string[];
  operationMethods?: string[];
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
  productId?: string;
  productName?: string;
  paymentMethod?: string;
  customPaymentMethod?: string;
  customParty?: string;
  materialsStatus?: string;
  operationMethods?: string[];
  operationItems?: OperationItem[];
  logoFileName?: string;
  workOrderFileName?: string;
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
  workStage: WorkStage;
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
const managedUsersKey = "zunion-managed-users-v1";
const managedRolesKey = "zunion-managed-roles-v1";
const partyOptions = ["أحمد", "حسن", "خليفة", "أخرى"];

type PermissionKey =
  | "dashboard.view" | "orders.view" | "orders.create" | "orders.edit" | "orders.delete" | "orders.print"
  | "customers.view" | "customers.create" | "customers.edit" | "customers.delete" | "customers.print"
  | "products.view" | "products.create" | "products.edit" | "products.delete" | "products.print"
  | "search.use" | "expenses.view" | "expenses.create" | "expenses.print" | "revenues.view" | "revenues.create" | "revenues.print"
  | "operation.view" | "operation.update" | "operation.upload" | "operation.print"
  | "finishing.view" | "finishing.update" | "finishing.upload" | "finishing.print"
  | "reports.view" | "reports.print" | "import.export"
  | "users.view" | "users.create" | "users.edit" | "users.deactivate" | "users.delete" | "users.resetPassword" | "users.resetAllPasswords"
  | "roles.view" | "roles.create" | "roles.edit" | "roles.delete" | "permissions.manage" | "audit.view" | "settings.view";

type PermissionOverride = { allow: PermissionKey[]; deny: PermissionKey[] };
type ManagedUser = {
  id: string;
  username: string;
  fullName: string;
  email: string;
  role: string;
  password: string;
  status: "active" | "inactive";
  mustChangePassword: boolean;
  permissionOverrides: PermissionOverride;
  createdAt: string;
  lastLoginAt?: string;
};
type ManagedRole = {
  id: string;
  name: string;
  description: string;
  status: "active" | "inactive";
  permissions: PermissionKey[];
  isSystemRole: boolean;
  createdAt: string;
  updatedAt: string;
};

const permissionGroups: Array<{ group: string; permissions: Array<{ key: PermissionKey; label: string; action: string }> }> = [
  { group: "الرئيسية", permissions: [
    { key: "dashboard.view", label: "الرئيسية", action: "عرض" },
    { key: "orders.view", label: "متابعة أوردرات", action: "عرض" },
    { key: "orders.create", label: "أوردر جديد", action: "إضافة" },
    { key: "orders.edit", label: "الأوردرات", action: "تعديل" },
    { key: "orders.delete", label: "الأوردرات", action: "حذف" },
    { key: "orders.print", label: "الأوردرات", action: "طباعة" },
  ] },
  { group: "العملاء", permissions: [
    { key: "customers.view", label: "بيانات العملاء", action: "عرض" },
    { key: "customers.create", label: "إضافة عميل", action: "إضافة" },
    { key: "customers.edit", label: "العملاء", action: "تعديل" },
    { key: "customers.delete", label: "العملاء", action: "حذف" },
    { key: "customers.print", label: "العملاء", action: "طباعة" },
  ] },
  { group: "المنتجات", permissions: [
    { key: "products.view", label: "بيانات المنتجات", action: "عرض" },
    { key: "products.create", label: "إضافة منتج", action: "إضافة" },
    { key: "products.edit", label: "المنتجات", action: "تعديل" },
    { key: "products.delete", label: "المنتجات", action: "حذف" },
    { key: "products.print", label: "المنتجات", action: "طباعة" },
  ] },
  { group: "مصروفات وإيرادات", permissions: [
    { key: "expenses.view", label: "عرض المصروفات", action: "عرض" },
    { key: "expenses.create", label: "إضافة مصروف", action: "إضافة" },
    { key: "expenses.print", label: "المصروفات", action: "طباعة" },
    { key: "revenues.view", label: "عرض الإيرادات", action: "عرض" },
    { key: "revenues.create", label: "إضافة إيراد", action: "إضافة" },
    { key: "revenues.print", label: "الإيرادات", action: "طباعة" },
  ] },
  { group: "التشغيل", permissions: [
    { key: "operation.view", label: "أوردرات التشغيل", action: "عرض" },
    { key: "operation.update", label: "حالة التشغيل", action: "تغيير حالة" },
    { key: "operation.upload", label: "ملفات التشغيل", action: "رفع ملفات" },
    { key: "operation.print", label: "التشغيل", action: "طباعة" },
  ] },
  { group: "التشطيب", permissions: [
    { key: "finishing.view", label: "أوردرات التشطيب", action: "عرض" },
    { key: "finishing.update", label: "حالة التشطيب", action: "تغيير حالة" },
    { key: "finishing.upload", label: "ملفات التشطيب", action: "رفع ملفات" },
    { key: "finishing.print", label: "التشطيب", action: "طباعة" },
  ] },
  { group: "التقارير والإعدادات", permissions: [
    { key: "reports.view", label: "التقارير", action: "عرض" },
    { key: "reports.print", label: "التقارير", action: "طباعة" },
    { key: "import.export", label: "الاستيراد والتصدير", action: "تصدير" },
    { key: "settings.view", label: "الإعدادات", action: "عرض" },
    { key: "audit.view", label: "سجل العمليات", action: "عرض" },
    { key: "users.view", label: "إدارة المستخدمين", action: "عرض" },
    { key: "users.create", label: "المستخدمين", action: "إضافة" },
    { key: "users.edit", label: "المستخدمين", action: "تعديل" },
    { key: "users.deactivate", label: "المستخدمين", action: "إيقاف/تفعيل" },
    { key: "users.delete", label: "المستخدمين", action: "حذف" },
    { key: "users.resetPassword", label: "كلمة مرور المستخدمين", action: "تغيير" },
    { key: "users.resetAllPasswords", label: "كل كلمات المرور", action: "إعادة تعيين" },
    { key: "roles.view", label: "الأدوار", action: "عرض" },
    { key: "roles.create", label: "الأدوار", action: "إضافة" },
    { key: "roles.edit", label: "الأدوار", action: "تعديل" },
    { key: "roles.delete", label: "الأدوار", action: "حذف" },
    { key: "permissions.manage", label: "الصلاحيات", action: "إدارة" },
  ] },
];
const allPermissionKeys = permissionGroups.flatMap((group) => group.permissions.map((permission) => permission.key));
const masterProtectedPermissions: PermissionKey[] = ["users.view", "users.create", "users.edit", "users.deactivate", "users.delete", "users.resetPassword", "users.resetAllPasswords", "roles.view", "roles.create", "roles.edit", "permissions.manage", "audit.view", "settings.view"];

const roleByEmail: Record<string, Role> = {
  "mahmoudmostafa3104@gmail.com": "Master",
  "mahmoudelwensh2007@gmail.com": "Helper",
  "mahmoudodo20072021@gmail.com": "Worker",
  "mahmoud.foly.2007@gmail.com": "Finish",
};

const localUsers: Record<string, { fullName: string; role: Role; password: string; email: string; mustChangePassword: boolean }> = {
  mahmoud: { fullName: "Mahmoud", role: "Master", password: "1234", email: "mahmoud@zunion.local", mustChangePassword: false },
  reda: { fullName: "Reda", role: "Master", password: "1234", email: "reda@zunion.local", mustChangePassword: false },
  hassan: { fullName: "Hassan", role: "Master", password: "1234", email: "hassan@zunion.local", mustChangePassword: false },
  omar: { fullName: "Omar", role: "Operator", password: "1234", email: "omar@zunion.local", mustChangePassword: false },
  youssef: { fullName: "Youssef", role: "Operator", password: "1234", email: "youssef@zunion.local", mustChangePassword: false },
  khalifa: { fullName: "Khalifa", role: "Operator", password: "1234", email: "khalifa@zunion.local", mustChangePassword: false },
  "opr 1": { fullName: "Opr 1", role: "Operator", password: "1234", email: "opr1@zunion.local", mustChangePassword: false },
  "opr 2": { fullName: "Opr 2", role: "Operator", password: "1234", email: "opr2@zunion.local", mustChangePassword: false },
  "opr 3": { fullName: "Opr 3", role: "Operator", password: "1234", email: "opr3@zunion.local", mustChangePassword: false },
  "supervisor 1": { fullName: "Supervisor 1", role: "Supervisor", password: "1234", email: "supervisor1@zunion.local", mustChangePassword: false },
  "supervisor 2": { fullName: "Supervisor 2", role: "Supervisor", password: "1234", email: "supervisor2@zunion.local", mustChangePassword: false },
  "supervisor 3": { fullName: "Supervisor 3", role: "Supervisor", password: "1234", email: "supervisor3@zunion.local", mustChangePassword: false },
  "finishing 1": { fullName: "Finishing 1", role: "Finishing", password: "1234", email: "finishing1@zunion.local", mustChangePassword: false },
  "finishing 2": { fullName: "Finishing 2", role: "Finishing", password: "1234", email: "finishing2@zunion.local", mustChangePassword: false },
};

const roleDefaultPermissions: Record<string, PermissionKey[]> = {
  Master: allPermissionKeys,
  Helper: ["dashboard.view", "orders.view", "orders.create", "orders.edit", "orders.print", "customers.view", "customers.create", "customers.print", "products.view", "products.create", "search.use", "operation.view", "operation.update", "operation.upload", "operation.print", "finishing.view", "finishing.print"],
  Operator: ["dashboard.view", "orders.view", "orders.create", "orders.edit", "orders.print", "customers.view", "customers.create", "products.view", "products.create", "search.use", "expenses.view", "expenses.create", "revenues.view", "revenues.create", "operation.view", "operation.update", "operation.upload"],
  Supervisor: ["dashboard.view", "orders.view", "orders.edit", "orders.print", "customers.view", "products.view", "search.use", "operation.view", "operation.update", "operation.upload", "operation.print"],
  Worker: ["orders.view", "orders.edit", "operation.view", "operation.update", "operation.upload", "operation.print"],
  Finishing: ["orders.view", "orders.edit", "finishing.view", "finishing.update", "finishing.upload", "finishing.print"],
  Finish: ["orders.view", "orders.edit", "finishing.view", "finishing.update", "finishing.upload", "finishing.print"],
};

function seedRoles(): ManagedRole[] {
  const now = new Date().toISOString();
  return Object.entries(roleDefaultPermissions).map(([name, permissions]) => ({
    id: name,
    name,
    description: name === "Master" ? "دور إداري كامل ومحمي" : "",
    status: "active",
    permissions,
    isSystemRole: ["Master", "Operator", "Supervisor", "Finishing", "Helper", "Worker", "Finish"].includes(name),
    createdAt: now,
    updatedAt: now,
  }));
}

function seedManagedUsers(): ManagedUser[] {
  const now = new Date().toISOString();
  return Object.entries(localUsers).map(([username, user]) => ({
    id: `user-${username}`,
    username,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    password: user.password,
    status: "active",
    mustChangePassword: user.mustChangePassword,
    permissionOverrides: { allow: [], deny: [] },
    createdAt: now,
  }));
}

function loadManagedRoles(): ManagedRole[] {
  try {
    const saved = JSON.parse(localStorage.getItem(managedRolesKey) || "[]") as ManagedRole[];
    const byName = new Map(seedRoles().map((role) => [role.name.toLowerCase(), role]));
    for (const role of saved) byName.set(role.name.toLowerCase(), { ...role, permissions: role.name === "Master" ? Array.from(new Set([...role.permissions, ...masterProtectedPermissions])) : role.permissions });
    return Array.from(byName.values());
  } catch {
    localStorage.removeItem(managedRolesKey);
    return seedRoles();
  }
}

function saveManagedRoles(roles: ManagedRole[]) {
  localStorage.setItem(managedRolesKey, JSON.stringify(roles));
}

function loadManagedUsers(): ManagedUser[] {
  try {
    const saved = JSON.parse(localStorage.getItem(managedUsersKey) || "[]") as ManagedUser[];
    const byUsername = new Map(seedManagedUsers().map((user) => [user.username, user]));
    for (const user of saved) byUsername.set(user.username, { ...user, permissionOverrides: user.permissionOverrides || { allow: [], deny: [] } });
    return Array.from(byUsername.values());
  } catch {
    localStorage.removeItem(managedUsersKey);
    return seedManagedUsers();
  }
}

function saveManagedUsers(users: ManagedUser[]) {
  localStorage.setItem(managedUsersKey, JSON.stringify(users));
}

function activeMasterCount(users = loadManagedUsers()) {
  return users.filter((user) => user.role === "Master" && user.status === "active").length;
}

function loadLocalPasswords(): Record<string, { password: string; mustChangePassword: boolean }> {
  try {
    return JSON.parse(localStorage.getItem(localPasswordsKey) || "{}") as Record<string, { password: string; mustChangePassword: boolean }>;
  } catch {
    localStorage.removeItem(localPasswordsKey);
    return {};
  }
}

function getLocalUser(username: string) {
  const managed = loadManagedUsers().find((user) => user.username === username);
  if (managed) return {
    fullName: managed.fullName,
    role: managed.role as Role,
    password: managed.password,
    email: managed.email,
    mustChangePassword: false,
    status: managed.status,
  };
  const base = localUsers[username];
  if (!base) return null;
  const saved = loadLocalPasswords()[username];
  return {
    ...base,
    password: saved?.password || base.password,
    mustChangePassword: false,
  };
}

function saveLocalPassword(username: string, password: string) {
  const current = loadLocalPasswords();
  localStorage.setItem(localPasswordsKey, JSON.stringify({
    ...current,
    [username]: { password, mustChangePassword: false },
  }));
  const users = loadManagedUsers();
  saveManagedUsers(users.map((user) => user.username === username ? { ...user, password, mustChangePassword: false } : user));
}

function resolvePermissionsForSession(session: Session | null, roles = loadManagedRoles(), users = loadManagedUsers()): Set<PermissionKey> {
  if (!session) return new Set();
  if (session.role === "Master") return new Set(allPermissionKeys);
  const user = users.find((item) => item.username === session.username);
  const roleName = user?.role || session.role;
  const role = roles.find((item) => item.name === roleName && item.status === "active");
  const permissions = new Set<PermissionKey>(role?.permissions || roleDefaultPermissions[roleName] || []);
  for (const key of user?.permissionOverrides?.allow || []) permissions.add(key);
  for (const key of user?.permissionOverrides?.deny || []) permissions.delete(key);
  return permissions;
}

function hasPermission(session: Session | null, key: PermissionKey) {
  return resolvePermissionsForSession(session).has(key);
}

const routePermissions: Partial<Record<View, PermissionKey>> = {
  dashboard: "dashboard.view",
  orders: "orders.view",
  new: "orders.create",
  addCustomer: "customers.create",
  addProduct: "products.create",
  search: "orders.view",
  worker: "operation.view",
  finish: "finishing.view",
  customers: "customers.view",
  finance: "expenses.view",
  reports: "reports.view",
  import: "import.export",
  audit: "audit.view",
  alerts: "orders.view",
};

function canAccessView(session: Session | null, view: View) {
  const key = routePermissions[view];
  return !key || hasPermission(session, key);
}

const workflowStages: WorkflowStage[] = ["أوردر جديد", "يروح للتشغيل", "التشغيل", "يروح للتشطيب", "التشطيب", "الشغل جاهز", "تم التسليم"];
const statuses: OrderStatus[] = ["جديد", "في التشغيل", "في التشطيب", "جاهز", "تم التسليم", "مشكلة جودة", "متأخر"];
const paymentMethods = [
  { value: "cash", label: "نقدي" },
  { value: "bank_transfer", label: "تحويل بنكي" },
  { value: "instapay", label: "إنستاباي" },
  { value: "wallet", label: "محفظة إلكترونية" },
  { value: "deferred", label: "آجل" },
  { value: "other", label: "أخرى" },
] as const;
const materialStatusOptions = [
  { value: "available", label: "متوفرة" },
  { value: "unavailable", label: "غير متوفرة" },
] as const;
const workStageLabels: Record<WorkStage, string> = {
  new: "أوردر جديد",
  operation: "التشغيل",
  finishing: "التشطيب",
  completed: "مكتمل",
  cancelled: "ملغي",
};
const workStageOptions = Object.keys(workStageLabels) as WorkStage[];

function normalizeWorkStage(value: unknown): WorkStage {
  const raw = String(value ?? "").trim();
  const normalized = raw.toLowerCase();
  if (["new", "operation", "finishing", "completed", "cancelled"].includes(normalized)) return normalized as WorkStage;
  if (["NEW"].includes(raw) || raw === "أوردر جديد" || raw === "جديد") return "new";
  if (["SENT_TO_WORKER", "WORKER_STARTED", "WORKER_DONE"].includes(raw) || raw === "تشغيل" || raw === "التشغيل" || raw === "يروح للتشغيل" || raw === "في التشغيل") return "operation";
  if (["SENT_TO_FINISH", "FINISH_STARTED", "FINISH_DONE"].includes(raw) || raw === "تشطيب" || raw === "التشطيب" || raw === "يروح للتشطيب" || raw === "في التشطيب") return "finishing";
  if (["READY", "CUSTOMER_MESSAGED", "DELIVERED"].includes(raw) || raw === "مكتمل" || raw === "تم التسليم" || raw === "الشغل جاهز" || raw === "جاهز") return "completed";
  if (["CANCELLED"].includes(raw) || raw === "ملغي" || raw === "إلغاء" || raw === "الغاء") return "cancelled";
  return "new";
}

function stageLabel(stage: WorkStage) {
  return workStageLabels[stage];
}

function normalizeMaterialsStatus(value: unknown) {
  const raw = String(value ?? "").trim();
  if (raw === "available" || raw === "موجود" || raw === "متوفرة") return "available";
  if (raw === "unavailable" || raw === "غير موجود" || raw === "غير متوفرة") return "unavailable";
  return "";
}

function materialStatusLabel(value: unknown) {
  const normalized = normalizeMaterialsStatus(value);
  if (normalized === "available") return "متوفرة";
  if (normalized === "unavailable") return "غير متوفرة";
  return "—";
}

function stageToStatus(stage: WorkStage): OrderStatus {
  if (stage === "operation") return "في التشغيل";
  if (stage === "finishing") return "في التشطيب";
  if (stage === "completed") return "تم التسليم";
  if (stage === "cancelled") return "متأخر";
  return "جديد";
}

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

function escapeHtml(value: unknown) {
  return normalizeDigitsToEnglish(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" }[char] || char));
}

function isEmailValue(value: unknown) {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function EmailText({ email, mode = "truncate", className = "", showTooltip = true }: { email?: string | null; mode?: "truncate" | "wrap"; className?: string; showTooltip?: boolean }) {
  const value = String(email || "").trim();
  return (
    <span className={`email-text ${mode === "wrap" ? "email-text--wrap" : ""} ${className}`.trim()} title={showTooltip ? value : undefined}>
      {value || "—"}
    </span>
  );
}

function printableCell(value: unknown) {
  const escaped = escapeHtml(value);
  return isEmailValue(value) ? `<span class="email-text">${escaped}</span>` : escaped;
}

const clipboardImageTypes = ["image/png", "image/jpeg", "image/webp"];

function safeClipboardFileName(type: string) {
  const extension = type.includes("jpeg") ? "jpg" : type.includes("webp") ? "webp" : "png";
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return `clipboard-image-${stamp}.${extension}`;
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("حدث خطأ أثناء لصق الصورة"));
    reader.readAsDataURL(file);
  });
}

function normalizeInputDigits(event: React.FormEvent<HTMLElement>) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
  const nextValue = normalizeDigitsToEnglish(target.value);
  if (nextValue === target.value) return;
  const start = target.selectionStart;
  const end = target.selectionEnd;
  target.value = nextValue;
  if (start !== null && end !== null) {
    window.requestAnimationFrame(() => {
      try {
        target.setSelectionRange(start, end);
      } catch {
        // Some input types, such as date, do not support selection ranges.
      }
    });
  }
}

async function readClipboardImageFile() {
  if (!navigator.clipboard?.read) throw new Error("متصفحك لا يدعم لصق الصور من الحافظة");
  try {
    const clipboardItems = await navigator.clipboard.read();
    for (const item of clipboardItems) {
      const imageType = item.types.find((type) => clipboardImageTypes.includes(type));
      if (imageType) {
        const blob = await item.getType(imageType);
        return new File([blob], safeClipboardFileName(imageType), { type: imageType });
      }
    }
    throw new Error("لا توجد صورة في الحافظة");
  } catch (error) {
    if (error instanceof Error && ["لا توجد صورة في الحافظة", "متصفحك لا يدعم لصق الصور من الحافظة"].includes(error.message)) throw error;
    if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")) {
      throw new Error("تعذر الوصول إلى الحافظة. اسمح للموقع بقراءة الحافظة ثم حاول مرة أخرى");
    }
    throw new Error("حدث خطأ أثناء لصق الصورة");
  }
}

function printDocument(title: string, body: string, session?: Session | null, orientation: "portrait" | "landscape" = "portrait") {
  const popup = window.open("", "_blank", "width=1100,height=780");
  const printedAt = formatDateTimeEnglish(new Date());
  const user = session?.fullName || session?.username || session?.email || "";
  const userHtml = isEmailValue(user) ? printableCell(user) : escapeHtml(user);
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8" /><title>${escapeHtml(title)}</title>
    <style>
      @page{size:${orientation};margin:12mm}
      body{font-family:Tahoma,Arial,sans-serif;color:#111827;margin:0;direction:rtl}
      .print-head{display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid #ed1c24;padding-bottom:12px;margin-bottom:16px}
      .print-head img{width:190px;height:auto;object-fit:contain}
      h1{margin:0;color:#111827;font-size:24px}.meta{color:#4b5563;font-size:12px;margin-top:6px}
      table{width:100%;border-collapse:collapse;font-size:12px;table-layout:fixed}thead{display:table-header-group}tr{break-inside:avoid}
      th,td{border:1px solid #d1d5db;padding:7px;text-align:right;vertical-align:top}th{background:#f8fafc;color:#111827;font-weight:800}td,.record-value{color:#ed1c24}
      .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.box{border:1px solid #d1d5db;border-radius:6px;padding:9px;break-inside:avoid}
      .box strong{display:block;color:#111827;font-size:12px;margin-bottom:4px}.section-title{color:#111827;margin:18px 0 8px}
      .email-text{display:block;width:100%;max-width:100%;white-space:normal;overflow:visible;text-overflow:clip;overflow-wrap:anywhere;word-break:break-word;direction:ltr;text-align:left}
      .toolbar{margin-bottom:12px}.toolbar button{background:#ed1c24;color:white;border:0;border-radius:7px;padding:10px 18px;font-weight:800}
      @media print{.toolbar{display:none}}
    </style></head><body><div class="toolbar"><button onclick="window.print()">طباعة</button></div>
    <div class="print-head"><div><h1>${escapeHtml(title)}</h1><div class="meta">نظام Zunion لإدارة الأوردرات</div><div class="meta">تاريخ الطباعة: ${escapeHtml(printedAt)}${user ? ` - المستخدم: ${userHtml}` : ""}</div></div><img src="/zunion-logo.png" /></div>${body}</body></html>`;
  if (!popup) {
    window.print();
    return;
  }
  popup.document.write(html);
  popup.document.close();
  popup.focus();
  setTimeout(() => popup.print(), 250);
}

function printableTable(headers: string[], rows: Array<Array<unknown>>) {
  if (!rows.length) return `<p>لا توجد بيانات للطباعة</p>`;
  return `<table><thead><tr>${headers.map((head) => `<th>${escapeHtml(head)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${printableCell(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function printableRecord(fields: Array<[string, unknown]>) {
  return `<div class="grid">${fields.map(([label, value]) => `<div class="box"><strong>${escapeHtml(label)}</strong><span class="record-value">${printableCell(value)}</span></div>`).join("")}</div>`;
}

function orderPrintHtml(order: Order) {
  const operationItems = order.operationItems?.length
    ? order.operationItems
    : (order.operationMethods?.length ? order.operationMethods : []).map((method) => ({ method, logoImage: "", workOrderImage: "" }));
  const methodsHtml = operationItems.length
    ? `<ol>${operationItems.map((item) => `<li>${escapeHtml(item.method || "—")}</li>`).join("")}</ol>`
    : "<p>—</p>";
  const imagesHtml = operationItems
    .map((item, index) => {
      const previews = [
        item.logoImage ? `<img src="${escapeHtml(item.logoImage)}" alt="لوجو ${index + 1}" />` : "<span>لا توجد صورة لوجو</span>",
        item.workOrderImage ? `<img src="${escapeHtml(item.workOrderImage)}" alt="أمر شغل ${index + 1}" />` : "<span>لا توجد صورة أمر شغل</span>",
      ];
      return `<div class="box print-attachment"><strong>مرفقات طريقة التشغيل ${index + 1}</strong><div>${previews.join("")}</div></div>`;
    })
    .join("");
  return `<style>
    .order-print .record-value{color:#111827!important}
    .order-print ol{margin:0;padding-inline-start:22px}
    .order-print .print-attachment img{display:block;max-width:100%;max-height:170px;object-fit:contain;margin:6px 0;border:1px solid #e5e7eb;border-radius:6px}
    .order-print .print-attachment span{display:block;color:#4b5563;margin:6px 0}
  </style><div class="order-print">
    ${printableRecord([
      ["رقم الأوردر", order.order_number],
      ["تاريخ إنشاء الأوردر", formatDateTimeEnglish(order.created_at || new Date())],
      ["تاريخ التسليم", order.delivery_date],
      ["اسم العميل", order.client_name],
      ["كود العميل", order.client_code],
      ["طرف", order.source_person],
      ["نوع المنتج", order.order_type],
      ["العدد", formatNumber(order.quantity)],
      ["السعر", formatMoney(order.price)],
      ["الإجمالي", formatMoney(order.total)],
      ["المدفوع", formatMoney(order.paid)],
      ["طريقة الدفع", paymentMethods.find((method) => method.value === order.paymentMethod)?.label || order.paymentMethod || "—"],
      ["المتبقي", formatMoney(order.remaining)],
      ["الخامات", materialStatusLabel(order.materialsStatus)],
      ["المرحلة الحالية", stageLabel(order.workStage)],
    ])}
    <h2 class="section-title">طريقة التشغيل</h2>
    <div class="box"><strong>طرق التشغيل</strong>${methodsHtml}</div>
    ${imagesHtml ? `<h2 class="section-title">المرفقات</h2><div class="grid">${imagesHtml}</div>` : ""}
  </div>`;
}

function printOrderDocument(order: Order, session?: Session | null) {
  printDocument(`طباعة الأوردر ${order.order_number}`, orderPrintHtml(order), session);
}

const arabicColumns: Partial<Record<keyof Order, string>> = {
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
  materialsStatus: "الخامات",
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
  workStage: "مرحلة الشغل",
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
  source_person: partyOptions[0],
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
  productId: "",
  productName: "",
  paymentMethod: "cash",
  customPaymentMethod: "",
  customParty: "",
  materialsStatus: "",
  operationMethods: [""],
  operationItems: [{ method: "", logoImage: "", workOrderImage: "" }],
  logoFileName: "",
  workOrderFileName: "",
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
  workStage: "new",
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
    workStage: "operation",
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
    workStage: "completed",
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
  const workStage = normalizeWorkStage(order.workStage ?? order.workflow_stage ?? order.order_status);
  const materialsStatus = normalizeMaterialsStatus(order.materialsStatus);
  const items = (order.items || []).map((item) => ({ ...item, total: Number(item.quantity || 0) * Number(item.price || 0) }));
  const lineTotal = items.reduce((sum, item) => sum + item.total, 0);
  const total = lineTotal || Number(order.price || 0) * Number(order.quantity || 0);
  const remaining = total - Number(order.paid || 0);
  return { ...order, materialsStatus, workStage, workflow_stage: stageLabel(workStage) as WorkflowStage, items, total, remaining, net_balance: remaining + Number(order.old_balance || 0) };
}

function normalizeProduct(product: Product): Product {
  const defaultQuantity = Math.max(1, Number(product.defaultQuantity ?? 1) || 1);
  const hasSavedPrice = product.defaultPrice !== undefined && product.defaultPrice !== null || product.price !== undefined && product.price !== null;
  const defaultPrice = hasSavedPrice ? Math.max(0, Number(product.defaultPrice ?? product.price ?? 0) || 0) : undefined;
  const status = product.status ?? (product.active === false ? "inactive" : "active");
  return {
    ...product,
    name: product.name || "",
    details: product.details || "",
    price: defaultPrice,
    active: status === "active",
    status,
    logoPlacement: product.logoPlacement || "",
    defaultQuantity,
    defaultPrice,
    defaultTotal: defaultPrice === undefined ? undefined : defaultQuantity * defaultPrice,
    quality: product.quality || "",
    productImage: product.productImage || "",
    logoImage: product.logoImage || "",
    productImageName: product.productImageName || "",
    logoImageName: product.logoImageName || "",
    operationMethods: product.operationMethods || [],
  };
}

function orderForStorage(order: Order): Order {
  return {
    ...order,
    logo_image_url: order.logo_image_url.startsWith("blob:") ? "" : order.logo_image_url,
    work_order_image_url: order.work_order_image_url.startsWith("blob:") ? "" : order.work_order_image_url,
    items: (order.items || []).map((item) => ({
      ...item,
      product_image_url: item.product_image_url.startsWith("blob:") || item.product_image_url.startsWith("data:") ? "" : item.product_image_url,
      logo_url: item.logo_url.startsWith("blob:") || item.logo_url.startsWith("data:") ? "" : item.logo_url,
    })),
  };
}

async function backendJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    headers: options.body instanceof FormData ? undefined : { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  if (!response.ok) {
    const raw = await response.text();
    let message = response.statusText;
    try {
      const body = raw ? JSON.parse(raw) as { message?: string; error?: string } : {};
      message = body.message || body.error || message;
    } catch {
      message = raw || message;
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

function orderStatusFromApi(status: unknown, workStage: unknown): OrderStatus {
  const raw = String(status ?? "").trim();
  if (raw === "DELIVERED" || raw === "CUSTOMER_MESSAGED") return "تم التسليم";
  if (raw === "READY") return "جاهز";
  if (raw === "FINISH_STARTED" || raw === "FINISH_DONE" || normalizeWorkStage(workStage) === "finishing") return "في التشطيب";
  if (raw === "SENT_TO_WORKER" || raw === "WORKER_STARTED" || raw === "WORKER_DONE" || normalizeWorkStage(workStage) === "operation") return "في التشغيل";
  return stageToStatus(normalizeWorkStage(workStage));
}

function apiStatusFromOrder(order: Order) {
  if (order.workStage === "cancelled") return "CANCELLED";
  if (order.order_status === "تم التسليم") return "DELIVERED";
  if (order.order_status === "جاهز" || order.workStage === "completed") return "READY";
  if (order.workStage === "finishing") return order.finishing_status === "تم" ? "FINISH_DONE" : "SENT_TO_FINISH";
  if (order.workStage === "operation") return order.operation_status === "تم" ? "WORKER_DONE" : "SENT_TO_WORKER";
  return "NEW";
}

function orderFromApi(row: Record<string, unknown>): Order {
  const workStage = normalizeWorkStage(row.work_stage ?? row.workStage ?? row.status);
  const order = calculate({
    ...emptyOrder,
    id: String(row.id ?? createId()),
    created_by: String(row.created_by ?? row.added_by ?? ""),
    order_number: String(row.order_number ?? ""),
    source_person: String(row.source_party ?? row.party ?? ""),
    client_name: String(row.customer_name_snapshot ?? row.customer_name ?? ""),
    client_code: String(row.customer_code_snapshot ?? ""),
    phone: String(row.phone_snapshot ?? row.phone ?? ""),
    delivery_date: String(row.delivery_date ?? ""),
    price: Number(row.price ?? 0),
    quantity: Number(row.quantity ?? row.pieces_count ?? 1),
    total: Number(row.total ?? 0),
    paid: Number(row.paid ?? 0),
    old_balance: Number(row.old_account ?? row.old_balance ?? 0),
    order_type: String(row.product_name_snapshot ?? row.type ?? row.service_type ?? ""),
    productId: String(row.product_id ?? ""),
    productName: String(row.product_name_snapshot ?? row.type ?? row.service_type ?? ""),
    paymentMethod: String(row.payment_method ?? "cash"),
    customPaymentMethod: String(row.custom_payment_method ?? ""),
    materialsStatus: normalizeMaterialsStatus(row.materials_status),
    operationMethods: Array.isArray(row.operation_methods) ? row.operation_methods.map(String) : (() => {
      try {
        const parsed = JSON.parse(String(row.operation_methods ?? "[]")) as unknown[];
        return Array.isArray(parsed) ? parsed.map(String) : [""];
      } catch {
        return [""];
      }
    })(),
    logo_place: String(row.logo_place ?? row.logo_status ?? ""),
    logo_status: String(row.logo_status ?? ""),
    quality_notes: String(row.quality_notes ?? ""),
    damaged_pieces: Number(row.damaged_pieces ?? 0),
    operation_status: normalizedOperationStatus(row.operation_status ?? row.status),
    finishing_status: normalizedFinishingStatus(row.finishing_status ?? row.status),
    production_notes: String(row.production_notes ?? ""),
    finishing_notes: String(row.finishing_notes ?? ""),
    order_status: orderStatusFromApi(row.status ?? row.delivery_status, workStage),
    workStage,
    client_message: String(row.message_text ?? row.client_message ?? ""),
    notes: String(row.notes ?? ""),
    created_at: String(row.created_at ?? new Date().toISOString()),
    updated_at: String(row.updated_at ?? row.created_at ?? new Date().toISOString()),
  });
  return order;
}

function orderToApi(order: Order) {
  const calculated = calculate(order);
  const operationMethods = (calculated.operationMethods || []).map((item) => item.trim()).filter(Boolean);
  return {
    source_party: calculated.source_person,
    customer_name_snapshot: calculated.client_name,
    customer_code_snapshot: calculated.client_code,
    phone_snapshot: calculated.phone,
    delivery_date: calculated.delivery_date || null,
    type: calculated.order_type || calculated.productName || "",
    productId: calculated.productId || undefined,
    productName: calculated.productName || calculated.order_type || "",
    paymentMethod: calculated.paymentMethod || "cash",
    customPaymentMethod: calculated.customPaymentMethod || "",
    materialsStatus: normalizeMaterialsStatus(calculated.materialsStatus) || "available",
    operationMethods: operationMethods.length ? operationMethods : ["not_started"],
    quantity: calculated.quantity,
    price: calculated.price,
    paid: calculated.paid,
    old_account: calculated.old_balance,
    status: apiStatusFromOrder(calculated),
    workStage: calculated.workStage,
    notes: calculated.notes,
    message_text: calculated.client_message,
    quality_notes: calculated.quality_notes,
    damaged_pieces: calculated.damaged_pieces,
    production_notes: calculated.production_notes,
    finishing_notes: calculated.finishing_notes,
  };
}

function customerFromApi(row: Record<string, unknown>): Customer {
  return {
    id: String(row.id ?? createId()),
    source_person: String(row.source_party ?? row.source_person ?? ""),
    client_name: String(row.name ?? row.client_name ?? ""),
    client_code: String(row.code ?? row.client_code ?? ""),
    phone: String(row.phone ?? ""),
    email: String(row.email ?? ""),
    address: String(row.address ?? ""),
    old_balance: Number(row.old_balance ?? 0),
    notes: String(row.notes ?? ""),
    created_at: String(row.created_at ?? new Date().toISOString()),
  };
}

function customerToApi(customer: Customer) {
  return {
    name: customer.client_name,
    code: customer.client_code,
    phone: customer.phone,
    email: customer.email || "",
    address: customer.address || "",
    source_party: customer.source_person,
    old_balance: customer.old_balance,
    notes: customer.notes || "",
  };
}

function productFromApi(row: Record<string, unknown>): Product {
  return normalizeProduct({
    id: String(row.id ?? createId()),
    name: String(row.product_name ?? row.name ?? ""),
    details: String(row.details ?? ""),
    active: String(row.status ?? "active") !== "inactive",
    status: String(row.status ?? "active") === "inactive" ? "inactive" : "active",
    logoPlacement: String(row.logo_placement ?? ""),
    defaultQuantity: Number(row.default_quantity ?? 1),
    defaultPrice: row.default_price === null || row.default_price === undefined ? null : Number(row.default_price),
    defaultTotal: row.default_total === null || row.default_total === undefined ? null : Number(row.default_total),
    quality: String(row.quality ?? ""),
    productImage: String(row.product_image ?? ""),
    logoImage: String(row.logo_image ?? ""),
    created_at: String(row.created_at ?? new Date().toISOString()),
  });
}

function productToApi(product: Product) {
  const normalized = normalizeProduct(product);
  return {
    productName: normalized.name,
    details: normalized.details,
    logoPlacement: normalized.logoPlacement || "",
    defaultQuantity: normalized.defaultQuantity || 1,
    defaultPrice: normalized.defaultPrice ?? normalized.price ?? null,
    quality: normalized.quality || "",
    status: normalized.status || (normalized.active === false ? "inactive" : "active"),
    productImage: normalized.productImage || "",
    logoImage: normalized.logoImage || "",
  };
}

function useOrders(session: Session | null) {
  const [orders, setLocalOrders] = useState<Order[]>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      const parsed = stored ? JSON.parse(stored) as Order[] : demoOrders;
      return parsed.map((order) => calculate(orderForStorage(order)));
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

  async function refreshOrders() {
    if (!session) return;
    try {
      const result = await backendJson<{ orders: Record<string, unknown>[] }>("/api/orders");
      setLocalOrders(result.orders.map(orderFromApi));
    } catch (error) {
      console.warn("[Zunion] Shared orders fetch failed; keeping local cache.", error);
    }
  }

  useEffect(() => {
    if (!session) return;
    refreshOrders();
    const timer = window.setInterval(refreshOrders, 5000);
    return () => window.clearInterval(timer);
  }, [session?.username, session?.email]);

  const setOrders: React.Dispatch<React.SetStateAction<Order[]>> = (action) => {
    setLocalOrders((current) => {
      const previous = current;
      const next = typeof action === "function" ? (action as (value: Order[]) => Order[])(current) : action;
      if (session) {
        void syncOrders(previous, next).then(refreshOrders).catch((error) => console.warn("[Zunion] Shared orders sync failed.", error));
      }
      return next;
    });
  };

  return { orders, setOrders };
}

async function syncOrders(previous: Order[], next: Order[]) {
  const previousIds = new Set(previous.map((order) => order.id));
  const nextIds = new Set(next.map((order) => order.id));
  const removed = previous.filter((order) => !nextIds.has(order.id));
  const changed = next.filter((order) => {
    const old = previous.find((item) => item.id === order.id);
    return !old || JSON.stringify(orderForStorage(old)) !== JSON.stringify(orderForStorage(order));
  });
  await Promise.all(removed.map((order) => backendJson(`/api/orders/${encodeURIComponent(order.id)}`, { method: "DELETE" }).catch((error) => console.warn("[Zunion] Order delete sync failed.", order.id, error))));
  await Promise.all(changed.map(async (order) => {
    const body = JSON.stringify(orderToApi(order));
    if (previousIds.has(order.id)) {
      try {
        await backendJson(`/api/orders/${encodeURIComponent(order.id)}`, { method: "PUT", body });
        return;
      } catch (error) {
        console.warn("[Zunion] Order update failed; trying create.", error);
      }
    }
    await backendJson("/api/orders", { method: "POST", body });
  }));
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

function useCustomers(session: Session | null) {
  const fallback = useStoredList<Customer>(customersKey, []);
  const [customers, setLocalCustomers] = useState<Customer[]>(fallback.items);

  useEffect(() => {
    setLocalCustomers(fallback.items);
  }, []);

  async function refreshCustomers() {
    if (!session) return;
    try {
      const result = await backendJson<{ customers: Record<string, unknown>[] }>("/api/customers");
      setLocalCustomers(result.customers.map(customerFromApi));
    } catch (error) {
      console.warn("[Zunion] Shared customers fetch failed; keeping local cache.", error);
    }
  }

  useEffect(() => {
    if (!session) return;
    refreshCustomers();
    const timer = window.setInterval(refreshCustomers, 7000);
    return () => window.clearInterval(timer);
  }, [session?.username, session?.email]);

  const setCustomers: React.Dispatch<React.SetStateAction<Customer[]>> = (action) => {
    setLocalCustomers((current) => {
      const previous = current;
      const next = typeof action === "function" ? (action as (value: Customer[]) => Customer[])(current) : action;
      fallback.setItems(next);
      if (session) {
        void syncCustomers(previous, next).then(refreshCustomers).catch((error) => console.warn("[Zunion] Shared customers sync failed.", error));
      }
      return next;
    });
  };

  return { items: customers, setItems: setCustomers };
}

async function syncCustomers(previous: Customer[], next: Customer[]) {
  const previousIds = new Set(previous.map((customer) => customer.id));
  const nextIds = new Set(next.map((customer) => customer.id));
  const removed = previous.filter((customer) => !nextIds.has(customer.id));
  const changed = next.filter((customer) => {
    const old = previous.find((item) => item.id === customer.id);
    return !old || JSON.stringify(old) !== JSON.stringify(customer);
  });
  await Promise.all(removed.map((customer) => backendJson(`/api/customers/${encodeURIComponent(customer.id)}`, { method: "DELETE" }).catch(() => undefined)));
  await Promise.all(changed.map(async (customer) => {
    const body = JSON.stringify(customerToApi(customer));
    if (previousIds.has(customer.id)) {
      try {
        await backendJson(`/api/customers/${encodeURIComponent(customer.id)}`, { method: "PUT", body });
        return;
      } catch (error) {
        console.warn("[Zunion] Customer update failed; trying create.", error);
      }
    }
    await backendJson("/api/customers", { method: "POST", body });
  }));
}

function useProducts(session: Session | null) {
  const fallback = useStoredList<Product>(productsKey, []);
  const [products, setLocalProducts] = useState<Product[]>(fallback.items);

  useEffect(() => {
    setLocalProducts(fallback.items);
  }, []);

  async function refreshProducts() {
    if (!session) return;
    try {
      const result = await backendJson<{ products: Record<string, unknown>[] }>("/api/products");
      setLocalProducts(result.products.map(productFromApi));
    } catch (error) {
      console.warn("[Zunion] Shared products fetch failed; keeping local cache.", error);
    }
  }

  useEffect(() => {
    if (!session) return;
    refreshProducts();
    const timer = window.setInterval(refreshProducts, 7000);
    return () => window.clearInterval(timer);
  }, [session?.username, session?.email]);

  const setProducts: React.Dispatch<React.SetStateAction<Product[]>> = (action) => {
    setLocalProducts((current) => {
      const previous = current;
      const next = typeof action === "function" ? (action as (value: Product[]) => Product[])(current) : action;
      fallback.setItems(next);
      if (session) {
        void syncProducts(previous, next).then(refreshProducts).catch((error) => console.warn("[Zunion] Shared products sync failed.", error));
      }
      return next;
    });
  };

  return { items: products, setItems: setProducts };
}

async function syncProducts(previous: Product[], next: Product[]) {
  const previousIds = new Set(previous.map((product) => product.id));
  const nextIds = new Set(next.map((product) => product.id));
  const removed = previous.filter((product) => !nextIds.has(product.id));
  const changed = next.filter((product) => {
    const old = previous.find((item) => item.id === product.id);
    return !old || JSON.stringify(normalizeProduct(old)) !== JSON.stringify(normalizeProduct(product));
  });
  await Promise.all(removed.map((product) => backendJson(`/api/products/${encodeURIComponent(product.id)}`, { method: "DELETE" }).catch(() => undefined)));
  await Promise.all(changed.map(async (product) => {
    const body = JSON.stringify(productToApi(product));
    if (previousIds.has(product.id)) {
      try {
        await backendJson(`/api/products/${encodeURIComponent(product.id)}`, { method: "PUT", body });
        return;
      } catch (error) {
        console.warn("[Zunion] Product update failed; trying create.", error);
      }
    }
    await backendJson("/api/products", { method: "POST", body });
  }));
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
  if (role === "Operator") return !order || ["new", "operation"].includes(order.workStage);
  if (role === "Supervisor") return Boolean(order && order.workStage === "operation");
  if (role === "Finishing") return Boolean(order && ["finishing", "completed"].includes(order.workStage));
  if (role === "Helper") return !order || ["new", "operation"].includes(order.workStage);
  return false;
}

function canDeleteOrder(role: Role) {
  return role === "Master";
}

function roleOrders(role: Role, orders: Order[]) {
  if (role === "Operator" || role === "Supervisor" || role === "Worker") return orders.filter((order) => order.workStage === "operation");
  if (role === "Finishing" || role === "Finish") return orders.filter((order) => order.workStage === "finishing");
  return orders;
}

const useServerAuth = import.meta.env.VITE_USE_SERVER_AUTH === "true";
const isLocalHost = ["localhost", "127.0.0.1"].includes(window.location.hostname);

function apiErrorMessage(payload: Record<string, unknown>, fallback: string) {
  return String(payload.error || payload.message || payload.details || fallback);
}

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
        if (!response.ok) throw new Error(apiErrorMessage(payload, "اسم المستخدم أو كلمة المرور غير صحيحة."));
        const session = { ...(payload.session as Session), mustChangePassword: false };
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
    if (!user || user.status === "inactive" || user.password !== password) return setMessage("اسم المستخدم أو كلمة المرور غير صحيحة.");
    const expiresAt = new Date(Date.now() + (stayLoggedIn ? 14 * 24 : 8) * 60 * 60 * 1000).toISOString();
    const session = { email: user.email, username: normalizedUsername, fullName: user.fullName, role: user.role, loggedInAt: new Date().toISOString(), expiresAt, mustChangePassword: false };
    localStorage.setItem(sessionKey, JSON.stringify(session));
    saveManagedUsers(loadManagedUsers().map((item) => item.username === normalizedUsername ? { ...item, lastLoginAt: new Date().toISOString() } : item));
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
        if (!response.ok) throw new Error(apiErrorMessage(payload, "تعذر إرسال كود التحقق حالياً"));
        setIssuedPasswordCode("");
        setMessage(payload.devCode ? `كود التحقق التجريبي: ${payload.devCode}` : "تم إرسال كود التحقق إلى البريد المسؤول.");
        return;
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "تعذر إرسال كود التحقق حالياً");
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
        if (!response.ok) throw new Error(apiErrorMessage(payload, "تعذر تغيير كلمة المرور حالياً. حاول مرة أخرى"));
        setPassword(newPassword);
        setOldPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setVerificationCode("");
        setChangeMode(false);
        setMessage("تم تغيير كلمة المرور بنجاح. يمكنك تسجيل الدخول الآن.");
        return;
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "تعذر الاتصال بالخادم. حاول مرة أخرى");
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

function OptionalPasswordChangePanel({ session, onChanged }: { session: Session; onChanged?: (session: Session) => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const username = session.username || "";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (newPassword.trim() !== newPassword || newPassword.trim().length < 4) return setMessage("كلمة المرور الجديدة يجب أن تكون 4 أحرف على الأقل");
    if (newPassword !== confirmPassword) return setMessage("كلمتا المرور غير متطابقتين");

    if (useServerAuth || !isLocalHost) {
      try {
        const response = await fetch("/api/auth/mandatory-change-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(apiErrorMessage(payload, "تعذر تغيير كلمة المرور حالياً. حاول مرة أخرى"));
        const nextSession = { ...(payload.session as Session), mustChangePassword: false };
        localStorage.setItem(sessionKey, JSON.stringify(nextSession));
        onChanged?.(nextSession);
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setMessage("تم تغيير كلمة المرور بنجاح");
        return;
      } catch (error) {
        return setMessage(error instanceof Error ? error.message : "تعذر الاتصال بالخادم. حاول مرة أخرى");
      }
    }

    const user = getLocalUser(username);
    if (!user || user.password !== currentPassword) return setMessage("كلمة المرور الحالية غير صحيحة");
    saveLocalPassword(username, newPassword);
    const nextSession = { ...session, mustChangePassword: false };
    localStorage.setItem(sessionKey, JSON.stringify(nextSession));
    addAudit(nextSession, "PASSWORD_CHANGED", "auth", username, undefined, { username });
    onChanged?.(nextSession);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setMessage("تم تغيير كلمة المرور بنجاح");
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>تغيير كلمة المرور</h2>
        <span className="badge badge-gray">اختياري</span>
      </div>
      <form className="settings-form" onSubmit={submit}>
        <label>كلمة المرور الحالية</label>
        <input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" />
        <label>كلمة المرور الجديدة</label>
        <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" />
        <label>تأكيد كلمة المرور الجديدة</label>
        <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" />
        {message && <div className="notice">{message}</div>}
        <button className="primary-btn">تغيير كلمة المرور</button>
      </form>
    </section>
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

type OrdersListRecord = Partial<Record<keyof Order | keyof DbOrder | "added_by" | "username" | "user_email" | "product_name_snapshot" | "message_text", unknown>>;

const ordersListHeaders = [
  "اكتب بواسطة",
  "تاريخ التسليم",
  "رقم الأوردر",
  "اسم العميل",
  "النوع",
  "اللوجو",
  "العدد",
  "حالة التشغيل",
  "حالة التشطيب",
  "شغل جاهز",
  "رسالة العميل",
] as const;

function valueText(value: unknown, fallback = "—") {
  const text = normalizeDigitsToEnglish(value).trim();
  return text || fallback;
}

function orderCreatedBy(order: OrdersListRecord) {
  return valueText(order.created_by || order.added_by || order.username || order.user_email);
}

function orderDisplayNumber(order: OrdersListRecord) {
  return valueText(order.order_number);
}

function orderDisplayClient(order: OrdersListRecord) {
  return valueText(order.client_name || order.customer_name);
}

function orderDisplayType(order: OrdersListRecord) {
  return valueText(order.productName || order.product_name_snapshot || order.order_type || order.service_type);
}

function orderDisplayLogo(order: OrdersListRecord) {
  return valueText(order.logo_place || order.logo_status);
}

function orderDisplayQuantity(order: OrdersListRecord) {
  return formatNumber(Number(order.quantity ?? order.pieces_count ?? 0));
}

function normalizedOperationStatus(value: unknown) {
  const text = String(value ?? "").trim();
  if (["تم", "تم التشغيل", "مكتمل", "completed", "done", "WORKER_DONE"].includes(text)) return "تم";
  if (["جاري التشغيل", "قيد التشغيل", "بدأ التشغيل", "في التشغيل", "operation", "WORKER_STARTED", "SENT_TO_WORKER"].includes(text)) return "جاري التشغيل";
  return "لم يبدأ";
}

function normalizedFinishingStatus(value: unknown) {
  const text = String(value ?? "").trim();
  if (["تم", "تم التشطيب", "مكتمل", "completed", "done", "FINISH_DONE"].includes(text)) return "تم";
  if (["جاري التشطيب", "قيد التشطيب", "بدأ التشطيب", "في التشطيب", "finishing", "FINISH_STARTED", "SENT_TO_FINISH"].includes(text)) return "جاري التشطيب";
  return "لم يبدأ";
}

function orderReadyStatus(order: OrdersListRecord) {
  const text = String(order.delivery_status || order.order_status || order.workStage || order.work_stage || "").trim();
  return ["جاهز", "جاهز للإرسال", "تم التسليم", "completed", "READY", "DELIVERED"].includes(text) ? "جاهز" : "غير جاهز";
}

function listBadgeClass(value: string) {
  if (value === "تم" || value === "جاهز") return "badge badge-green";
  if (value === "جاري التشغيل" || value === "جاري التشطيب") return "badge badge-amber";
  if (value === "غير جاهز") return "badge badge-red";
  return "badge badge-gray";
}

function ordersListPrintRow(order: OrdersListRecord) {
  return [
    orderCreatedBy(order),
    formatDateArabic(String(order.delivery_date || "")),
    orderDisplayNumber(order),
    orderDisplayClient(order),
    orderDisplayType(order),
    orderDisplayLogo(order),
    orderDisplayQuantity(order),
    normalizedOperationStatus(order.operation_status),
    normalizedFinishingStatus(order.finishing_status),
    orderReadyStatus(order),
    valueText(order.client_message || order.message_text),
  ];
}

function OrdersListRow({ order }: { order: OrdersListRecord }) {
  const operationStatus = normalizedOperationStatus(order.operation_status);
  const finishingStatus = normalizedFinishingStatus(order.finishing_status);
  const readyStatus = orderReadyStatus(order);
  const createdBy = orderCreatedBy(order);
  return (
    <tr>
      <td className={isEmailValue(createdBy) ? "email-cell" : undefined}>{isEmailValue(createdBy) ? <EmailText email={createdBy} /> : createdBy}</td>
      <td>{formatDateArabic(String(order.delivery_date || ""))}</td>
      <td>{orderDisplayNumber(order)}</td>
      <td>{orderDisplayClient(order)}</td>
      <td>{orderDisplayType(order)}</td>
      <td>{orderDisplayLogo(order)}</td>
      <td>{orderDisplayQuantity(order)}</td>
      <td><span className={listBadgeClass(operationStatus)}>{operationStatus}</span></td>
      <td><span className={listBadgeClass(finishingStatus)}>{finishingStatus}</span></td>
      <td><span className={listBadgeClass(readyStatus)}>{readyStatus}</span></td>
      <td>{valueText(order.client_message || order.message_text)}</td>
    </tr>
  );
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

function OrderForm({ initial, orderNumber, customers = [], products = [], canAddProduct = false, onAddProduct, onCancel, onSave }: { initial?: Order; orderNumber?: string; customers?: Customer[]; products?: Product[]; canAddProduct?: boolean; onAddProduct?: () => void; onCancel?: () => void; onSave: (order: Order) => void }) {
  const [form, setForm] = useState<Order>(() => initial ?? { ...emptyOrder, id: createId(), order_number: orderNumber || String(Date.now()).slice(-6) });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [activeImageField, setActiveImageField] = useState<{ index: number; key: "logoImage" | "workOrderImage" } | null>(null);
  const [imageMessages, setImageMessages] = useState<Record<string, string>>({});
  const computed = calculate(form);
  const normalizedProducts = products.map(normalizeProduct);
  const activeProducts = normalizedProducts.filter((product) => product.status === "active");
  const selectedProduct = normalizedProducts.find((product) => product.id === form.productId);
  const visibleProducts = activeProducts.filter((product) => `${product.name} ${product.details}`.toLowerCase().includes(productSearch.trim().toLowerCase()));
  const operationItems: OperationItem[] = form.operationItems?.length
    ? form.operationItems
    : (form.operationMethods?.length ? form.operationMethods : [""]).map((method, index) => ({
      method,
      logoImage: index === 0 ? form.logo_image_url : "",
      logoFileName: index === 0 ? form.logoFileName : "",
      workOrderImage: index === 0 ? form.work_order_image_url : "",
      workOrderFileName: index === 0 ? form.workOrderFileName : "",
    }));

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

  function selectCustomer(value: string) {
    const existing = customers.find((customer) => customer.id === value);
    if (!existing) {
      setClientName(value);
      return;
    }
    setForm((current) => calculate({
      ...current,
      client_name: existing.client_name,
      client_code: existing.client_code,
      phone: existing.phone,
      source_person: existing.source_person || current.source_person,
      old_balance: existing.old_balance || current.old_balance,
      updated_at: new Date().toISOString(),
    }));
  }

  function selectProduct(productId: string) {
    const product = activeProducts.find((item) => item.id === productId);
    if (!product) {
      set("productId", "");
      set("productName", "");
      set("order_type", "");
      return;
    }
    setForm((current) => {
      const nextMethods = current.operationMethods?.some((method) => method.trim())
        ? current.operationMethods
        : (product.logoPlacement ? [product.logoPlacement] : (product.operationMethods?.length ? product.operationMethods : current.operationMethods));
      const nextOperationItems = nextMethods?.length
        ? nextMethods.map((method, index) => current.operationItems?.[index] ? { ...current.operationItems[index], method } : { method, logoImage: "", workOrderImage: "" })
        : [{ method: "", logoImage: "", workOrderImage: "" }];
      return calculate({
        ...current,
        productId: product.id,
        productName: product.name,
        order_type: product.name,
        quantity: current.quantity && current.quantity !== 1 ? current.quantity : product.defaultQuantity || 1,
        price: current.price,
        logo_place: current.logo_place || product.logoPlacement || "",
        quality_notes: current.quality_notes || product.quality || "",
        operationMethods: nextMethods?.length ? nextMethods : [""],
        operationItems: nextOperationItems,
        updated_at: new Date().toISOString(),
      });
    });
  }

  function syncOperationItems(items: OperationItem[]) {
    const normalized = items.length ? items : [{ method: "", logoImage: "", workOrderImage: "" }];
    setForm((current) => calculate({
      ...current,
      operationItems: normalized,
      operationMethods: normalized.map((item) => item.method),
      logo_image_url: normalized[0]?.logoImage || "",
      logoFileName: normalized[0]?.logoFileName || "",
      work_order_image_url: normalized[0]?.workOrderImage || "",
      workOrderFileName: normalized[0]?.workOrderFileName || "",
      updated_at: new Date().toISOString(),
    }));
  }

  function updateOperationItem(index: number, patch: Partial<OperationItem>) {
    syncOperationItems(operationItems.map((item, currentIndex) => currentIndex === index ? { ...item, ...patch } : item));
  }

  function addOperationItem() {
    syncOperationItems([...operationItems, { method: "", logoImage: "", workOrderImage: "" }]);
  }

  function removeOperationItem(index: number) {
    if (operationItems.length === 1) return;
    syncOperationItems(operationItems.filter((_, currentIndex) => currentIndex !== index));
  }

  function operationMessageKey(index: number, key: "logoImage" | "workOrderImage") {
    return `${index}-${key}`;
  }

  function setImageMessage(index: number, key: "logoImage" | "workOrderImage", message: string) {
    setImageMessages((current) => ({ ...current, [operationMessageKey(index, key)]: message }));
  }

  async function setOperationAttachment(index: number, key: "logoImage" | "workOrderImage", file: File | undefined) {
    if (!file) return;
    if (!file.size) {
      setImageMessage(index, key, "ملف الصورة فارغ");
      return;
    }
    if (!clipboardImageTypes.includes(file.type)) {
      setImageMessage(index, key, "نوع الصورة غير مدعوم");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setImageMessage(index, key, "حجم الملف أكبر من 10MB.");
      return;
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      updateOperationItem(index, {
        [key]: dataUrl,
        [key === "logoImage" ? "logoFileName" : "workOrderFileName"]: file.name,
        [key === "logoImage" ? "logoImageSource" : "workOrderImageSource"]: "clipboard",
        [key === "logoImage" ? "logoImageSize" : "workOrderImageSize"]: file.size,
      } as Partial<OperationItem>);
      setImageMessage(index, key, "تم لصق الصورة بنجاح");
    } catch {
      setImageMessage(index, key, "حدث خطأ أثناء لصق الصورة");
    }
  }

  function removeOperationAttachment(index: number, key: "logoImage" | "workOrderImage") {
    updateOperationItem(index, key === "logoImage"
      ? { logoImage: "", logoFileName: "", logoImageSource: undefined, logoImageSize: undefined }
      : { workOrderImage: "", workOrderFileName: "", workOrderImageSource: undefined, workOrderImageSize: undefined });
    setImageMessage(index, key, "");
  }

  async function pasteFromClipboard(index: number, key: "logoImage" | "workOrderImage") {
    setActiveImageField({ index, key });
    try {
      await setOperationAttachment(index, key, await readClipboardImageFile());
    } catch (error) {
      setImageMessage(index, key, error instanceof Error ? error.message : "حدث خطأ أثناء لصق الصورة");
    }
  }

  function handleClipboardPaste(event: React.ClipboardEvent<HTMLFormElement>) {
    if (!(event.target instanceof Element) || !event.target.closest(".image-clipboard-field")) return;
    if (!activeImageField) {
      alert("اختر مكان الصورة أولاً");
      return;
    }
    const item = Array.from(event.clipboardData.items).find((clipboardItem) => clipboardItem.type.startsWith("image/"));
    event.preventDefault();
    if (!item) {
      setImageMessage(activeImageField.index, activeImageField.key, "لا توجد صورة في الحافظة");
      return;
    }
    if (!clipboardImageTypes.includes(item.type)) {
      setImageMessage(activeImageField.index, activeImageField.key, "نوع الصورة غير مدعوم");
      return;
    }
    const file = item.getAsFile();
    if (!file) {
      setImageMessage(activeImageField.index, activeImageField.key, "حدث خطأ أثناء لصق الصورة");
      return;
    }
    setOperationAttachment(activeImageField.index, activeImageField.key, new File([file], safeClipboardFileName(file.type), { type: file.type }));
  }

  function addItem() {
    const item: OrderItem = { id: createId(), product_name: "", details: "", product_image_url: "", logo_url: "", logo_place: "", quantity: 1, price: 0, total: 0, quality: "", status: "جديد" };
    set("items", [...form.items, item]);
  }

  function updateItem(id: string, patch: Partial<OrderItem>) {
    set("items", form.items.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    const nextErrors: Record<string, string> = {};
    const normalizedOperationItems = operationItems.map((item) => ({ ...item, method: item.method.trim() }));
    const methods = normalizedOperationItems.map((item) => item.method).filter(Boolean);
    const total = Number(form.quantity || 0) * Number(form.price || 0);
    const paid = Number(form.paid || 0);
    if (!form.order_number.trim()) nextErrors.order_number = "رقم الأوردر مطلوب";
    if (!form.client_name.trim()) nextErrors.client_name = "اسم العميل مطلوب";
    if (!form.source_person.trim()) nextErrors.source_person = "الطرف مطلوب";
    if (!form.productId && !form.productName && !form.order_type) nextErrors.productId = "يجب اختيار نوع المنتج";
    if (Number(form.quantity || 0) < 1) nextErrors.quantity = "العدد يجب أن يكون 1 على الأقل";
    if (Number(form.price || 0) < 0) nextErrors.price = "السعر لا يمكن أن يكون بالسالب";
    if (paid < 0) nextErrors.paid = "المدفوع لا يمكن أن يكون بالسالب";
    if (paid > total) nextErrors.paid = "المدفوع لا يمكن أن يكون أكبر من الإجمالي";
    if (!form.paymentMethod) nextErrors.paymentMethod = "طريقة الدفع مطلوبة";
    if (form.paymentMethod === "other" && !form.customPaymentMethod?.trim()) nextErrors.customPaymentMethod = "اكتب طريقة الدفع";
    if (!normalizeMaterialsStatus(form.materialsStatus)) nextErrors.materialsStatus = "يجب تحديد حالة الخامات";
    if (!form.delivery_date) nextErrors.delivery_date = "تاريخ التسليم مطلوب";
    if (methods.length === 0) nextErrors.operationMethods = "يجب إضافة طريقة تشغيل واحدة على الأقل";
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }
    setErrors({});
    setSaving(true);
    const now = new Date().toISOString();
    const selectedName = selectedProduct?.name || form.productName || form.order_type;
    onSave(calculate({
      ...computed,
      productId: form.productId,
      productName: selectedName,
      order_type: selectedName,
      materialsStatus: normalizeMaterialsStatus(form.materialsStatus),
      client_code: computed.client_code || nextCustomerCode(customers, computed.source_person || partyOptions[0]),
      operationMethods: methods,
      operationItems: normalizedOperationItems.filter((item) => item.method || item.logoImage || item.workOrderImage),
      workStage: initial ? form.workStage : "operation",
      workflow_stage: initial ? stageLabel(form.workStage) as WorkflowStage : "التشغيل",
      order_status: initial ? form.order_status : "في التشغيل",
      operation_status: initial ? form.operation_status : "not_started",
      finishing_status: initial ? form.finishing_status : "not_started",
      created_at: computed.created_at || now,
      updated_at: now,
    }));
    window.setTimeout(() => setSaving(false), 300);
  }

  return (
    <form className="panel order-form" onSubmit={submit} onPaste={handleClipboardPaste}>
      <div className="panel-head">
        <h2>{initial ? "تعديل أوردر" : "إضافة أوردر جديد"}</h2>
        {onCancel && <button type="button" className="ghost-btn compact" onClick={onCancel}>إلغاء</button>}
      </div>
      <section className="form-section">
        <h3>بيانات الأوردر</h3>
        <div className="order-basic-row">
          <label>رقم الأوردر<input value={form.order_number} readOnly /></label>
          <label>
            طرف
            <select value={partyOptions.includes(form.source_person) ? form.source_person : "other"} onChange={(event) => {
              if (event.target.value === "other") {
                setForm((current) => calculate({ ...current, source_person: current.customParty || "", customParty: current.customParty || "", updated_at: new Date().toISOString() }));
              } else {
                setForm((current) => calculate({ ...current, source_person: event.target.value, customParty: "", updated_at: new Date().toISOString() }));
              }
            }}>
              {partyOptions.filter((option) => option !== "أخرى").map((option) => <option key={option} value={option}>{option}</option>)}
              <option value="other">أخرى</option>
            </select>
            {!partyOptions.includes(form.source_person) && <input placeholder="اكتب الطرف" value={form.customParty || form.source_person} onChange={(event) => setForm((current) => calculate({ ...current, source_person: event.target.value, customParty: event.target.value, updated_at: new Date().toISOString() }))} />}
            <ErrorText message={errors.source_person} />
          </label>
          <label>
            اسم العميل
            <input list="zunion-customers" value={form.client_name} onChange={(event) => selectCustomer(event.target.value)} />
            <datalist id="zunion-customers">{customers.map((customer) => <option key={customer.id} value={customer.client_name} />)}</datalist>
            <ErrorText message={errors.client_name} />
          </label>
          <ReadonlyText label="كود العميل" value={form.client_code || nextCustomerCode(customers, form.source_person || partyOptions[0])} />
          <RedDatePicker label="تاريخ التسليم" value={form.delivery_date} onChange={(value) => set("delivery_date", value)} error={errors.delivery_date} />
        </div>
      </section>
      <section className="form-section">
        <h3>بيانات المنتج والحساب</h3>
        <div className="order-finance-row">
          <label>
            نوع المنتج
            <select value={form.productId || ""} onChange={(event) => selectProduct(event.target.value)}>
              <option value="">{activeProducts.length ? "اختر نوع المنتج" : "لا توجد منتجات مضافة"}</option>
              {visibleProducts.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
              {selectedProduct && selectedProduct.active !== false && !visibleProducts.some((product) => product.id === selectedProduct.id) && <option value={selectedProduct.id}>{selectedProduct.name}</option>}
              {selectedProduct && selectedProduct.active === false && <option value={selectedProduct.id}>{selectedProduct.name}</option>}
            </select>
            {canAddProduct && <button type="button" className="ghost-btn compact add-product-inline" onClick={onAddProduct}>إضافة منتج جديد</button>}
            <ErrorText message={errors.productId} />
          </label>
          <label>العدد<input type="number" min={1} value={form.quantity} onChange={(event) => set("quantity", Number(event.target.value))} /><ErrorText message={errors.quantity} /></label>
          <label>السعر<input type="number" min={0} step="0.01" value={form.price} onChange={(event) => set("price", Number(event.target.value))} /><ErrorText message={errors.price} /></label>
          <Readonly label="الإجمالي" value={computed.total} />
          <label>المدفوع<input type="number" min={0} step="0.01" value={form.paid} onChange={(event) => set("paid", Number(event.target.value))} /><ErrorText message={errors.paid} /></label>
          <label>
            طريقة الدفع
            <select value={form.paymentMethod || ""} onChange={(event) => set("paymentMethod", event.target.value)}>
              {paymentMethods.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}
            </select>
            <ErrorText message={errors.paymentMethod} />
          </label>
          {form.paymentMethod === "other" && <label>اكتب طريقة الدفع<input value={form.customPaymentMethod || ""} onChange={(event) => set("customPaymentMethod", event.target.value)} /><ErrorText message={errors.customPaymentMethod} /></label>}
          <Readonly label="المتبقي" value={computed.remaining} />
          <label>
            الخامات
            <select value={normalizeMaterialsStatus(form.materialsStatus)} onChange={(event) => set("materialsStatus", event.target.value)}>
              <option value="">اختر حالة الخامات</option>
              {materialStatusOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <ErrorText message={errors.materialsStatus} />
          </label>
        </div>
      </section>
      <section className="form-section order-operation-section">
        <h3>طريقة التشغيل</h3>
        <div className="operation-methods">
          {operationItems.map((item, index) => (
            <div className="operation-item-row" key={index}>
              <label>
                طريقة التشغيل
                <input value={item.method} onChange={(event) => updateOperationItem(index, { method: event.target.value })} placeholder={index === 0 ? "صدر شمال" : "ظهر"} />
              </label>
              <button type="button" className="primary-btn compact operation-add-btn" onClick={addOperationItem}>+</button>
              <ImageInputWithClipboard
                label="رفع صورة اللوجو"
                value={item.logoImage}
                fileName={item.logoFileName}
                fileSize={item.logoImageSize}
                source={item.logoImageSource}
                active={activeImageField?.index === index && activeImageField.key === "logoImage"}
                status={imageMessages[operationMessageKey(index, "logoImage")]}
                onActivate={() => setActiveImageField({ index, key: "logoImage" })}
                onPaste={() => pasteFromClipboard(index, "logoImage")}
                onRemove={() => removeOperationAttachment(index, "logoImage")}
              />
              <ImageInputWithClipboard
                label="رفع صورة أمر الشغل"
                value={item.workOrderImage}
                fileName={item.workOrderFileName}
                fileSize={item.workOrderImageSize}
                source={item.workOrderImageSource}
                active={activeImageField?.index === index && activeImageField.key === "workOrderImage"}
                status={imageMessages[operationMessageKey(index, "workOrderImage")]}
                onActivate={() => setActiveImageField({ index, key: "workOrderImage" })}
                onPaste={() => pasteFromClipboard(index, "workOrderImage")}
                onRemove={() => removeOperationAttachment(index, "workOrderImage")}
              />
              {operationItems.length > 1 && <button type="button" className="ghost-btn compact operation-delete-btn" onClick={() => removeOperationItem(index)}>حذف</button>}
            </div>
          ))}
        </div>
        <ErrorText message={errors.operationMethods} />
      </section>
      <div className="form-grid" hidden>
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
        <StageSelect label="مرحلة الشغل" value={form.workStage} onChange={(value) => set("workStage", value)} />
        <Select label="الحالة" value={form.order_status} options={statuses} onChange={(value) => set("order_status", value as OrderStatus)} />
        <Field label="التشغيل" value={form.operation_status} onChange={(value) => set("operation_status", value)} />
        <Field label="التشطيب" value={form.finishing_status} onChange={(value) => set("finishing_status", value)} />
        <Field label="قطعة مقطوعة" type="number" value={form.damaged_pieces} onChange={(value) => set("damaged_pieces", Number(value))} />
      </div>
      <section className="line-items" hidden>
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
            <button type="button" className="danger-text line-remove" onClick={() => set("items", form.items.filter((current) => current.id !== item.id))}>حذف المنتج</button>
          </div>
        ))}
      </section>
      <div className="form-grid two" hidden>
        <Textarea label="الجودة" value={form.quality_notes} onChange={(value) => set("quality_notes", value)} />
        <Textarea label="ملاحظات التشغيل" value={form.production_notes} onChange={(value) => set("production_notes", value)} />
        <Textarea label="ملاحظات التشطيب" value={form.finishing_notes} onChange={(value) => set("finishing_notes", value)} />
        <Textarea label="رسالة العميل" value={form.client_message} onChange={(value) => set("client_message", value)} />
        <Textarea label="ملاحظات" value={form.notes} onChange={(value) => set("notes", value)} />
        <Textarea label="ملاحظات داخلية" value={form.internal_notes} onChange={(value) => set("internal_notes", value)} />
      </div>
      <button className="primary-btn" disabled={saving}>{saving ? "جاري الحفظ..." : "حفظ الأوردر"}</button>
    </form>
  );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string | number; onChange: (value: string) => void; type?: string }) {
  const normalizedValue = normalizeDigitsToEnglish(value);
  const className = type === "date" ? `date-input ${normalizedValue ? "has-value" : "empty"}` : undefined;
  return <label>{label}<input className={className} type={type} value={normalizedValue} onChange={(event) => onChange(normalizeDigitsToEnglish(event.target.value))} /></label>;
}

function ErrorText({ message }: { message?: string }) {
  return message ? <small className="field-error">{message}</small> : null;
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
  return <label>{label}<input value={formatNumber(value)} readOnly /></label>;
}

function ReadonlyText({ label, value }: { label: string; value: string }) {
  return <label>{label}<input value={normalizeDigitsToEnglish(value)} readOnly /></label>;
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <label>{label}<select value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option}>{option}</option>)}</select></label>;
}

function compactDateValue(value: string) {
  if (!value) return "";
  const [year, month, day] = normalizeDigitsToEnglish(value).split("-");
  if (!year || !month || !day) return normalizeDigitsToEnglish(value);
  return `${year}-${Number(month)}-${Number(day)}`;
}

function StageSelect({ label, value, onChange }: { label: string; value: WorkStage; onChange: (value: WorkStage) => void }) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value as WorkStage)}>
        {workStageOptions.map((stage) => <option key={stage} value={stage}>{stageLabel(stage)}</option>)}
      </select>
    </label>
  );
}

function RedDatePicker({ label, value, onChange, error }: { label: string; value: string; onChange: (value: string) => void; error?: string }) {
  const displayValue = compactDateValue(value);
  return (
    <label className="red-date-picker">
      <span>{label}</span>
      <span className="delivery-date-field">
        <input className="delivery-date-input" type="date" value={value} onChange={(event) => onChange(normalizeDigitsToEnglish(event.target.value))} aria-label={label} />
        <span className={`delivery-date-display${displayValue ? " has-value" : ""}`} aria-hidden="true">{displayValue || "mm/dd/yyyy"}</span>
      </span>
      <ErrorText message={error} />
    </label>
  );
}

type ImageInputWithClipboardProps = {
  label: string;
  value: string;
  fileName?: string;
  fileSize?: number;
  source?: "upload" | "clipboard";
  active?: boolean;
  status?: string;
  onActivate: () => void;
  onPaste: () => void;
  onRemove: () => void;
};

function formatFileSize(size?: number) {
  if (!size) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function ImageInputWithClipboard({ label, value, fileName, fileSize, source, active, status, onActivate, onPaste, onRemove }: ImageInputWithClipboardProps) {
  return (
    <div className={`image-clipboard-field${active ? " active" : ""}`} tabIndex={0} onFocus={onActivate} onClick={onActivate}>
      <span className="image-field-label">{label}</span>
      <div className="image-field-actions">
        <button type="button" className="ghost-btn compact image-paste-btn" aria-label={`لصق ${label} من الحافظة`} onClick={onPaste}>لصق الصورة من الحافظة</button>
        {!value && <span className="image-empty-state">لم يتم لصق صورة</span>}
        {value && <button type="button" className="ghost-btn compact" aria-label={`حذف ${label}`} onClick={onRemove}>حذف الصورة</button>}
      </div>
      {value && (
        <div className="image-preview-box">
          <a href={value} target="_blank" aria-label={`معاينة ${label}`}><img className="upload-preview" src={value} alt={`معاينة ${label}`} /></a>
        </div>
      )}
      <div className="image-file-meta">
        {fileName && <span>{source === "clipboard" ? `تم لصق الصورة بنجاح - ${fileName}` : fileName}</span>}
        {fileSize ? <small>{formatFileSize(fileSize)}</small> : null}
        {status && <small>{status}</small>}
      </div>
    </div>
  );
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
  const [dateSort, setDateSort] = useState<"none" | "asc" | "desc">("none");
  const canPrintOrders = hasPermission(session, queue === "worker" ? "operation.print" : queue === "finish" ? "finishing.print" : "orders.print");

  function renderOrdersListHeaders() {
    return ordersListHeaders.map((head) => (
      <th key={head}>
        {head === "تاريخ التسليم" ? (
          <button
            type="button"
            className="table-sort-button"
            onClick={() => setDateSort((current) => current === "asc" ? "desc" : "asc")}
          >
            {head}{dateSort === "asc" ? " ↑" : dateSort === "desc" ? " ↓" : ""}
          </button>
        ) : head}
      </th>
    ));
  }

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

  if (queue && remoteOps && remoteOps.orders.length > 0 && orders.length === 0) {
    if (remoteLoading) return <LoadingPanel />;
    if (remoteError || !remoteOps) return <ErrorPanel message={remoteError || "تعذر تحميل البيانات."} />;
    const filteredRemote = remoteOps.orders.filter((order) => {
      const text = `${order.order_number || ""} ${orderClientName(order)} ${order.phone || ""} ${order.service_type || order.order_type || ""} ${orderCreatedBy(order)}`.toLowerCase();
      return (!query || text.includes(query.toLowerCase()))
        && (!status || [order.operation_status, order.finishing_status, order.delivery_status].includes(status))
        && (!date || order.delivery_date === date);
    });
    const sortedRemote = dateSort === "none" ? filteredRemote : [...filteredRemote].sort((a, b) => {
      const first = new Date(String(a.delivery_date || "")).getTime() || 0;
      const second = new Date(String(b.delivery_date || "")).getTime() || 0;
      return dateSort === "asc" ? first - second : second - first;
    });
    const pagesRemote = Math.max(1, Math.ceil(sortedRemote.length / 8));
    const visibleRemote = sortedRemote.slice((page - 1) * 8, page * 8);
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
        <section className="table-wrap accounts-table orders-list-table-wrap"><table className="orders-list-table"><thead><tr>{renderOrdersListHeaders()}</tr></thead><tbody>
          {visibleRemote.length === 0 && <EmptyRow colSpan={ordersListHeaders.length} />}
          {visibleRemote.map((order) => <OrdersListRow key={order.id} order={order} />)}
        </tbody></table></section>
        <div className="pagination"><button disabled={page === 1} onClick={() => setPage((value) => value - 1)}>السابق</button><span>{page} / {pagesRemote}</span><button disabled={page === pagesRemote} onClick={() => setPage((value) => value + 1)}>التالي</button></div>
      </div>
    );
  }

  const baseOrders = useMemo(() => {
    if (queue === "worker") return orders.filter((order) => order.workStage === "operation");
    if (queue === "finish") return orders.filter((order) => order.workStage === "finishing");
    return roleOrders(session.role, orders);
  }, [orders, queue, session.role]);

  const filtered = useMemo(() => {
    const rows = baseOrders.filter((order) => {
    const products = [order.order_type, ...(order.items || []).map((item) => `${item.product_name} ${item.details}`)].join(" ");
    const text = `${order.order_number} ${order.client_name} ${order.client_code} ${order.phone} ${order.source_person} ${order.created_by} ${products}`.toLowerCase();
    return (!query || text.includes(query.toLowerCase()))
      && (!status || order.order_status === status)
      && (!date || order.delivery_date === date)
      && (!source || order.source_person === source)
      && (!qualityOnly || Boolean(order.quality_notes.trim()) || order.order_status === "مشكلة جودة");
    });
    if (dateSort === "none") return rows;
    return [...rows].sort((a, b) => {
      const first = new Date(a.delivery_date || "").getTime() || 0;
      const second = new Date(b.delivery_date || "").getTime() || 0;
      return dateSort === "asc" ? first - second : second - first;
    });
  }, [baseOrders, query, status, date, source, qualityOnly, dateSort]);

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
    const nextStage = ["مشكلة جودة", "متأخر"].includes(orderStatus) ? order.workStage : normalizeWorkStage(orderStatus);
    const next = calculate({ ...order, workStage: nextStage, order_status: orderStatus, updated_at: new Date().toISOString() });
    setOrders((current) => current.map((item) => item.id === order.id ? next : item));
    addAudit(session, "STATUS_CHANGED", "orders", order.id, { order_status: order.order_status, workStage: order.workStage }, { order_status: orderStatus, workStage: next.workStage });
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

  function printAllOrders() {
    addAudit(session, "ORDERS_PRINTED", "orders", undefined, undefined, { count: filtered.length });
    printDocument("طباعة كل الأوردرات", printableTable([...ordersListHeaders], filtered.map(ordersListPrintRow)), session, "landscape");
  }

  return (
    <div className="stack">
      {editing && <OrderForm initial={editing} onSave={save} onCancel={() => setEditing(null)} />}
      <section className="panel">
        <div className="panel-head"><h2>متابعة الأوردرات</h2>{canPrintOrders && <button className="ghost-btn compact" type="button" onClick={printAllOrders}>طباعة الكل</button>}</div>
        <div className="filters">
          <input placeholder="بحث بالهاتف / رقم الأوردر / اسم العميل" value={query} onChange={(event) => setQuery(event.target.value)} />
          <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">كل الحالات</option>{statuses.map((item) => <option key={item}>{item}</option>)}</select>
          <input className={`date-input ${date ? "has-value" : "empty"}`} type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          <select value={source} onChange={(event) => setSource(event.target.value)}><option value="">كل الأطراف</option>{sources.map((item) => <option key={item}>{item}</option>)}</select>
          <label className="check"><input type="checkbox" checked={qualityOnly} onChange={(event) => setQualityOnly(event.target.checked)} /> مشاكل جودة</label>
        </div>
      </section>
      <section className="table-wrap orders-list-table-wrap">
        <table className="orders-list-table">
          <thead>
            <tr>{renderOrdersListHeaders()}</tr>
          </thead>
          <tbody>
            {visible.length === 0 && <EmptyRow colSpan={ordersListHeaders.length} />}
            {visible.map((order) => <OrdersListRow key={order.id} order={order} />)}
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
  const canPrintCustomers = hasPermission(session, "customers.print");
  const customers = useMemo(() => {
    const grouped = new Map<string, { name: string; code: string; phone: string; email: string; address: string; source: string; old: number; totalOrders: number; paid: number; remaining: number; net: number; orders: Order[] }>();
    for (const customer of savedCustomers) {
      grouped.set(customer.client_code || customer.phone || customer.client_name, { name: customer.client_name, code: customer.client_code, phone: customer.phone, email: customer.email || "", address: customer.address || "", source: customer.source_person, old: customer.old_balance, totalOrders: 0, paid: 0, remaining: 0, net: customer.old_balance, orders: [] });
    }
    for (const order of orders) {
      const key = order.client_code || order.phone || order.client_name;
      const current = grouped.get(key) ?? { name: order.client_name, code: order.client_code, phone: order.phone, email: "", address: "", source: order.source_person, old: order.old_balance, totalOrders: 0, paid: 0, remaining: 0, net: 0, orders: [] };
      current.totalOrders += 1;
      current.paid += order.paid;
      current.remaining += order.remaining;
      current.net = current.old + current.remaining;
      current.orders.push(order);
      grouped.set(key, current);
    }
    return Array.from(grouped.values()).filter((customer) => `${customer.name} ${customer.code} ${customer.phone} ${customer.email} ${customer.address}`.toLowerCase().includes(search.toLowerCase()));
  }, [orders, savedCustomers, search]);

  function updateOldBalance(code: string, value: number) {
    const before = orders.filter((order) => order.client_code === code);
    setOrders((current) => current.map((order) => order.client_code === code ? calculate({ ...order, old_balance: value, updated_at: new Date().toISOString() }) : order));
    addAudit(session, "CUSTOMER_BALANCE_UPDATED", "customers", code, before, { old_balance: value });
  }

  function printCustomer(customer: { name: string; code: string; phone: string; email: string; address: string; source: string; old: number; totalOrders: number; paid: number; remaining: number; net: number; orders: Order[] }) {
    printDocument(`طباعة بيانات العميل ${customer.name}`, printableRecord([
      ["اسم العميل", customer.name],
      ["كود العميل", customer.code],
      ["رقم التليفون", customer.phone],
      ["البريد الإلكتروني", customer.email],
      ["العنوان", customer.address],
      ["الطرف", customer.source],
      ["حساب قديم", customer.old],
      ["إجمالي الأوردرات", customer.totalOrders],
      ["إجمالي المدفوع", customer.paid],
      ["المتبقي", customer.remaining],
      ["صافي الحساب", customer.net],
    ]), session);
  }

  function printAllCustomers() {
    printDocument("طباعة كل العملاء", printableTable(["اسم العميل", "الكود", "الهاتف", "البريد الإلكتروني", "العنوان", "الطرف", "إجمالي الأوردرات", "المتبقي"], customers.map((customer) => [customer.name, customer.code, customer.phone, customer.email, customer.address, customer.source, customer.totalOrders, customer.remaining])), session, "landscape");
  }

  if (session.role !== "Master" && session.role !== "Helper") {
    return <section className="panel"><h2>حسابات العملاء</h2><p className="muted">لا توجد صلاحية لعرض الحسابات المالية.</p></section>;
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>حسابات العملاء</h2>
        <div className="inline-actions">
          {canPrintCustomers && <button className="ghost-btn compact" type="button" onClick={printAllCustomers}>طباعة الكل</button>}
          <input placeholder="بحث باسم العميل / الكود / الهاتف / البريد / العنوان" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
      </div>
      <div className="table-wrap accounts-table">
        <table>
          <thead><tr>{["اسم العميل", "الكود", "الهاتف", "البريد الإلكتروني", "العنوان", "الطرف", "حساب قديم", "إجمالي الأوردرات", "إجمالي المدفوع", "المتبقي", "صافي الحساب", "الإجراءات"].map((head) => <th key={head}>{head}</th>)}</tr></thead>
          <tbody>
            {customers.map((customer) => (
              <Fragment key={customer.code || customer.phone || customer.name}>
                <tr key={customer.code || customer.phone}>
                  <td>{customer.name}</td>
                  <td>{customer.code}</td>
                  <td>{customer.phone}</td>
                  <td className="email-cell"><EmailText email={customer.email} /></td>
                  <td>{customer.address || "-"}</td>
                  <td>{customer.source}</td>
                  <td>{session.role === "Master" ? <input type="number" value={customer.old} onChange={(event) => updateOldBalance(customer.code, Number(event.target.value))} /> : customer.old}</td>
                  <td>{customer.totalOrders}</td>
                  <td>{customer.paid}</td>
                  <td>{customer.remaining}</td>
                  <td>{customer.net}</td>
                  <td className="actions"><button className="ghost-btn compact" onClick={() => setExpanded(expanded === customer.code ? "" : customer.code)}>عرض</button>{canPrintCustomers && <button className="ghost-btn compact" type="button" onClick={() => printCustomer(customer)}>طباعة</button>}</td>
                </tr>
                {expanded === customer.code && <tr><td colSpan={12}><div className="history-list">{customer.orders.map((order) => <span key={order.id}>#{order.order_number} - {order.order_type} - {order.order_status}</span>)}</div></td></tr>}
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
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");
  const selectedParty = party === "أخرى" ? customParty : party;
  const code = nextCustomerCode(customers, selectedParty || party);
  function submit(event: React.FormEvent) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError("البريد الإلكتروني غير صحيح");
      return;
    }
    setError("");
    const customer: Customer = { id: createId(), source_person: selectedParty, client_name: name.trim(), client_code: code, phone: phone.trim(), email: normalizedEmail, address: address.trim(), old_balance: 0, notes: "", created_at: new Date().toISOString() };
    setCustomers((current) => [customer, ...current]);
    addAudit(session, "CUSTOMER_CREATED", "customers", customer.id, undefined, customer);
    setName("");
    setPhone("");
    setEmail("");
    setAddress("");
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
        <Field label="البريد الإلكتروني" type="email" value={email} onChange={setEmail} />
        <Field label="العنوان" value={address} onChange={setAddress} />
      </div>
      <ErrorText message={error} />
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
  const canPrintFinance = hasPermission(session, "expenses.print") || hasPermission(session, "revenues.print");

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

  function printTransaction(record: DbTransaction) {
    printDocument("طباعة معاملة", printableRecord([
      ["التاريخ", formatDateArabic(record.date)],
      ["نوع المصروف", record.expense_type || record.transaction_type || record.kind || "-"],
      ["البيان", record.description || "-"],
      ["المبلغ", formatMoney(record.amount ?? record.value ?? record.total)],
      ["الحساب / الوجهة", record.account_destination || "-"],
      ["اسم العميل", record.customer_name || "-"],
      ["رقم التفصيل", record.detail_number || "-"],
      ["المضاف", record.added_by || "-"],
      ["تاريخ الإضافة", formatDateArabic(record.created_at)],
    ]), session);
  }

  function printAllTransactions() {
    if (!data) return;
    printDocument("طباعة المعاملات المالية", [
      printableRecord([
        ["الشهر", month],
        ["الحساب / الوجهة", account || "كل الحسابات"],
        ["إجمالي الإيرادات", formatMoney(data.incomeTotal)],
        ["إجمالي المصروفات", formatMoney(data.expenseTotal)],
        ["الصافي", formatMoney(data.netTotal)],
      ]),
      printableTable(
        ["التاريخ", "نوع المصروف", "البيان", "المبلغ", "الحساب / الوجهة", "اسم العميل", "رقم التفصيل", "المضاف", "تاريخ الإضافة"],
        data.transactions.map((record) => [formatDateArabic(record.date), record.expense_type || record.transaction_type || record.kind || "-", record.description || "-", formatMoney(record.amount ?? record.value ?? record.total), record.account_destination || "-", record.customer_name || "-", record.detail_number || "-", record.added_by || "-", formatDateArabic(record.created_at)])
      ),
    ].join(""), session, "landscape");
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
            {["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"].map((name, index) => <option key={index + 1} value={index + 1}>{name}</option>)}
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
            <input className={`date-input ${formDate ? "has-value" : "empty"}`} type="date" value={formDate} onChange={(event) => setFormDate(event.target.value)} required />
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
        {canPrintFinance && <button className="ghost-btn compact" type="button" onClick={printAllTransactions}>طباعة الكل</button>}
        {["سامح", "احمد", "شيكات", "بنك"].map((name) => <button key={name} className={account === name ? "account-filter active" : "account-filter"} onClick={() => setAccount(account === name ? "" : name)}>{name}</button>)}
      </section>

      <section className="table-wrap accounts-table finance-table">
        <table>
          <thead><tr>{["التاريخ", "نوع المصروف", "البيان", "المبلغ", "الحساب / الوجهة", "اسم العميل", "رقم التفصيل", "المضاف", "التاريخ", "الإجراءات"].map((head) => <th key={head}>{head}</th>)}</tr></thead>
          <tbody>
            {data.transactions.length === 0 && <EmptyRow colSpan={10} />}
            {data.transactions.map((record) => <tr key={record.id}><td>{formatDateArabic(record.date)}</td><td>{record.expense_type || record.transaction_type || record.kind || "-"}</td><td>{record.description || "-"}</td><td className={String(record.transaction_type || record.kind).includes("مصروف") ? "danger-text" : ""}>{formatMoney(record.amount ?? record.value ?? record.total)}</td><td><span className="mini-pill">{record.account_destination || "-"}</span></td><td>{record.customer_name || "-"}</td><td>{record.detail_number || "-"}</td><td>{record.added_by || "-"}</td><td>{formatDateArabic(record.created_at)}</td><td>{canPrintFinance && <button className="ghost-btn compact" type="button" onClick={() => printTransaction(record)}>طباعة</button>}</td></tr>)}
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

function ReportsPage({ session }: { session: Session }) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<ReportsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [year, selectedMonth] = month.split("-").map(Number);
  const canPrintReports = hasPermission(session, "reports.print");

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

  function printReports() {
    if (!data) return;
    printDocument("طباعة التقارير", [
      printableRecord([
        ["الشهر", month],
        ["الإيرادات", formatMoney(data.incomeTotal)],
        ["المصروفات", formatMoney(data.expenseTotal)],
        ["الصافي", formatMoney(data.netTotal)],
      ]),
      printableTable(
        ["الشهر", "إيرادات", "مصروفات", "صافي"],
        data.monthlyRows.map((row) => [row.month, formatMoney(row.income), formatMoney(row.expense), formatMoney(row.net)])
      ),
    ].join(""), undefined, "landscape");
  }

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head"><h2>التقارير</h2><div className="inline-actions">{canPrintReports && <button className="ghost-btn compact" type="button" onClick={printReports}>طباعة الكل</button>}<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></div></div>
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
          <tbody>{rows.map((row) => <tr key={row.id}><td>{formatDateTimeEnglish(row.created_at)}</td><td className="email-cell"><EmailText email={row.user_email} /></td><td>{row.user_role}</td><td>{row.action}</td><td>{row.entity_type}</td><td>{row.entity_id}</td></tr>)}</tbody>
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
    materialsStatus: normalizeMaterialsStatus(pick("الخامات", "materialsStatus", "materials_status")),
    logo_status: String(pick("اللوجو", "logo_status") || "غير موجود"),
    quality_notes: String(pick("الجودة", "quality_notes")),
    operation_status: String(pick("التشغيل", "operation_status")),
    finishing_status: String(pick("التشطيب", "finishing_status")),
    order_status: (String(pick("الحالة", "order_status") || "جديد") as OrderStatus),
    workStage: normalizeWorkStage(pick("مرحلة الشغل", "workStage", "workflow_stage", "الحالة", "order_status")),
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

type ServerUserRow = {
  id: string;
  username: string;
  full_name?: string;
  email?: string;
  role?: string;
  is_active?: boolean;
  must_change_password?: boolean;
  permission_overrides?: PermissionOverride;
  created_at?: string;
  last_login_at?: string;
};

type ServerRoleRow = {
  id: string;
  name: string;
  description?: string;
  status?: "active" | "inactive";
  permissions?: PermissionKey[];
  is_system_role?: boolean;
  created_at?: string;
  updated_at?: string;
};

async function settingsRequest<T>(url: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || payload.error || "تعذر حفظ بيانات الإعدادات");
  return payload as T;
}

function normalizePermissionOverride(value?: PermissionOverride): PermissionOverride {
  return {
    allow: (value?.allow || []).filter((key): key is PermissionKey => allPermissionKeys.includes(key as PermissionKey)),
    deny: (value?.deny || []).filter((key): key is PermissionKey => allPermissionKeys.includes(key as PermissionKey)),
  };
}

function managedUserFromServer(row: ServerUserRow): ManagedUser {
  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name || row.username,
    email: row.email || `${row.username}@zunion.local`,
    role: row.role || "Operator",
    password: "",
    status: row.is_active === false ? "inactive" : "active",
    mustChangePassword: Boolean(row.must_change_password),
    permissionOverrides: normalizePermissionOverride(row.permission_overrides),
    createdAt: row.created_at || new Date().toISOString(),
    lastLoginAt: row.last_login_at,
  };
}

function managedRoleFromServer(row: ServerRoleRow): ManagedRole {
  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    status: row.status || "active",
    permissions: (row.permissions || []).filter((key): key is PermissionKey => allPermissionKeys.includes(key as PermissionKey)),
    isSystemRole: Boolean(row.is_system_role),
    createdAt: row.created_at || new Date().toISOString(),
    updatedAt: row.updated_at || row.created_at || new Date().toISOString(),
  };
}

function SettingsPage({ session }: { session: Session }) {
  const [users, setUsers] = useState<ManagedUser[]>(() => loadManagedUsers());
  const [roles, setRoles] = useState<ManagedRole[]>(() => loadManagedRoles());
  const [userForm, setUserForm] = useState({ username: "", fullName: "", password: "", confirmPassword: "", role: "Operator", status: "active" as "active" | "inactive", mustChangePassword: false });
  const [roleForm, setRoleForm] = useState({ name: "", description: "" });
  const [message, setMessage] = useState("");
  const [permissionSearch, setPermissionSearch] = useState("");
  const isMaster = session.role === "Master";
  const useRemoteSettings = useServerAuth || !isLocalHost;

  useEffect(() => {
    if (!useRemoteSettings || !isMaster) return;
    let mounted = true;
    Promise.all([
      settingsRequest<{ users: ServerUserRow[] }>("/api/users"),
      settingsRequest<{ roles: ServerRoleRow[] }>("/api/roles"),
    ]).then(([usersPayload, rolesPayload]) => {
      if (!mounted) return;
      const nextUsers = usersPayload.users.map(managedUserFromServer);
      const nextRoles = rolesPayload.roles.map(managedRoleFromServer);
      setUsers(nextUsers);
      setRoles(nextRoles);
      saveManagedUsers(nextUsers);
      saveManagedRoles(nextRoles);
    }).catch((error) => {
      if (mounted) setMessage(error instanceof Error ? error.message : "تعذر تحميل بيانات المستخدمين من الخادم");
    });
    return () => { mounted = false; };
  }, [useRemoteSettings, isMaster]);

  function persistUsers(next: ManagedUser[], action: string, target?: string, details?: unknown) {
    setUsers(next);
    saveManagedUsers(next);
    addAudit(session, action, "users", target, undefined, details);
  }

  function persistRoles(next: ManagedRole[], action: string, target?: string, details?: unknown) {
    setRoles(next);
    saveManagedRoles(next);
    addAudit(session, action, "roles", target, undefined, details);
  }

  async function resetAllPasswords() {
    const typed = window.prompt("سيتم تغيير كلمة مرور جميع المستخدمين النشطين إلى 1234، وتسجيل خروج الجلسة الحالية للأمان. لن يتم إجبار المستخدمين على تغييرها عند تسجيل الدخول القادم.\n\nاكتب RESET 1234 للتأكيد");
    if (typed !== "RESET 1234") return setMessage("قيمة التأكيد غير صحيحة");
    if (useRemoteSettings) {
      try {
        const payload = await settingsRequest<{ affectedUsers: number }>("/api/users/reset-all-passwords", {
          method: "POST",
          body: JSON.stringify({ confirmation: typed }),
        });
        setMessage(`تمت إعادة تعيين كلمات مرور ${payload.affectedUsers} مستخدم. يجب تسجيل الدخول مرة أخرى.`);
        localStorage.removeItem(sessionKey);
        window.setTimeout(() => window.location.reload(), 800);
        return;
      } catch (error) {
        return setMessage(error instanceof Error ? error.message : "تعذر إعادة تعيين كلمات المرور");
      }
    }

    const next = users.map((user) => user.status === "active" ? { ...user, password: "1234", mustChangePassword: false } : user);
    persistUsers(next, "BULK_PASSWORD_RESET", undefined, { actingMaster: session.username, affectedUsers: next.filter((user) => user.status === "active").length, at: new Date().toISOString() });
    localStorage.removeItem(sessionKey);
    setMessage("تمت إعادة تعيين كلمات المرور. يجب تسجيل الدخول مرة أخرى.");
    window.setTimeout(() => window.location.reload(), 800);
  }

  async function createUser(event: React.FormEvent) {
    event.preventDefault();
    const username = userForm.username.trim().toLowerCase();
    if (!username) return setMessage("اسم المستخدم مطلوب");
    if (users.some((user) => user.username === username)) return setMessage("اسم المستخدم مستخدم بالفعل");
    if (!userForm.fullName.trim()) return setMessage("الاسم مطلوب");
    if (!userForm.password) return setMessage("كلمة المرور مطلوبة");
    if (userForm.password !== userForm.confirmPassword) return setMessage("كلمتا المرور غير متطابقتين");
    if (!roles.some((role) => role.name === userForm.role)) return setMessage("يجب اختيار الدور");
    const now = new Date().toISOString();
    let nextUser: ManagedUser = {
      id: createId(),
      username,
      fullName: userForm.fullName.trim(),
      email: `${username.replace(/\s+/g, ".")}@zunion.local`,
      role: userForm.role,
      password: userForm.password,
      status: userForm.status,
      mustChangePassword: userForm.mustChangePassword,
      permissionOverrides: { allow: [], deny: [] },
      createdAt: now,
    };
    if (useRemoteSettings) {
      try {
        const payload = await settingsRequest<{ user?: ServerUserRow }>("/api/users", {
          method: "POST",
          body: JSON.stringify({
            username,
            name: nextUser.fullName,
            password: userForm.password,
            roleId: nextUser.role,
            status: nextUser.status,
            mustChangePassword: nextUser.mustChangePassword,
            permissionOverrides: nextUser.permissionOverrides,
          }),
        });
        if (payload.user) nextUser = managedUserFromServer(payload.user);
      } catch (error) {
        return setMessage(error instanceof Error ? error.message : "تعذر إنشاء المستخدم");
      }
    }
    persistUsers([nextUser, ...users], "USER_CREATED", nextUser.id, { username, role: nextUser.role });
    setUserForm({ username: "", fullName: "", password: "", confirmPassword: "", role: "Operator", status: "active", mustChangePassword: false });
    setMessage("تم إضافة المستخدم بنجاح");
  }

  async function resetPassword(user: ManagedUser) {
    const password = window.prompt(`كلمة المرور الجديدة للمستخدم ${user.username}`);
    if (!password) return;
    if (password.length < 4) return setMessage("كلمة المرور الجديدة يجب ألا تقل عن 4 أحرف");
    if (useRemoteSettings) {
      try {
        await settingsRequest(`/api/users/${encodeURIComponent(user.id)}/reset-password`, {
          method: "POST",
          body: JSON.stringify({ password, mustChangePassword: false }),
        });
      } catch (error) {
        return setMessage(error instanceof Error ? error.message : "تعذر تغيير كلمة المرور");
      }
    }
    persistUsers(users.map((item) => item.id === user.id ? { ...item, password, mustChangePassword: false } : item), "PASSWORD_RESET_BY_MASTER", user.id, { username: user.username });
    setMessage("تم تغيير كلمة المرور بنجاح");
  }

  async function toggleUserStatus(user: ManagedUser) {
    if (user.username === session.username) return setMessage("لا يمكنك إيقاف حسابك الحالي");
    if (user.role === "Master" && user.status === "active" && activeMasterCount(users) <= 1) return setMessage("لا يمكن حذف آخر حساب Master فعال");
    const status = user.status === "active" ? "inactive" : "active";
    if (useRemoteSettings) {
      try {
        await settingsRequest(`/api/users/${encodeURIComponent(user.id)}/status`, {
          method: "PATCH",
          body: JSON.stringify({ status }),
        });
      } catch (error) {
        return setMessage(error instanceof Error ? error.message : "تعذر تغيير حالة المستخدم");
      }
    }
    persistUsers(users.map((item) => item.id === user.id ? { ...item, status } : item), status === "active" ? "USER_ACTIVATED" : "USER_DEACTIVATED", user.id, { username: user.username, status });
    setMessage(status === "active" ? "تم تفعيل المستخدم بنجاح" : "تم إيقاف المستخدم بنجاح");
  }

  async function deleteUser(user: ManagedUser) {
    if (user.username === session.username) return setMessage("لا يمكنك حذف حسابك الحالي");
    if (user.role === "Master" && user.status === "active" && activeMasterCount(users) <= 1) return setMessage("لا يمكن حذف آخر حساب Master فعال");
    const typed = window.prompt("هل أنت متأكد من حذف هذا المستخدم؟ اكتب اسم المستخدم للتأكيد");
    if (typed !== user.username) return;
    if (useRemoteSettings) {
      try {
        await settingsRequest(`/api/users/${encodeURIComponent(user.id)}`, { method: "DELETE" });
      } catch (error) {
        return setMessage(error instanceof Error ? error.message : "تعذر حذف المستخدم");
      }
    }
    persistUsers(users.filter((item) => item.id !== user.id), "USER_DELETED", user.id, { username: user.username });
    setMessage("تم حذف المستخدم بنجاح");
  }

  async function updateUser(id: string, patch: Partial<ManagedUser>) {
    const oldUser = users.find((user) => user.id === id);
    if (useRemoteSettings) {
      try {
        await settingsRequest(`/api/users/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify({
            username: patch.username,
            name: patch.fullName,
            roleId: patch.role,
            status: patch.status,
            mustChangePassword: patch.mustChangePassword,
            permissionOverrides: patch.permissionOverrides,
          }),
        });
      } catch (error) {
        return setMessage(error instanceof Error ? error.message : "تعذر تحديث المستخدم");
      }
    }
    const next = users.map((user) => user.id === id ? { ...user, ...patch } : user);
    persistUsers(next, patch.role && patch.role !== oldUser?.role ? "USER_ROLE_CHANGED" : "USER_UPDATED", id, patch);
  }

  async function toggleUserOverride(userId: string, mode: "allow" | "deny", permission: PermissionKey) {
    const next = users.map((user) => {
      if (user.id !== userId) return user;
      const allow = new Set(user.permissionOverrides.allow);
      const deny = new Set(user.permissionOverrides.deny);
      if (mode === "allow") {
        allow.has(permission) ? allow.delete(permission) : allow.add(permission);
        deny.delete(permission);
      } else {
        deny.has(permission) ? deny.delete(permission) : deny.add(permission);
        allow.delete(permission);
      }
      return { ...user, permissionOverrides: { allow: Array.from(allow), deny: Array.from(deny) } };
    });
    const target = next.find((user) => user.id === userId);
    if (useRemoteSettings && target) {
      try {
        await settingsRequest(`/api/users/${encodeURIComponent(userId)}`, {
          method: "PATCH",
          body: JSON.stringify({ permissionOverrides: target.permissionOverrides }),
        });
      } catch (error) {
        return setMessage(error instanceof Error ? error.message : "تعذر تحديث صلاحيات المستخدم");
      }
    }
    persistUsers(next, "USER_PERMISSIONS_CHANGED", userId, { permission, mode });
  }

  async function createRole(event: React.FormEvent) {
    event.preventDefault();
    const name = roleForm.name.trim();
    if (!name) return setMessage("اسم الدور مطلوب");
    if (roles.some((role) => role.name.toLowerCase() === name.toLowerCase())) return setMessage("اسم الدور موجود بالفعل");
    const now = new Date().toISOString();
    let role: ManagedRole = { id: createId(), name, description: roleForm.description.trim(), status: "active", permissions: ["dashboard.view"], isSystemRole: false, createdAt: now, updatedAt: now };
    if (useRemoteSettings) {
      try {
        const payload = await settingsRequest<{ role?: ServerRoleRow | ServerRoleRow[] }>("/api/roles", {
          method: "POST",
          body: JSON.stringify({ name: role.name, description: role.description, status: role.status, permissions: role.permissions }),
        });
        const serverRole = Array.isArray(payload.role) ? payload.role[0] : payload.role;
        if (serverRole) role = managedRoleFromServer(serverRole);
      } catch (error) {
        return setMessage(error instanceof Error ? error.message : "تعذر إنشاء الدور");
      }
    }
    persistRoles([role, ...roles], "ROLE_CREATED", role.id, { name });
    setRoleForm({ name: "", description: "" });
    setMessage("تم إنشاء الدور بنجاح");
  }

  async function updateRole(roleId: string, patch: Partial<ManagedRole>) {
    const target = roles.find((role) => role.id === roleId);
    if (!target) return;
    if (target.name === "Master" && patch.permissions && !masterProtectedPermissions.every((key) => patch.permissions?.includes(key))) return setMessage("لا يمكن إزالة صلاحيات الإدارة من دور Master");
    if (target.name !== "Master" && patch.permissions?.includes("users.resetAllPasswords")) return setMessage("صلاحية إعادة تعيين كل كلمات المرور محمية لدور Master فقط");
    if (useRemoteSettings) {
      try {
        await settingsRequest(`/api/roles/${encodeURIComponent(roleId)}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: patch.name,
            description: patch.description,
            status: patch.status,
            permissions: patch.permissions,
          }),
        });
      } catch (error) {
        return setMessage(error instanceof Error ? error.message : "تعذر تحديث الدور");
      }
    }
    persistRoles(roles.map((role) => role.id === roleId ? { ...role, ...patch, updatedAt: new Date().toISOString() } : role), patch.permissions ? "ROLE_PERMISSIONS_CHANGED" : "ROLE_UPDATED", roleId, patch);
  }

  function toggleRolePermission(roleId: string, permission: PermissionKey) {
    const role = roles.find((item) => item.id === roleId);
    if (!role) return;
    const set = new Set(role.permissions);
    set.has(permission) ? set.delete(permission) : set.add(permission);
    updateRole(roleId, { permissions: Array.from(set) });
  }

  async function deleteRole(role: ManagedRole) {
    if (role.name === "Master" || role.isSystemRole) return setMessage("لا يمكن حذف الأدوار الأساسية");
    if (users.some((user) => user.role === role.name)) return setMessage("لا يمكن حذف دور مرتبط بمستخدمين");
    if (useRemoteSettings) {
      try {
        await settingsRequest(`/api/roles/${encodeURIComponent(role.id)}`, { method: "DELETE" });
      } catch (error) {
        return setMessage(error instanceof Error ? error.message : "تعذر حذف الدور");
      }
    }
    persistRoles(roles.filter((item) => item.id !== role.id), "ROLE_DELETED", role.id, { name: role.name });
  }

  const filteredPermissionGroups = permissionGroups.map((group) => ({
    ...group,
    permissions: group.permissions.filter((permission) => `${group.group} ${permission.label} ${permission.action} ${permission.key}`.toLowerCase().includes(permissionSearch.trim().toLowerCase())),
  })).filter((group) => group.permissions.length);

  if (!isMaster) return <div className="stack"><OptionalPasswordChangePanel session={session} /></div>;

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head">
          <h2>الإعدادات</h2>
          <span className="badge badge-red">Master فقط</span>
        </div>
        <div className="settings-danger-zone">
          <div>
            <strong>إعادة تعيين كلمات مرور جميع المستخدمين</strong>
            <p className="muted">سيتم ضبط كلمة المرور إلى 1234 للمستخدمين النشطين بدون إجبارهم على تغييرها عند تسجيل الدخول القادم.</p>
          </div>
          {hasPermission(session, "users.resetAllPasswords") && <button type="button" className="primary-btn" onClick={resetAllPasswords}>إعادة تعيين كلمات مرور جميع المستخدمين</button>}
        </div>
        <div className="stats-grid">
          <StatCard title="عدد المستخدمين" value={users.length} icon={Users} />
          <StatCard title="كلمة المرور الافتراضية" value="1234" icon={KeyRound} />
          <StatCard title="حسابات" icon={WalletCards} value={<span className="account-pills"><i>سامح</i><i>أحمد</i><i>شيكات</i><i>بنك</i></span>} />
          <StatCard title="الشعار" icon={Image} value={<span className="logo-preview-value"><BrandLogo /><small>src/assets/logo.png</small></span>} />
        </div>
      </section>
      <OptionalPasswordChangePanel session={session} />
      <section className="panel">
        <div className="panel-head">
          <h2>إدارة المستخدمين</h2>
          <span className="badge badge-red">Master</span>
        </div>
        <form className="settings-form" onSubmit={createUser}>
          <input placeholder="اسم المستخدم" value={userForm.username} onChange={(event) => setUserForm((current) => ({ ...current, username: event.target.value }))} />
          <input placeholder="الاسم" value={userForm.fullName} onChange={(event) => setUserForm((current) => ({ ...current, fullName: event.target.value }))} />
          <input placeholder="كلمة المرور" type="password" value={userForm.password} onChange={(event) => setUserForm((current) => ({ ...current, password: event.target.value }))} />
          <input placeholder="تأكيد كلمة المرور" type="password" value={userForm.confirmPassword} onChange={(event) => setUserForm((current) => ({ ...current, confirmPassword: event.target.value }))} />
          <select value={userForm.role} onChange={(event) => setUserForm((current) => ({ ...current, role: event.target.value }))}>{roles.map((role) => <option key={role.id}>{role.name}</option>)}</select>
          <select value={userForm.status} onChange={(event) => setUserForm((current) => ({ ...current, status: event.target.value as "active" | "inactive" }))}><option value="active">مفعل</option><option value="inactive">موقوف</option></select>
          <button className="primary-btn">إضافة مستخدم جديد</button>
        </form>
        {message && <p className="notice">{message}</p>}
        <div className="table-wrap accounts-table">
          <table>
            <thead>
              <tr>
                <th>اسم المستخدم</th>
                <th>الاسم</th>
                <th>الدور</th>
                <th>الحالة</th>
                <th>صلاحيات مخصصة</th>
                <th>آخر تسجيل دخول</th>
                <th>تاريخ الإنشاء</th>
                <th>الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.username}</td>
                  <td><input value={user.fullName} onChange={(event) => updateUser(user.id, { fullName: event.target.value })} /></td>
                  <td><select value={user.role} onChange={(event) => updateUser(user.id, { role: event.target.value })}>{roles.map((role) => <option key={role.id}>{role.name}</option>)}</select></td>
                  <td><span className={user.status === "active" ? "badge badge-green" : "badge badge-gray"}>{user.status === "active" ? "مفعل" : "موقوف"}</span></td>
                  <td>{user.permissionOverrides.allow.length + user.permissionOverrides.deny.length}</td>
                  <td>{user.lastLoginAt ? formatDateTimeEnglish(user.lastLoginAt) : "-"}</td>
                  <td>{formatDateArabic(user.createdAt)}</td>
                  <td className="actions">
                    <button type="button" onClick={() => resetPassword(user)}>تغيير كلمة المرور</button>
                    <button type="button" onClick={() => toggleUserStatus(user)}>{user.status === "active" ? "إيقاف المستخدم" : "تفعيل المستخدم"}</button>
                    <button type="button" className="danger-text" onClick={() => deleteUser(user)}>حذف المستخدم</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head"><h2>إدارة الأدوار والصلاحيات</h2><input placeholder="بحث الصلاحيات" value={permissionSearch} onChange={(event) => setPermissionSearch(event.target.value)} /></div>
        <form className="settings-form" onSubmit={createRole}>
          <input placeholder="اسم الدور" value={roleForm.name} onChange={(event) => setRoleForm((current) => ({ ...current, name: event.target.value }))} />
          <input placeholder="وصف الدور" value={roleForm.description} onChange={(event) => setRoleForm((current) => ({ ...current, description: event.target.value }))} />
          <button className="primary-btn">إنشاء دور</button>
        </form>
        <div className="role-grid">
          {roles.map((role) => (
            <div className="role-card" key={role.id}>
              <div className="panel-head">
                <h3>{role.name}</h3>
                <span className={role.status === "active" ? "badge badge-green" : "badge badge-gray"}>{role.status === "active" ? "مفعل" : "موقوف"}</span>
              </div>
              <input value={role.description} placeholder="وصف الدور" onChange={(event) => updateRole(role.id, { description: event.target.value })} />
              <div className="actions">
                <button type="button" onClick={() => updateRole(role.id, { permissions: allPermissionKeys })}>تحديد الكل</button>
                <button type="button" onClick={() => updateRole(role.id, { permissions: role.name === "Master" ? masterProtectedPermissions : [] })}>إلغاء تحديد الكل</button>
                <button type="button" onClick={() => updateRole(role.id, { status: role.status === "active" ? "inactive" : "active" })}>{role.status === "active" ? "إيقاف" : "تفعيل"}</button>
                {!role.isSystemRole && <button type="button" className="danger-text" onClick={() => deleteRole(role)}>حذف الدور</button>}
              </div>
              <p className="muted">عدد الصلاحيات: {role.permissions.length}</p>
              <div className="permission-matrix">
                {filteredPermissionGroups.map((group) => (
                  <div className="permission-group" key={`${role.id}-${group.group}`}>
                    <strong>{group.group}</strong>
                    <button type="button" className="ghost-btn compact" onClick={() => updateRole(role.id, { permissions: Array.from(new Set([...role.permissions, ...group.permissions.map((permission) => permission.key)])) })}>تحديد القسم بالكامل</button>
                    {group.permissions.map((permission) => (
                      <label className="check permission-check" key={permission.key}>
                        <input type="checkbox" checked={role.permissions.includes(permission.key)} onChange={() => toggleRolePermission(role.id, permission.key)} />
                        {permission.label} - {permission.action}
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head"><h2>صلاحيات مخصصة للمستخدمين</h2></div>
        <div className="role-grid">
          {users.map((user) => (
            <div className="role-card" key={`override-${user.id}`}>
              <h3>{user.username}</h3>
              {permissionGroups.flatMap((group) => group.permissions).slice(0, 18).map((permission) => (
                <div className="permission-override-row" key={`${user.id}-${permission.key}`}>
                  <span>{permission.label} - {permission.action}</span>
                  <button type="button" className={user.permissionOverrides.allow.includes(permission.key) ? "primary-btn compact" : "ghost-btn compact"} onClick={() => toggleUserOverride(user.id, "allow", permission.key)}>سماح</button>
                  <button type="button" className={user.permissionOverrides.deny.includes(permission.key) ? "primary-btn compact" : "ghost-btn compact"} onClick={() => toggleUserOverride(user.id, "deny", permission.key)}>منع</button>
                </div>
              ))}
            </div>
          ))}
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

  function save(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    const product: Product = { id: createId(), name: name.trim(), details, active: true, created_at: new Date().toISOString() };
    setProducts((current) => [product, ...current]);
    addAudit(session, "PRODUCT_CREATED", "products", product.id, undefined, product);
    setName("");
    setDetails("");
  }

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head"><h2>إضافة منتج</h2></div>
        <form className="order-form compact-form" onSubmit={save}>
          <label>اسم المنتج<input value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label>الوصف<input value={details} onChange={(event) => setDetails(event.target.value)} /></label>
          <button className="primary-btn" type="submit">حفظ المنتج</button>
        </form>
      </section>
    </div>
  );
}

function ProductManagerPage({ products, setProducts, session }: { products: Product[]; setProducts: React.Dispatch<React.SetStateAction<Product[]>>; session: Session }) {
  const normalizedProducts = products.map(normalizeProduct);
  const emptyProductForm: Product = normalizeProduct({ id: "", name: "", details: "", active: true, status: "active", created_at: "" });
  const [form, setForm] = useState<Product>(emptyProductForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [productImageStatus, setProductImageStatus] = useState("");
  const [productImageActive, setProductImageActive] = useState(false);
  const [saving, setSaving] = useState(false);

  function setProduct<K extends keyof Product>(key: K, value: Product[K]) {
    setForm((current) => normalizeProduct({ ...current, [key]: value }));
  }

  async function setProductImageFromClipboard(file?: File) {
    if (!file) return;
    if (!file.size) {
      setProductImageStatus("ملف الصورة فارغ");
      return;
    }
    if (!clipboardImageTypes.includes(file.type)) {
      setErrors((current) => ({ ...current, productImage: "صيغة صورة المنتج غير مدعومة" }));
      setProductImageStatus("نوع الصورة غير مدعوم");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setErrors((current) => ({ ...current, productImage: "حجم الملف أكبر من 10MB" }));
      setProductImageStatus("حجم الملف أكبر من 10MB.");
      return;
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      setErrors((current) => ({ ...current, productImage: "" }));
      setForm((current) => normalizeProduct({
        ...current,
        productImage: dataUrl,
        productImageName: file.name,
      }));
      setProductImageStatus("تم لصق الصورة بنجاح");
    } catch {
      setProductImageStatus("حدث خطأ أثناء لصق الصورة");
    }
  }

  async function pasteProductImage() {
    setProductImageActive(true);
    try {
      await setProductImageFromClipboard(await readClipboardImageFile());
    } catch (error) {
      setProductImageStatus(error instanceof Error ? error.message : "حدث خطأ أثناء لصق الصورة");
    }
  }

  function removeProductImage() {
    setForm((current) => normalizeProduct({ ...current, productImage: "", productImageName: "" }));
    setProductImageStatus("");
    setErrors((current) => ({ ...current, productImage: "" }));
  }

  function handleProductPaste(event: React.ClipboardEvent<HTMLFormElement>) {
    if (!(event.target instanceof Element) || !event.target.closest(".image-clipboard-field")) return;
    event.preventDefault();
    if (!productImageActive) {
      setProductImageStatus("اختر خانة الصورة أولاً");
      return;
    }
    const item = Array.from(event.clipboardData.items).find((clipboardItem) => clipboardItem.type.startsWith("image/"));
    if (!item) {
      setProductImageStatus("لا توجد صورة في الحافظة");
      return;
    }
    if (!clipboardImageTypes.includes(item.type)) {
      setProductImageStatus("نوع الصورة غير مدعوم");
      return;
    }
    const file = item.getAsFile();
    if (!file) {
      setProductImageStatus("حدث خطأ أثناء لصق الصورة");
      return;
    }
    setProductImageFromClipboard(new File([file], safeClipboardFileName(file.type), { type: file.type }));
  }

  function validate() {
    const nextErrors: Record<string, string> = {};
    const trimmedName = form.name.trim();
    if (!trimmedName) nextErrors.name = "اسم المنتج مطلوب";
    if (normalizedProducts.some((product) => product.name.trim().toLowerCase() === trimmedName.toLowerCase())) nextErrors.name = "اسم المنتج موجود بالفعل";
    if (!["active", "inactive"].includes(form.status || "")) nextErrors.status = "حالة المنتج غير صحيحة";
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  function resetForm() {
    setForm(emptyProductForm);
    setErrors({});
    setProductImageStatus("");
    setProductImageActive(false);
  }

  function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving || !validate()) return;
    setSaving(true);
    const now = new Date().toISOString();
    const product = normalizeProduct({
      ...form,
      id: createId(),
      name: form.name.trim(),
      details: form.details.trim(),
      defaultQuantity: 1,
      logoPlacement: "",
      quality: "",
      logoImage: "",
      logoImageName: "",
      active: form.status !== "inactive",
      created_at: now,
    });
    setProducts((current) => [product, ...current]);
    addAudit(session, "PRODUCT_CREATED", "products", product.id, undefined, product);
    resetForm();
    window.setTimeout(() => setSaving(false), 300);
  }

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head"><h2>إضافة منتج</h2></div>
        <form className="order-form compact-form" onSubmit={save} onPaste={handleProductPaste}>
          <div className="form-grid product-form-grid">
            <label>اسم المنتج<input value={form.name} onChange={(event) => setProduct("name", event.target.value)} /><ErrorText message={errors.name} /></label>
            <label>التفاصيل<input value={form.details} onChange={(event) => setProduct("details", event.target.value)} /></label>
            <label>الحالة<select value={form.status || "active"} onChange={(event) => setProduct("status", event.target.value as Product["status"])}><option value="active">نشط</option><option value="inactive">غير نشط</option></select><ErrorText message={errors.status} /></label>
            <div className="product-image-field">
              <ImageInputWithClipboard
                label="صورة المنتج"
                value={form.productImage || ""}
                fileName={form.productImageName}
                source={form.productImage ? "clipboard" : undefined}
                active={productImageActive}
                status={productImageStatus}
                onActivate={() => setProductImageActive(true)}
                onPaste={pasteProductImage}
                onRemove={removeProductImage}
              />
              <ErrorText message={errors.productImage} />
            </div>
          </div>
          <div className="form-actions">
            <button className="primary-btn" type="submit" disabled={saving}>{saving ? "جاري الحفظ..." : "حفظ المنتج"}</button>
          </div>
        </form>
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
  const [createdOrder, setCreatedOrder] = useState<Order | null>(null);
  const { orders, setOrders } = useOrders(session);
  const { items: customers, setItems: setCustomers } = useCustomers(session);
  const { items: financeRecords, setItems: setFinanceRecords } = useStoredList<FinanceRecord>(financeKey, []);
  const { items: products, setItems: setProducts } = useProducts(session);

  useEffect(() => {
    const syncViewFromHash = () => setViewState(viewFromHash());
    window.addEventListener("hashchange", syncViewFromHash);
    return () => window.removeEventListener("hashchange", syncViewFromHash);
  }, []);

  function setView(nextView: View) {
    setViewState(nextView);
    window.history.replaceState(null, "", `#${nextView}`);
    if (nextView === "new") setCreatedOrder(null);
  }

  function saveNew(order: Order) {
    setOrders((current) => [order, ...current]);
    addAudit(session, "ORDER_CREATED", "orders", order.id, undefined, order);
    setCreatedOrder(order);
    setView("worker");
  }

  const currentRole = session?.role ?? "Master";
  const visibleOrders = roleOrders(currentRole, orders);
  const isMaster = currentRole === "Master";
  const isOperator = currentRole === "Operator" || currentRole === "Helper";
  const isSupervisor = currentRole === "Supervisor" || currentRole === "Worker";
  const isFinishing = currentRole === "Finishing" || currentRole === "Finish";
  const can = (permission: PermissionKey) => hasPermission(session, permission);
  const canPrintCreatedOrder = hasPermission(session, "orders.print") || hasPermission(session, "operation.print");
  const sidebarSections = useMemo<SidebarSectionConfig[]>(() => {
    const sections: SidebarSectionConfig[] = [
      {
        id: "home",
        label: "الرئيسية",
        icon: ClipboardList,
        items: [
          { id: "search", label: "متابعة أوردرات", visible: can("orders.view"), icon: ClipboardList },
          { id: "new", label: "أوردر جديد", visible: can("orders.create"), icon: FilePlus },
          { id: "addCustomer", label: "إضافة عميل", visible: can("customers.create"), icon: UserPlus },
          { id: "addProduct", label: "إضافة منتج", visible: can("products.create"), icon: PackagePlus },
        ],
      },
      {
        id: "search",
        label: "بحث",
        icon: Search,
        items: [
          { id: "search", label: "بحث", visible: can("search.use") || can("orders.view"), icon: Search },
          { id: "customers", label: "العملاء", visible: can("customers.view"), icon: Users },
        ],
      },
      {
        id: "finance",
        label: "مصروفات وإيرادات",
        icon: ArrowUpDown,
        items: [
          { id: "finance", label: "مصروفات وإيرادات", visible: can("expenses.view") || can("revenues.view"), icon: WalletCards },
          { id: "reports", label: "التقارير", visible: can("reports.view"), icon: BadgeInfo },
          { id: "import", label: "الاستيراد والتصدير", visible: can("import.export"), icon: ArrowUpDown },
        ],
      },
      {
        id: "operation",
        label: "التشغيل",
        icon: Cog,
        items: [
          { id: "worker", label: "التشغيل", visible: can("operation.view"), icon: Cog },
          { id: "alerts", label: "التنبيهات", visible: can("orders.view"), icon: BadgeInfo },
        ],
      },
      {
        id: "finishing",
        label: "التشطيب",
        icon: Wrench,
        items: [
          { id: "finish", label: "التشطيب", visible: can("finishing.view"), icon: Wrench },
        ],
      },
      {
        id: "system",
        label: "الإعدادات",
        icon: Cog,
        items: [
          { id: "audit", label: "سجل العمليات", visible: can("audit.view"), icon: ClipboardList },
          { id: "settings", label: "الإعدادات", visible: true, icon: Cog },
        ],
      },
    ];
    return sections
      .map((section) => ({ ...section, items: section.items.filter((item) => item.visible) }))
      .filter((section) => section.items.length > 0);
  }, [session]);

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
  const routeAllowed = canAccessView(session, view);

  return (
    <div className="app" dir="rtl" onInputCapture={normalizeInputDigits}>
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
            <p>{session.fullName || session.username ? `${session.fullName || session.username} - ${session.role}` : <><EmailText email={session.email} className="account-email" /> - {session.role}</>}</p>
          </div>
          <BrandLogo className="top-logo" />
        </header>
        <section className="page">
          {!routeAllowed && <ErrorPanel message="غير مصرح لك بالدخول إلى هذه الصفحة" />}
          {routeAllowed && <>
          {createdOrder && (
            <section className="panel created-order-panel">
              <div>
                <h2>تم إنشاء الأوردر وإرساله إلى التشغيل بنجاح</h2>
                <p className="muted">رقم الأوردر: <span className="data-value">{createdOrder.order_number}</span></p>
              </div>
              {canPrintCreatedOrder && (
                <button type="button" className="ghost-btn print-order-btn" onClick={() => {
                  addAudit(session, "ORDER_PRINTED", "orders", createdOrder.id);
                  printOrderDocument(createdOrder, session);
                }}>
                  <Printer size={16} />
                  طباعة الأوردر
                </button>
              )}
            </section>
          )}
          {view === "dashboard" && <Dashboard setView={setView} canSeeFinancials={canManageFinancials(session.role)} />}
          {view === "orders" && <OrdersPage orders={orders} setOrders={setOrders} session={session} />}
          {view === "new" && <OrderForm orderNumber={nextOrderNumber(orders)} customers={customers} products={products} canAddProduct={isMaster || isOperator} onAddProduct={() => setView("addProduct")} onSave={saveNew} />}
          {view === "addCustomer" && <AddCustomerPage customers={customers} setCustomers={setCustomers} session={session} />}
          {view === "addProduct" && <ProductManagerPage products={products} setProducts={setProducts} session={session} />}
          {view === "search" && <SearchPage orders={orders} setOrders={setOrders} session={session} />}
          {view === "worker" && <OrdersPage orders={orders} setOrders={setOrders} session={session} queue="worker" />}
          {view === "finish" && <OrdersPage orders={orders} setOrders={setOrders} session={session} queue="finish" />}
          {view === "customers" && <CustomerAccounts orders={orders} customers={customers} session={session} setOrders={setOrders} />}
          {view === "finance" && <FinancePageModern session={session} />}
          {view === "reports" && <ReportsPage session={session} />}
          {view === "import" && <ImportExport orders={orders} setOrders={setOrders} session={session} />}
          {view === "audit" && <AuditLog />}
          {view === "settings" && <SettingsPage session={session} />}
          {view === "alerts" && <section className="panel"><h2>تنبيهات التسليم</h2><div className="alerts-list">{buildAlerts(visibleOrders, canManageFinancials(session.role)).map((alert, index) => <AlertItem key={`${alert.order.id}-${index}`} alert={alert} />)}</div></section>}
          </>}
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

