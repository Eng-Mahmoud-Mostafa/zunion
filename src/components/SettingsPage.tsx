import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Archive,
  Ban,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Cpu,
  Factory,
  Gauge,
  KeyRound,
  LayoutDashboard,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Scissors,
  Search,
  ShieldCheck,
  Trash2,
  UserCog,
  UserPlus,
  Users,
  WalletCards,
  Wrench,
  X,
} from "lucide-react";
import { allPermissionKeys, masterProtectedPermissions, type PermissionKey } from "../../shared/permissions";
import { formatDateArabic, formatDateTimeEnglish } from "../utils/formatters";

export type PermissionOverride = { allow: PermissionKey[]; deny: PermissionKey[] };

export type SettingsUser = {
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

export type SettingsRole = {
  id: string;
  name: string;
  description: string;
  status: "active" | "inactive";
  permissions: PermissionKey[];
  isSystemRole: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SettingsPermissionGroup = {
  group: string;
  permissions: Array<{ key: PermissionKey; label: string; action: string }>;
};

export type SettingsCapabilities = {
  createUsers: boolean;
  editUsers: boolean;
  deleteUsers: boolean;
  deactivateUsers: boolean;
  resetPassword: boolean;
  resetAllPasswords: boolean;
  createRoles: boolean;
  editRoles: boolean;
  deleteRoles: boolean;
  managePermissions: boolean;
};

type SectionId = "overview" | "users" | "roles" | "overrides" | "departments" | "resources" | "finance" | "security";

/** Minimal structural shapes the host app passes down for browser-only mode. */
type LocalWorkerInput = { id: string; name: string; active: boolean; department: string; card_id?: string | null; phone?: string | null };
type LocalMachineInput = { id: string; name: string; position: number; active: boolean };

type ConfirmState =
  | { kind: "status"; payload: SettingsUser }
  | { kind: "deleteUser"; payload: SettingsUser }
  | { kind: "deleteRole"; payload: SettingsRole }
  | { kind: "resetAll" }
  | { kind: "discard"; payload: SectionId | string };

type SettingsPageProps = {
  username: string;
  role: string;
  isMaster: boolean;
  useRemoteSettings: boolean;
  permissionGroups: SettingsPermissionGroup[];
  capabilities: SettingsCapabilities;
  accountPanel: ReactNode;
  /** Browser-only mode has no backend, so the host supplies live records. */
  localWorkers?: LocalWorkerInput[];
  localMachines?: LocalMachineInput[];
  onAudit: (action: string, entityType: string, entityId?: string, oldValue?: unknown, newValue?: unknown) => void;
};

/**
 * Bulk reset confirmation is a neutral phrase, matching the backend's
 * BULK_RESET_CONFIRMATION. The reset password itself is never rendered in the
 * UI; LOCAL_BULK_RESET_PASSWORD exists only because browser-only mode has to
 * store a comparable credential to validate offline logins.
 */
const RESET_ALL_CONFIRMATION = "RESET";
const LOCAL_BULK_RESET_PASSWORD = "1234";

type ServerUserRow = {
  id: string;
  username: string;
  full_name?: string;
  email?: string;
  role?: string;
  is_active?: boolean;
  must_change_password?: boolean;
  permission_overrides?: Partial<PermissionOverride>;
  created_at?: string;
  last_login_at?: string;
};

type ServerRoleRow = {
  id: string;
  name: string;
  description?: string;
  status?: "active" | "inactive";
  permissions?: string[];
  is_system_role?: boolean;
  created_at?: string;
  updated_at?: string;
};

type WorkerRow = { id: string; name: string; active: boolean; department: string; card_id?: string | null; phone?: string | null; created_at?: string };
type MachineRow = { id: string; name: string; position: number; active: boolean; created_at?: string; updated_at?: string };
type PeriodRow = { id: string; month: number; year: number; notes?: string; opened_by?: string | null };
type AuditRow = { id: string; action: string; entity_type?: string; entity_id?: string | null; created_at?: string };

const managedUsersKey = "zunion-managed-users-v1";
const managedRolesKey = "zunion-managed-roles-v1";
const sessionKey = "zunion-local-session";
const auditKey = "zunion-local-audit-v1";

type LocalAuditEntry = {
  id: string;
  action: string;
  entity_type?: string;
  entity_id?: string | null;
  created_at?: string;
};

/** Reads the host app's local audit trail so Settings can show it without a backend. */
function readLocalAudit(): LocalAuditEntry[] {
  try {
    const raw = localStorage.getItem(auditKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LocalAuditEntry[]) : [];
  } catch {
    return [];
  }
}

/**
 * Browser-only mode keeps no monthly-period table; months are only ever opened
 * through audit entries, so derive the list from those instead of fetching.
 */
function localPeriodsFromAudit(entries: LocalAuditEntry[]): PeriodRow[] {
  const seen = new Map<string, PeriodRow>();
  for (const entry of entries) {
    if (entry.action !== "MONTH_OPENED" || entry.entity_type !== "monthly_periods") continue;
    const raw = String(entry.entity_id || "");
    const match = /^(\d{4})-(\d{1,2})$/.exec(raw);
    if (!match) continue;
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (!year || month < 1 || month > 12) continue;
    seen.set(raw, { id: raw, year, month });
  }
  return [...seen.values()].sort((a, b) => b.year - a.year || b.month - a.month);
}

const SECTIONS: Array<{ id: SectionId; label: string; description: string; icon: typeof Users }> = [
  { id: "overview", label: "نظرة عامة", description: "ملخص حالة النظام والإدارة", icon: LayoutDashboard },
  { id: "users", label: "المستخدمون", description: "إنشاء الحسابات وتعديل البيانات والصلاحيات المخصصة", icon: Users },
  { id: "roles", label: "الأدوار والصلاحيات", description: "الأدوار مقارنة بالإعدادات وأي مستخدم يمكنه الوصول", icon: ShieldCheck },
  { id: "overrides", label: "صلاحيات المستخدمين", description: "منح أو منع صلاحية واحدة لمستخدم محدد", icon: UserCog },
  { id: "departments", label: "الأقسام وقنوات التشغيل", description: "أقسام العمال وقنوات الطابور المستخدمة في التشغيل", icon: Factory },
  { id: "resources", label: "العمال والماكينات", description: "سجل العمال المسجلين والماكينات المعتمدة", icon: Cpu },
  { id: "finance", label: "الإعدادات المالية", description: "طرق الدفع والفترات الشهرية المفتوحة", icon: WalletCards },
  { id: "security", label: "الأمان", description: "كلمة المرور، الحسابات النشطة، وسجل الأمان", icon: Lock },
];

const WORKER_DEPARTMENT_LABELS: Record<string, string> = {
  operation: "التشغيل",
  printing: "الطباعة",
  sewing: "الخياطة",
  finishing: "التشطيب",
};

const QUEUE_CHANNELS: Array<{ id: string; label: string; route: string; permission: PermissionKey; icon: typeof Printer }> = [
  { id: "worker", label: "طابور التشغيل", route: "worker", permission: "operation.view", icon: Factory },
  { id: "print", label: "طابور الطباعة", route: "print", permission: "operation.view", icon: Printer },
  { id: "sewing", label: "طابور الخياطة", route: "sewing", permission: "operation.view", icon: Scissors },
  { id: "finish", label: "طابور التشطيب", route: "finish", permission: "finishing.view", icon: Wrench },
  { id: "archive", label: "الأرشيف", route: "archive", permission: "orders.view", icon: Archive },
];

type ModuleGroup = {
  id: string;
  label: string;
  hint: string;
  keys: PermissionKey[];
  governedBy?: { groupId: string; keys: PermissionKey[]; note: string };
};

const PERMISSION_LABELS: Record<PermissionKey, string> = {
  "dashboard.view": "عرض لوحة التحكم",
  "orders.view": "عرض الأوردرات",
  "orders.create": "إضافة أوردر جديد",
  "orders.edit": "تعديل الأوردرات",
  "orders.delete": "حذف الأوردرات",
  "orders.print": "طباعة الأوردرات",
  "search.use": "البحث في الأوردرات",
  "customers.view": "عرض العملاء",
  "customers.create": "إضافة عميل جديد",
  "customers.edit": "تعديل بيانات العملاء",
  "customers.delete": "حذف العملاء",
  "customers.print": "طباعة بيانات العملاء",
  "products.view": "عرض المنتجات",
  "products.create": "إضافة منتج جديد",
  "products.edit": "تعديل المنتجات",
  "products.delete": "حذف المنتجات",
  "products.print": "طباعة المنتجات",
  "dailyAccounts.view": "عرض الحسابات اليومية",
  "salaries.view": "عرض رواتب العمال",
  "expenses.view": "عرض المصروفات",
  "expenses.create": "إضافة مصروف",
  "expenses.print": "طباعة المصروفات",
  "revenues.view": "عرض الإيرادات",
  "revenues.create": "إضافة إيراد",
  "revenues.print": "طباعة الإيرادات",
  "operation.view": "عرض طابور التشغيل",
  "operation.update": "تحديث بيانات التشغيل",
  "operation.upload": "رفع صور التشغيل",
  "operation.print": "طباعة أذون التشغيل",
  "finishing.view": "عرض طابور التشطيب",
  "finishing.update": "تحديث بيانات التشطيب",
  "finishing.upload": "رفع صور التشطيب",
  "finishing.print": "طباعة أذون التشطيب",
  "reports.view": "عرض التقارير",
  "reports.print": "طباعة التقارير",
  "import.export": "استيراد وتصدير البيانات",
  "users.view": "عرض المستخدمين",
  "users.create": "إنشاء مستخدم جديد",
  "users.edit": "تعديل بيانات مستخدم",
  "users.deactivate": "إيقاف أو تفعيل مستخدم",
  "users.delete": "حذف مستخدم",
  "users.resetPassword": "تغيير كلمة مرور مستخدم",
  "users.resetAllPasswords": "إعادة تعيين كل كلمات المرور",
  "roles.view": "عرض الأدوار",
  "roles.create": "إنشاء دور جديد",
  "roles.edit": "تعديل دور",
  "roles.delete": "حذف دور",
  "permissions.manage": "إدارة الصلاحيات",
  "audit.view": "عرض سجل التدقيق",
  "settings.view": "عرض الإعدادات",
};

const MODULE_GROUPS: ModuleGroup[] = [
  { id: "home", label: "الرئيسية", hint: "صلاحيات لوحة التحكم العامة.", keys: ["dashboard.view"] },
  { id: "orders", label: "الأوردرات", hint: "عرض الأوردرات وإضافتها وتعديلها وحذفها وطباعتها والبحث فيها.", keys: ["orders.view", "orders.create", "orders.edit", "orders.delete", "orders.print", "search.use"] },
  { id: "customers", label: "العملاء", hint: "إدارة بيانات العملاء وحساباتهم.", keys: ["customers.view", "customers.create", "customers.edit", "customers.delete", "customers.print"] },
  { id: "products", label: "المنتجات", hint: "قائمة المنتجات وصورها وأسعارها.", keys: ["products.view", "products.create", "products.edit", "products.delete", "products.print"] },
  { id: "accounts", label: "الحسابات", hint: "الحسابات اليومية والرواتب والمصروفات والإيرادات.", keys: ["dailyAccounts.view", "salaries.view", "expenses.view", "expenses.create", "expenses.print", "revenues.view", "revenues.create", "revenues.print"] },
  { id: "operation", label: "تشغيل تطريز", hint: "طابور تشغيل ماكينات التطريز.", keys: ["operation.view", "operation.update", "operation.upload", "operation.print"] },
  {
    id: "printing",
    label: "طباعه",
    hint: "لا توجد صلاحيات مستقلة للطباعة في النظام.",
    keys: [],
    governedBy: { groupId: "operation", keys: ["operation.view", "operation.update", "operation.upload", "operation.print"], note: "طابور الطباعة محكوم بصلاحيات تشغيل تطريز." },
  },
  {
    id: "sewing",
    label: "خياطه",
    hint: "لا توجد صلاحيات مستقلة للخياطة في النظام.",
    keys: [],
    governedBy: { groupId: "operation", keys: ["operation.view", "operation.update", "operation.upload", "operation.print"], note: "طابور الخياطة محكوم بصلاحيات تشغيل تطريز." },
  },
  { id: "finishing", label: "التشطيب", hint: "طابور التشطيب النهائي.", keys: ["finishing.view", "finishing.update", "finishing.upload", "finishing.print"] },
  {
    id: "workers",
    label: "العمال",
    hint: "لا توجد صلاحيات مستقلة للعمال في النظام.",
    keys: [],
    governedBy: { groupId: "operation", keys: ["operation.view", "operation.update", "operation.upload", "operation.print"], note: "بيانات العمال محكومة بصلاحيات تشغيل تطريز." },
  },
  {
    id: "machines",
    label: "الماكينات",
    hint: "لا توجد صلاحيات مستقلة للماكينات في النظام.",
    keys: [],
    governedBy: { groupId: "operation", keys: ["operation.view"], note: "توزيع الماكينات محكوم بصلاحية عرض تشغيل تطريز." },
  },
  { id: "reports", label: "التقارير", hint: "التقارير وطباعتها والاستيراد والتصدير.", keys: ["reports.view", "reports.print", "import.export"] },
  { id: "settings", label: "الإعدادات", hint: "المستخدمون والأدوار وإدارة الصلاحيات وسجل التدقيق.", keys: ["users.view", "users.create", "users.edit", "users.deactivate", "users.delete", "users.resetPassword", "users.resetAllPasswords", "roles.view", "roles.create", "roles.edit", "roles.delete", "permissions.manage", "audit.view", "settings.view"] },
];

const PERMISSION_GROUP_OF = (() => {
  const map = new Map<PermissionKey, ModuleGroup>();
  MODULE_GROUPS.forEach((group) => {
    group.keys.forEach((key) => {
      if (map.has(key)) {
        if (import.meta.env.DEV) console.error(`[settings] صلاحية مكررة في المجموعات: ${key}`);
        return;
      }
      map.set(key, group);
    });
  });
  allPermissionKeys.forEach((key) => {
    if (!map.has(key) && import.meta.env.DEV) console.error(`[settings] صلاحية غير مُسندة لأي مجموعة: ${key}`);
  });
  return map;
})();

const PAYMENT_METHODS = [
  { value: "cash", label: "نقدي" },
  { value: "bank_transfer", label: "تحويل بنكي" },
  { value: "instapay", label: "إنستاباي" },
  { value: "wallet", label: "محفظة إلكترونية" },
  { value: "deferred", label: "آجل" },
  { value: "other", label: "أخرى" },
];

const MONTH_NAMES = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

const AUDIT_ACTION_LABELS: Record<string, string> = {
  USER_CREATED: "إنشاء مستخدم",
  USER_UPDATED: "تعديل مستخدم",
  USER_ROLE_CHANGED: "تغيير دور مستخدم",
  USER_DELETED: "حذف مستخدم",
  USER_ACTIVATED: "تفعيل مستخدم",
  USER_DEACTIVATED: "إيقاف مستخدم",
  USER_PERMISSIONS_CHANGED: "تعديل صلاحيات مستخدم",
  PASSWORD_RESET_BY_MASTER: "إعادة تعيين كلمة مرور",
  BULK_PASSWORD_RESET: "إعادة تعيين كل كلمات المرور",
  ROLE_CREATED: "إنشاء دور",
  ROLE_UPDATED: "تعديل دور",
  ROLE_PERMISSIONS_CHANGED: "تعديل صلاحيات دور",
  ROLE_DELETED: "حذف دور",
  LOGIN: "تسجيل دخول",
  LOGOUT: "تسجيل خروج",
  LOGIN_FAILED: "محاولة دخول فاشلة",
  PASSWORD_CHANGED: "تغيير كلمة المرور",
};

function loadStoredUsers(): SettingsUser[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(managedUsersKey) || "[]");
    return Array.isArray(parsed) ? (parsed as SettingsUser[]) : [];
  } catch {
    return [];
  }
}

function loadStoredRoles(): SettingsRole[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(managedRolesKey) || "[]");
    return Array.isArray(parsed) ? (parsed as SettingsRole[]) : [];
  } catch {
    return [];
  }
}

async function settingsRequest<T>(url: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || payload.error || "تعذر تنفيذ العملية");
  return payload as T;
}

function normalizeOverride(value?: Partial<PermissionOverride>): PermissionOverride {
  const clean = (list?: PermissionKey[]) =>
    (list || []).filter((key, index): key is PermissionKey => allPermissionKeys.includes(key as PermissionKey) && list!.indexOf(key) === index);
  return {
    allow: clean(value?.allow),
    deny: clean(value?.deny),
  };
}

function userFromServer(row: ServerUserRow): SettingsUser {
  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name || row.username,
    email: row.email || `${row.username}@zunion.local`,
    role: row.role || "Operator",
    password: "",
    status: row.is_active === false ? "inactive" : "active",
    mustChangePassword: Boolean(row.must_change_password),
    permissionOverrides: normalizeOverride(row.permission_overrides),
    createdAt: row.created_at || new Date().toISOString(),
    lastLoginAt: row.last_login_at,
  };
}

function roleFromServer(row: ServerRoleRow): SettingsRole {
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

function effectivePermissionsFor(user: SettingsUser, roles: SettingsRole[]): Set<PermissionKey> {
  if (user.role === "Master") return new Set(allPermissionKeys);
  const role = roles.find((item) => item.name === user.role);
  const permissions = new Set<PermissionKey>(role?.permissions || []);
  user.permissionOverrides.allow.forEach((key) => permissions.add(key));
  user.permissionOverrides.deny.forEach((key) => permissions.delete(key));
  return permissions;
}

function activeMasterCount(users: SettingsUser[]) {
  return users.filter((user) => user.role === "Master" && user.status === "active").length;
}

function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

function Modal({ title, subtitle, onClose, children, footer }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  return (
    <div
      className="settings-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="settings-modal" role="dialog" aria-modal="true" aria-label={title} dir="rtl">
        <div className="settings-modal-head">
          <div>
            <h3>{title}</h3>
            {subtitle ? <p className="muted">{subtitle}</p> : null}
          </div>
          <button type="button" className="settings-icon-btn" onClick={onClose} aria-label="إغلاق">
            <X size={20} />
          </button>
        </div>
        <div className="settings-modal-body">{children}</div>
        {footer ? <div className="settings-modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

function ConfirmDialog({ title, message, confirmLabel, tone, busy, onConfirm, onCancel }: { title: string; message: string; confirmLabel: string; tone?: "danger" | "primary"; busy?: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="ghost-btn" onClick={onCancel} disabled={busy}>
            إلغاء
          </button>
          <button type="button" className={tone === "danger" ? "primary-btn danger" : "primary-btn"} onClick={onConfirm} disabled={busy}>
            {busy ? <Loader2 size={18} className="spin" /> : null}
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="settings-confirm-text">{message}</p>
    </Modal>
  );
}

function EmptyState({ icon: Icon, title, hint }: { icon: typeof Users; title: string; hint?: string }) {
  return (
    <div className="settings-empty">
      <Icon size={28} />
      <strong>{title}</strong>
      {hint ? <span className="muted">{hint}</span> : null}
    </div>
  );
}

function StatusBadge({ status }: { status: "active" | "inactive" }) {
  return <span className={status === "active" ? "badge badge-green" : "badge badge-gray"}>{status === "active" ? "مفعل" : "موقوف"}</span>;
}

export default function SettingsPage({ username, role, isMaster, useRemoteSettings, permissionGroups, capabilities, accountPanel, localWorkers, localMachines, onAudit }: SettingsPageProps) {
  const [section, setSection] = useState<SectionId>("overview");
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<SettingsUser[]>(() => loadStoredUsers());
  const [roles, setRoles] = useState<SettingsRole[]>(() => loadStoredRoles());
  const [notice, setNotice] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");

  const [usersSearch, setUsersSearch] = useState("");
  const [usersRoleFilter, setUsersRoleFilter] = useState("all");
  const [usersStatusFilter, setUsersStatusFilter] = useState("all");

  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [roleDraft, setRoleDraft] = useState<PermissionKey[]>([]);
  const [roleDirty, setRoleDirty] = useState(false);
  const [permissionSearch, setPermissionSearch] = useState("");

  const [selectedOverrideUserId, setSelectedOverrideUserId] = useState("");
  const [overrideDraft, setOverrideDraft] = useState<PermissionOverride>({ allow: [], deny: [] });
  const [overrideDirty, setOverrideDirty] = useState(false);
  const [overrideSearch, setOverrideSearch] = useState("");
  const [userPickerOpen, setUserPickerOpen] = useState(false);
  const [userPickerSearch, setUserPickerSearch] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const [userModal, setUserModal] = useState<"create" | "edit" | null>(null);
  const [editingUserId, setEditingUserId] = useState("");
  const [userForm, setUserForm] = useState({ username: "", fullName: "", role: "", status: "active" as "active" | "inactive", password: "", confirmPassword: "", mustChangePassword: true });
  const [userFormErrors, setUserFormErrors] = useState<Record<string, string>>({});

  const [passwordModalUserId, setPasswordModalUserId] = useState("");
  const [passwordForm, setPasswordForm] = useState({ password: "", confirmPassword: "", mustChangePassword: true });
  const [passwordFormError, setPasswordFormError] = useState("");

  const [roleModalOpen, setRoleModalOpen] = useState(false);
  const [roleForm, setRoleForm] = useState({ name: "", description: "" });
  const [roleFormError, setRoleFormError] = useState("");

  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const [workers, setWorkers] = useState<WorkerRow[] | null>(null);
  const [machines, setMachines] = useState<MachineRow[] | null>(null);
  const [periods, setPeriods] = useState<PeriodRow[] | null>(null);
  const [auditRows, setAuditRows] = useState<AuditRow[] | null>(null);
  const [resourceStatus, setResourceStatus] = useState<Record<string, "idle" | "loading" | "done" | "error">>({});
  const [resourceError, setResourceError] = useState<Record<string, string>>({});

  const hasUnsaved = roleDirty || overrideDirty;
  const remote = useRemoteSettings;

  const apiRequest = useCallback(
    async <T,>(path: string, init: RequestInit | undefined, fallback: T): Promise<T> => {
      if (!remote) return fallback;
      return settingsRequest<T>(path, init);
    },
    [remote],
  );

  const selectedRole = useMemo(() => roles.find((item) => item.id === selectedRoleId) || null, [roles, selectedRoleId]);
  const selectedOverrideUser = useMemo(() => users.find((item) => item.id === selectedOverrideUserId) || null, [users, selectedOverrideUserId]);

  const showNotice = useCallback((tone: "success" | "error" | "info", text: string) => {
    setNotice({ tone, text });
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!useRemoteSettings || !isMaster) return;
    let active = true;
    setLoadError("");
    Promise.all([
      settingsRequest<{ users: ServerUserRow[] }>("/api/users"),
      settingsRequest<{ roles: ServerRoleRow[] }>("/api/roles"),
    ])
      .then(([usersPayload, rolesPayload]) => {
        if (!active) return;
        const nextUsers = usersPayload.users.map(userFromServer);
        const nextRoles = rolesPayload.roles.map(roleFromServer);
        setUsers(nextUsers);
        setRoles(nextRoles);
        localStorage.setItem(managedUsersKey, JSON.stringify(nextUsers));
        localStorage.setItem(managedRolesKey, JSON.stringify(nextRoles));
      })
      .catch((error: unknown) => {
        if (active) setLoadError(error instanceof Error ? error.message : "تعذر تحميل بيانات المستخدمين من الخادم");
      });
    return () => {
      active = false;
    };
  }, [useRemoteSettings, isMaster]);

  useEffect(() => {
    if (!selectedRole) return;
    setRoleDraft(selectedRole.permissions);
    setRoleDirty(false);
  }, [selectedRoleId, selectedRole?.id]);

  useEffect(() => {
    if (!selectedOverrideUser) return;
    setOverrideDraft(normalizeOverride(selectedOverrideUser.permissionOverrides));
    setOverrideDirty(false);
  }, [selectedOverrideUserId, selectedOverrideUser?.id]);

  const persistUsers = useCallback((next: SettingsUser[]) => {
    setUsers(next);
    localStorage.setItem(managedUsersKey, JSON.stringify(next));
  }, []);

  const persistRoles = useCallback((next: SettingsRole[]) => {
    setRoles(next);
    localStorage.setItem(managedRolesKey, JSON.stringify(next));
  }, []);

  const loadedRef = useRef<Record<string, boolean>>({});
  const userPickerRef = useRef<HTMLDivElement>(null);

  const loadResource = useCallback(
    async (key: "workers" | "machines" | "periods" | "audit", force = false) => {
      if (!force && (loadedRef.current[key] || resourceStatus[key] === "loading")) return;
      loadedRef.current[key] = true;
      setResourceStatus((current) => ({ ...current, [key]: "loading" }));
      setResourceError((current) => ({ ...current, [key]: "" }));
      try {
        if (!remote) {
          // Browser-only mode has no API to call. Serve the host app's live data
          // so these sections resolve instead of spinning forever.
          if (key === "workers") {
            setWorkers((localWorkers || []) as WorkerRow[]);
          } else if (key === "machines") {
            setMachines((localMachines || []) as MachineRow[]);
          } else if (key === "periods") {
            setPeriods(localPeriodsFromAudit(readLocalAudit()));
          } else {
            setAuditRows(readLocalAudit().slice(0, 60) as AuditRow[]);
          }
          setResourceStatus((current) => ({ ...current, [key]: "done" }));
          return;
        }
        if (key === "workers") {
          const payload = await settingsRequest<{ workers: WorkerRow[] }>("/api/workers");
          setWorkers(payload.workers || []);
        } else if (key === "machines") {
          const payload = await settingsRequest<{ machines: MachineRow[] }>("/api/machines");
          setMachines(payload.machines || []);
        } else if (key === "periods") {
          const payload = await settingsRequest<{ periods: PeriodRow[] }>("/api/monthly-periods");
          setPeriods(payload.periods || []);
        } else {
          const payload = await settingsRequest<{ audit: AuditRow[] }>("/api/audit");
          setAuditRows((payload.audit || []).slice(0, 60));
        }
        setResourceStatus((current) => ({ ...current, [key]: "done" }));
      } catch (error: unknown) {
        loadedRef.current[key] = false;
        setResourceStatus((current) => ({ ...current, [key]: "error" }));
        setResourceError((current) => ({ ...current, [key]: error instanceof Error ? error.message : "تعذر تحميل البيانات" }));
      }
    },
    [remote, localWorkers, localMachines, resourceStatus],
  );

  const reloadResources = useCallback(() => {
    loadedRef.current = {};
    setResourceStatus({});
    setWorkers(null);
    setMachines(null);
    setPeriods(null);
    setAuditRows(null);
  }, []);

  const filteredPermissionGroups = useMemo(() => {
    const needle = normalizeText(permissionSearch);
    if (!needle) return permissionGroups;
    return permissionGroups
      .map((group) => ({
        ...group,
        permissions: group.permissions.filter((permission) => `${group.group} ${permission.label} ${permission.action} ${permission.key}`.toLowerCase().includes(needle)),
      }))
      .filter((group) => group.permissions.length > 0);
  }, [permissionGroups, permissionSearch]);

  const filteredUsers = useMemo(() => {
    const needle = normalizeText(usersSearch || query);
    return users.filter((user) => {
      const matchesText = !needle || `${user.username} ${user.fullName} ${user.email} ${user.role}`.toLowerCase().includes(needle);
      const matchesRole = usersRoleFilter === "all" || user.role === usersRoleFilter;
      const matchesStatus = usersStatusFilter === "all" || user.status === usersStatusFilter;
      return matchesText && matchesRole && matchesStatus;
    });
  }, [users, usersSearch, usersRoleFilter, usersStatusFilter, query]);

  const pickerUsers = useMemo(() => {
    const needle = normalizeText(userPickerSearch);
    if (!needle) return users;
    return users.filter((user) => normalizeText(`${user.fullName} ${user.username} ${user.role}`).includes(needle));
  }, [users, userPickerSearch]);

  const filteredModuleGroups = useMemo(() => {
    const needle = normalizeText(overrideSearch);
    return MODULE_GROUPS.map((group) => ({
      ...group,
      rows: needle ? group.keys.filter((key) => normalizeText(`${PERMISSION_LABELS[key] || key} ${key}`).includes(needle)) : group.keys,
    })).filter((group) => !needle || group.rows.length > 0 || normalizeText(`${group.label} ${group.hint}`).includes(needle));
  }, [overrideSearch]);

  const overrideSearchActive = normalizeText(overrideSearch).length > 0;

  useEffect(() => {
    if (!userPickerOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (userPickerRef.current && !userPickerRef.current.contains(event.target as Node)) setUserPickerOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setUserPickerOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [userPickerOpen]);

  const rolePermissionSet = useCallback((user: SettingsUser) => {
    if (user.role === "Master") return new Set<PermissionKey>(allPermissionKeys);
    const role = roles.find((item) => item.name === user.role);
    return new Set<PermissionKey>(role?.permissions || []);
  }, [roles]);

  const switchOverrideUser = (id: string) => {
    setUserPickerOpen(false);
    setUserPickerSearch("");
    if (id === selectedOverrideUserId) return;
    if (hasUnsaved) {
      setConfirm({ kind: "discard", payload: `override:${id}` });
      return;
    }
    setSelectedOverrideUserId(id);
  };

  const setOverrideMode = (permission: PermissionKey, mode: "inherit" | "allow" | "deny") => {
    setOverrideDraft((current) => {
      const allow = current.allow.filter((key) => key !== permission);
      const deny = current.deny.filter((key) => key !== permission);
      if (mode === "allow") allow.push(permission);
      if (mode === "deny") deny.push(permission);
      return { allow: allow.filter((key, index) => allow.indexOf(key) === index), deny: deny.filter((key, index) => deny.indexOf(key) === index) };
    });
    setOverrideDirty(true);
  };

  const resetOverrideDraft = () => {
    if (!selectedOverrideUser) return;
    setOverrideDraft(normalizeOverride(selectedOverrideUser.permissionOverrides));
    setOverrideDirty(false);
  };

  const toggleOverrideGroup = (id: string) => setCollapsedGroups((current) => ({ ...current, [id]: !(current[id] === undefined ? true : !current[id]) }));

  const isOverrideGroupOpen = (id: string) => overrideSearchActive || (collapsedGroups[id] === undefined ? true : !collapsedGroups[id]);

  const requestSection = useCallback(
    (next: SectionId) => {
      if (next === section) return;
      if (hasUnsaved) {
        setConfirm({ kind: "discard", payload: next });
        return;
      }
      setSection(next);
    },
    [hasUnsaved, section],
  );

  useEffect(() => {
    if (section === "resources" || section === "overview") {
      void loadResource("workers");
      void loadResource("machines");
    }
    if (section === "finance") void loadResource("periods");
    if (section === "security") void loadResource("audit");
  }, [section, loadResource]);

  const goToSection = useCallback(
    (next: SectionId) => {
      if (hasUnsaved) {
        setRoleDirty(false);
        setOverrideDirty(false);
      }
      setConfirm(null);
      setSection(next);
    },
    [hasUnsaved],
  );

  const openCreateUser = () => {
    setUserForm({ username: "", fullName: "", role: roles[0]?.name || "Operator", status: "active", password: "", confirmPassword: "", mustChangePassword: true });
    setUserFormErrors({});
    setEditingUserId("");
    setUserModal("create");
  };

  const openEditUser = (user: SettingsUser) => {
    setUserForm({ username: user.username, fullName: user.fullName, role: user.role, status: user.status, password: "", confirmPassword: "", mustChangePassword: user.mustChangePassword });
    setUserFormErrors({});
    setEditingUserId(user.id);
    setUserModal("edit");
  };

  const validateUserForm = () => {
    const errors: Record<string, string> = {};
    if (!userForm.username.trim()) errors.username = "اسم المستخدم مطلوب";
    if (!userForm.fullName.trim()) errors.fullName = "الاسم مطلوب";
    if (!userForm.role) errors.role = "يجب اختيار الدور";
    if (userModal === "create") {
      const username = userForm.username.trim().toLowerCase();
      if (username && users.some((user) => user.username === username)) errors.username = "اسم المستخدم مستخدم بالفعل";
      if (!userForm.password) errors.password = "كلمة المرور مطلوبة";
      else if (userForm.password.length < 4) errors.password = "كلمة المرور يجب ألا تقل عن 4 أحرف";
      if (userForm.password !== userForm.confirmPassword) errors.confirmPassword = "كلمتا المرور غير متطابقتين";
    }
    setUserFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const submitUser = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!validateUserForm()) return;
    const username = userForm.username.trim().toLowerCase();
    setBusy(userModal === "create" ? "user:create" : "user:edit");
    try {
      if (userModal === "create") {
        const payload = await apiRequest<{ user?: ServerUserRow }>("/api/users", {
          method: "POST",
          body: JSON.stringify({
            username,
            name: userForm.fullName.trim(),
            password: userForm.password,
            roleId: userForm.role,
            status: userForm.status,
            mustChangePassword: userForm.mustChangePassword,
            permissionOverrides: { allow: [], deny: [] },
          }),
        }, {});
        const created = payload.user ? userFromServer(payload.user) : buildLocalUser(username);
        persistUsers([created, ...users]);
        onAudit("USER_CREATED", "users", created.id, undefined, { username, role: created.role });
        showNotice("success", "تم إنشاء المستخدم بنجاح");
      } else {
        const target = users.find((user) => user.id === editingUserId);
        if (!target) throw new Error("تعذر العثور على المستخدم");
        await apiRequest(`/api/users/${encodeURIComponent(editingUserId)}`, {
          method: "PATCH",
          body: JSON.stringify({
            username,
            name: userForm.fullName.trim(),
            roleId: userForm.role,
            status: userForm.status,
            mustChangePassword: userForm.mustChangePassword,
          }),
        }, null);
        persistUsers(users.map((user) => (user.id === editingUserId ? { ...user, username, fullName: userForm.fullName.trim(), role: userForm.role, status: userForm.status, mustChangePassword: userForm.mustChangePassword } : user)));
        onAudit(userForm.role !== target.role ? "USER_ROLE_CHANGED" : "USER_UPDATED", "users", editingUserId, { role: target.role }, { role: userForm.role });
        showNotice("success", "تم تحديث بيانات المستخدم بنجاح");
      }
      setUserModal(null);
    } catch (error: unknown) {
      showNotice("error", error instanceof Error ? error.message : "تعذر حفظ بيانات المستخدم");
    } finally {
      setBusy(null);
    }
  };

  const buildLocalUser = (username: string): SettingsUser => ({
    id: `${Date.now()}-${username}`,
    username,
    fullName: userForm.fullName.trim(),
    email: `${username.replace(/\s+/g, ".")}@zunion.local`,
    role: userForm.role,
    password: userForm.password,
    status: userForm.status,
    mustChangePassword: userForm.mustChangePassword,
    permissionOverrides: { allow: [], deny: [] },
    createdAt: new Date().toISOString(),
  });

  const openPasswordModal = (user: SettingsUser) => {
    setPasswordModalUserId(user.id);
    setPasswordForm({ password: "", confirmPassword: "", mustChangePassword: true });
    setPasswordFormError("");
  };

  const submitPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    const target = users.find((user) => user.id === passwordModalUserId);
    if (!target) return;
    if (!passwordForm.password) return setPasswordFormError("كلمة المرور مطلوبة");
    if (passwordForm.password.length < 4) return setPasswordFormError("كلمة المرور يجب ألا تقل عن 4 أحرف");
    if (passwordForm.password !== passwordForm.confirmPassword) return setPasswordFormError("كلمتا المرور غير متطابقتين");
    setBusy("user:password");
    try {
      await apiRequest(`/api/users/${encodeURIComponent(target.id)}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ password: passwordForm.password, mustChangePassword: passwordForm.mustChangePassword }),
      }, null);
      persistUsers(users.map((user) => (user.id === target.id ? { ...user, password: "", mustChangePassword: passwordForm.mustChangePassword } : user)));
      onAudit("PASSWORD_RESET_BY_MASTER", "users", target.id, undefined, { username: target.username, mustChangePassword: passwordForm.mustChangePassword });
      showNotice("success", `تم تغيير كلمة مرور ${target.username} بنجاح`);
      setPasswordModalUserId("");
    } catch (error: unknown) {
      setPasswordFormError(error instanceof Error ? error.message : "تعذر تغيير كلمة المرور");
    } finally {
      setBusy(null);
    }
  };

  const applyUserStatus = async () => {
    if (confirm?.kind !== "status") return;
    const target = confirm.payload;
    const nextStatus = target.status === "active" ? "inactive" : "active";
    if (target.username === username) return showNotice("error", "لا يمكنك إيقاف حسابك الحالي");
    if (target.role === "Master" && target.status === "active" && activeMasterCount(users) <= 1) return showNotice("error", "لا يمكن إيقاف آخر حساب Master فعال");
    setBusy("user:status");
    try {
      await apiRequest(`/api/users/${encodeURIComponent(target.id)}/status`, { method: "PATCH", body: JSON.stringify({ status: nextStatus }) }, null);
      persistUsers(users.map((user) => (user.id === target.id ? { ...user, status: nextStatus } : user)));
      onAudit(nextStatus === "active" ? "USER_ACTIVATED" : "USER_DEACTIVATED", "users", target.id, { status: target.status }, { status: nextStatus });
      showNotice("success", nextStatus === "active" ? "تم تفعيل المستخدم" : "تم إيقاف المستخدم");
      setConfirm(null);
    } catch (error: unknown) {
      showNotice("error", error instanceof Error ? error.message : "تعذر تغيير حالة المستخدم");
    } finally {
      setBusy(null);
    }
  };

  const removeUser = async () => {
    if (confirm?.kind !== "deleteUser") return;
    const target = confirm.payload;
    if (target.username === username) return showNotice("error", "لا يمكنك حذف حسابك الحالي");
    if (target.role === "Master" && target.status === "active" && activeMasterCount(users) <= 1) return showNotice("error", "لا يمكن حذف آخر حساب Master فعال");
    setBusy("user:delete");
    try {
      await apiRequest(`/api/users/${encodeURIComponent(target.id)}`, { method: "DELETE" }, null);
      persistUsers(users.filter((user) => user.id !== target.id));
      onAudit("USER_DELETED", "users", target.id, { username: target.username }, undefined);
      showNotice("success", "تم حذف المستخدم");
      setConfirm(null);
    } catch (error: unknown) {
      showNotice("error", error instanceof Error ? error.message : "تعذر حذف المستخدم");
    } finally {
      setBusy(null);
    }
  };

  const createRole = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = roleForm.name.trim();
    if (!name) return setRoleFormError("اسم الدور مطلوب");
    if (roles.some((item) => normalizeText(item.name) === normalizeText(name))) return setRoleFormError("اسم الدور موجود بالفعل");
    setBusy("role:create");
    try {
      const payload = await apiRequest<{ role?: ServerRoleRow | ServerRoleRow[] }>("/api/roles", {
        method: "POST",
        body: JSON.stringify({ name, description: roleForm.description.trim(), status: "active", permissions: ["dashboard.view"] }),
        },
        {},
      );
      const serverRole = Array.isArray(payload.role) ? payload.role[0] : payload.role;
      const created: SettingsRole = serverRole
        ? roleFromServer(serverRole)
        : { id: `${Date.now()}-${name}`, name, description: roleForm.description.trim(), status: "active", permissions: ["dashboard.view"], isSystemRole: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      persistRoles([created, ...roles]);
      onAudit("ROLE_CREATED", "roles", created.id, undefined, { name });
      setRoleModalOpen(false);
      setRoleForm({ name: "", description: "" });
      setRoleFormError("");
      setSelectedRoleId(created.id);
      showNotice("success", "تم إنشاء الدور بنجاح");
    } catch (error: unknown) {
      setRoleFormError(error instanceof Error ? error.message : "تعذر إنشاء الدور");
    } finally {
      setBusy(null);
    }
  };

  const toggleDraftPermission = (permission: PermissionKey) => {
    setRoleDraft((current) => (current.includes(permission) ? current.filter((item) => item !== permission) : [...current, permission]));
    setRoleDirty(true);
  };

  const setGroupPermissions = (keys: PermissionKey[], enabled: boolean) => {
    setRoleDraft((current) => {
      const set = new Set(current);
      keys.forEach((key) => (enabled ? set.add(key) : set.delete(key)));
      return Array.from(set);
    });
    setRoleDirty(true);
  };

  const saveRolePermissions = async () => {
    if (!selectedRole) return;
    const isMasterRole = selectedRole.name === "Master";
    if (isMasterRole && !masterProtectedPermissions.every((key) => roleDraft.includes(key))) return showNotice("error", "لا يمكن إزالة صلاحيات الإدارة الأساسية من دور Master");
    if (!isMasterRole && roleDraft.includes("users.resetAllPasswords")) return showNotice("error", "صلاحية إعادة تعيين كل كلمات المرور محمية لدور Master فقط");
    setBusy("role:save");
    try {
      await apiRequest(`/api/roles/${encodeURIComponent(selectedRole.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ permissions: roleDraft }),
      }, null);
      persistRoles(roles.map((item) => (item.id === selectedRole.id ? { ...item, permissions: roleDraft, updatedAt: new Date().toISOString() } : item)));
      onAudit("ROLE_PERMISSIONS_CHANGED", "roles", selectedRole.id, { permissions: selectedRole.permissions }, { permissions: roleDraft });
      setRoleDirty(false);
      showNotice("success", `تم حفظ صلاحيات دور ${selectedRole.name}`);
    } catch (error: unknown) {
      showNotice("error", error instanceof Error ? error.message : "تعذر حفظ صلاحيات الدور");
    } finally {
      setBusy(null);
    }
  };

  const saveRoleMeta = async (patch: { description?: string; status?: "active" | "inactive" }) => {
    if (!selectedRole) return;
    if (selectedRole.name === "Master" && patch.status === "inactive") return showNotice("error", "لا يمكن إيقاف دور Master");
    setBusy("role:meta");
    try {
      await apiRequest(`/api/roles/${encodeURIComponent(selectedRole.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ description: patch.description ?? selectedRole.description, status: patch.status ?? selectedRole.status }),
      }, null);
      persistRoles(roles.map((item) => (item.id === selectedRole.id ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item)));
      onAudit("ROLE_UPDATED", "roles", selectedRole.id, { description: selectedRole.description, status: selectedRole.status }, patch);
      showNotice("success", "تم تحديث بيانات الدور");
    } catch (error: unknown) {
      showNotice("error", error instanceof Error ? error.message : "تعذر تحديث الدور");
    } finally {
      setBusy(null);
    }
  };

  const removeRole = async () => {
    if (confirm?.kind !== "deleteRole") return;
    const target = confirm.payload;
    if (target.name === "Master" || target.isSystemRole) return showNotice("error", "لا يمكن حذف الأدوار الأساسية");
    if (users.some((user) => user.role === target.name)) return showNotice("error", "لا يمكن حذف دور مرتبط بمستخدمين");
    setBusy("role:delete");
    try {
      await apiRequest(`/api/roles/${encodeURIComponent(target.id)}`, { method: "DELETE" }, null);
      persistRoles(roles.filter((item) => item.id !== target.id));
      onAudit("ROLE_DELETED", "roles", target.id, { name: target.name }, undefined);
      showNotice("success", "تم حذف الدور");
      setConfirm(null);
    } catch (error: unknown) {
      showNotice("error", error instanceof Error ? error.message : "تعذر حذف الدور");
    } finally {
      setBusy(null);
    }
  };

  const saveOverrides = async () => {
    if (!selectedOverrideUser) return;
    setBusy("override:save");
    try {
      await apiRequest(`/api/users/${encodeURIComponent(selectedOverrideUser.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ permissionOverrides: overrideDraft }),
      }, null);
      persistUsers(users.map((user) => (user.id === selectedOverrideUser.id ? { ...user, permissionOverrides: overrideDraft } : user)));
      onAudit("USER_PERMISSIONS_CHANGED", "users", selectedOverrideUser.id, { permissionOverrides: selectedOverrideUser.permissionOverrides }, { permissionOverrides: overrideDraft });
      setOverrideDirty(false);
      showNotice("success", `تم حفظ صلاحيات ${selectedOverrideUser.username}`);
    } catch (error: unknown) {
      showNotice("error", error instanceof Error ? error.message : "تعذر حفظ صلاحيات المستخدم");
    } finally {
      setBusy(null);
    }
  };

  const resetAllPasswords = async () => {
    setBusy("reset-all");
    try {
      const typed = window.prompt("سيتم تغيير كلمة مرور جميع المستخدمين النشطين إلى كلمة المرور الافتراضية، وتسجيل خروج الجلسة الحالية للأمان. لن يتم إجبار المستخدمين على تغييرها عند تسجيل الدخول القادم.\n\nاكتب RESET للتأكيد");
      if (typed !== RESET_ALL_CONFIRMATION) {
        setBusy(null);
        return;
      }
      if (!remote) {
        const activeTargets = users.filter((user) => user.status === "active");
        persistUsers(users.map((user) => (user.status === "active" ? { ...user, password: LOCAL_BULK_RESET_PASSWORD, mustChangePassword: false } : user)));
        onAudit("BULK_PASSWORD_RESET", "users", undefined, undefined, { actingMaster: username, affectedUsers: activeTargets.length });
        setConfirm(null);
        showNotice("success", `تمت إعادة تعيين كلمات مرور ${activeTargets.length} مستخدم. يجب تسجيل الدخول مرة أخرى.`);
        localStorage.removeItem(sessionKey);
        window.setTimeout(() => window.location.reload(), 900);
        return;
      }
      const payload = await settingsRequest<{ affectedUsers: number }>("/api/users/reset-all-passwords", {
        method: "POST",
        body: JSON.stringify({ confirmation: typed }),
      });
      onAudit("BULK_PASSWORD_RESET", "users", undefined, undefined, { actingMaster: username, affectedUsers: payload.affectedUsers });
      setConfirm(null);
      showNotice("success", `تمت إعادة تعيين كلمات مرور ${payload.affectedUsers} مستخدم. يجب تسجيل الدخول مرة أخرى.`);
      localStorage.removeItem(sessionKey);
      window.setTimeout(() => window.location.reload(), 900);
    } catch (error: unknown) {
      showNotice("error", error instanceof Error ? error.message : "تعذر إعادة تعيين كلمات المرور");
    } finally {
      setBusy(null);
    }
  };

  const sectionMatchCount = useCallback(
    (id: SectionId): number => {
      const needle = normalizeText(query);
      if (!needle) return -1;
      if (id === "users") return filteredUsers.length;
      if (id === "roles") return roles.filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(needle)).length;
      if (id === "overrides") return users.filter((item) => `${item.username} ${item.fullName}`.toLowerCase().includes(needle)).length;
      if (id === "departments") {
        return [...Object.entries(WORKER_DEPARTMENT_LABELS), ...QUEUE_CHANNELS.map((channel) => [channel.id, channel.label] as [string, string])].filter(([, label]) => label.toLowerCase().includes(needle)).length;
      }
      if (id === "resources") return (workers || []).filter((item) => item.name.toLowerCase().includes(needle)).length + (machines || []).filter((item) => item.name.toLowerCase().includes(needle)).length;
      if (id === "finance") return PAYMENT_METHODS.filter((item) => item.label.toLowerCase().includes(needle)).length;
      if (id === "security") return (auditRows || []).filter((item) => `${AUDIT_ACTION_LABELS[item.action] || item.action} ${item.entity_type || ""}`.toLowerCase().includes(needle)).length;
      if (id === "overview") return users.filter((item) => `${item.username} ${item.fullName} ${item.role}`.toLowerCase().includes(needle)).length + roles.filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(needle)).length;
      return 0;
    },
    [query, filteredUsers, roles, users, workers, machines, auditRows],
  );

  if (!isMaster) {
    return (
      <div className="settings-page">
        <header className="settings-header">
          <div>
            <h1>الإعدادات</h1>
            <p className="muted">تعديل كلمة المرور والحساب الخاص بك</p>
          </div>
        </header>
        <section className="settings-card">
          <div className="settings-card-head">
            <h2>حسابي</h2>
            <StatusBadge status="active" />
          </div>
          <div className="settings-kv">
            <div>
              <span className="muted">اسم المستخدم</span>
              <strong>{username}</strong>
            </div>
            <div>
              <span className="muted">الدور</span>
              <strong>{role}</strong>
            </div>
          </div>
          <p className="muted">إدارة المستخدمين والأدوار متاحة لدور Master فقط.</p>
        </section>
        <section className="settings-card">{accountPanel}</section>
      </div>
    );
  }

  const visibleSections = SECTIONS.filter((item) => {
    const count = sectionMatchCount(item.id);
    return count !== 0;
  });

  const renderOverview = () => {
    const activeUsers = users.filter((user) => user.status === "active").length;
    const inactiveUsers = users.length - activeUsers;
    const activeWorkers = (workers || []).filter((item) => item.active).length;
    const activeMachines = (machines || []).filter((item) => item.active).length;
    const cards = [
      { label: "إجمالي المستخدمين", value: users.length, icon: Users, tone: "blue" },
      { label: "حسابات مفعلة", value: activeUsers, icon: Check, tone: "green" },
      { label: "حسابات موقوفة", value: inactiveUsers, icon: Ban, tone: "gray" },
      { label: "حسابات Master فعالة", value: activeMasterCount(users), icon: ShieldCheck, tone: "violet" },
      { label: "الأدوار", value: roles.length, icon: KeyRound, tone: "amber" },
      { label: "العمال المسجلون", value: workers === null ? "—" : activeWorkers, icon: Factory, tone: "blue" },
      { label: "الماكينات المعتمدة", value: machines === null ? "—" : activeMachines, icon: Cpu, tone: "green" },
      { label: "فترات شهرية مفتوحة", value: periods === null ? "—" : periods.length, icon: WalletCards, tone: "amber" },
    ];
    return (
      <>
        {loadError ? (
          <div className="settings-alert error">
            <CircleAlert size={18} />
            <span>{loadError}</span>
          </div>
        ) : null}
        <section className="settings-card">
          <div className="settings-card-head">
            <div>
              <h2>نظرة عامة</h2>
              <p className="muted">ملخص مباشر لحالة الإدارة. لا يتم عرض أي كلمات مرور هنا.</p>
            </div>
          </div>
          <div className="settings-stat-grid">
            {cards.map((card) => {
              const Icon = card.icon;
              return (
                <div className="settings-stat" key={card.label}>
                  <span className={`settings-stat-icon ${card.tone}`}>
                    <Icon size={20} />
                  </span>
                  <div>
                    <strong>{card.value}</strong>
                    <span className="muted">{card.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
        <section className="settings-card">
          <div className="settings-card-head">
            <div>
              <h2>حالة الأمان</h2>
              <p className="muted">ملخص سريع لوضع حماية الحسابات والإدارة.</p>
            </div>
          </div>
          <SecuritySummary users={users} username={username} />
        </section>
      </>
    );
  };

  const renderUsers = () => (
    <section className="settings-card">
      <div className="settings-card-head">
        <div>
          <h2>إدارة المستخدمين</h2>
          <p className="muted">{filteredUsers.length} من {users.length} مستخدم</p>
        </div>
        {capabilities.createUsers ? (
          <button type="button" className="primary-btn" onClick={openCreateUser}>
            <UserPlus size={18} />
            مستخدم جديد
          </button>
        ) : null}
      </div>
      <div className="settings-toolbar">
        <label className="settings-search">
          <Search size={18} />
          <input placeholder="ابحث باسم المستخدم أو الاسم أو الدور" value={usersSearch} onChange={(event) => setUsersSearch(event.target.value)} />
        </label>
        <select value={usersRoleFilter} onChange={(event) => setUsersRoleFilter(event.target.value)}>
          <option value="all">كل الأدوار</option>
          {roles.map((item) => (
            <option key={item.id} value={item.name}>
              {item.name}
            </option>
          ))}
        </select>
        <select value={usersStatusFilter} onChange={(event) => setUsersStatusFilter(event.target.value)}>
          <option value="all">كل الحالات</option>
          <option value="active">مفعل</option>
          <option value="inactive">موقوف</option>
        </select>
      </div>
      {filteredUsers.length === 0 ? (
        <EmptyState icon={Users} title="لا يوجد مستخدمون مطابقون" hint="جرّب تعديل البحث أو الفلاتر." />
      ) : (
        <div className="table-wrap settings-table">
          <table>
            <thead>
              <tr>
                <th>المستخدم</th>
                <th>الدور</th>
                <th>الحالة</th>
                <th>الصلاحيات المخصصة</th>
                <th>آخر دخول</th>
                <th>الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => {
                const isSelf = user.username === username;
                const isLastMaster = user.role === "Master" && user.status === "active" && activeMasterCount(users) <= 1;
                return (
                  <tr key={user.id}>
                    <td>
                      <div className="settings-user-cell">
                        <strong>{user.fullName}</strong>
                        <span className="muted">{user.username}</span>
                      </div>
                    </td>
                    <td>{user.role}</td>
                    <td>
                      <div className="settings-inline">
                        <StatusBadge status={user.status} />
                        {isSelf ? <span className="badge badge-blue">حسابك</span> : null}
                      </div>
                    </td>
                    <td>
                      {user.permissionOverrides.allow.length + user.permissionOverrides.deny.length === 0 ? (
                        <span className="muted">حسب الدور فقط</span>
                      ) : (
                        <div className="settings-inline">
                          {user.permissionOverrides.allow.length ? <span className="badge badge-green">منح {user.permissionOverrides.allow.length}</span> : null}
                          {user.permissionOverrides.deny.length ? <span className="badge badge-red">منع {user.permissionOverrides.deny.length}</span> : null}
                        </div>
                      )}
                    </td>
                    <td className="muted">{user.lastLoginAt ? formatDateTimeEnglish(user.lastLoginAt) : "لم يسجل الدخول"}</td>
                    <td>
                      <div className="settings-row-actions">
                        {capabilities.editUsers ? (
                          <button type="button" className="ghost-btn compact" onClick={() => openEditUser(user)} aria-label={`تعديل ${user.username}`}>
                            <Pencil size={16} />
                            تعديل
                          </button>
                        ) : null}
                        {capabilities.resetPassword ? (
                          <button type="button" className="ghost-btn compact" onClick={() => openPasswordModal(user)} aria-label={`تغيير كلمة مرور ${user.username}`}>
                            <KeyRound size={16} />
                            كلمة المرور
                          </button>
                        ) : null}
                        {capabilities.deactivateUsers ? (
                          <button
                            type="button"
                            className="ghost-btn compact"
                            disabled={isSelf || isLastMaster}
                            title={isLastMaster ? "لا يمكن إيقاف آخر حساب Master فعال" : isSelf ? "لا يمكنك إيقاف حسابك" : undefined}
                            onClick={() => setConfirm({ kind: "status", payload: user })}
                          >
                            {user.status === "active" ? "إيقاف" : "تفعيل"}
                          </button>
                        ) : null}
                        {capabilities.deleteUsers ? (
                          <button
                            type="button"
                            className="primary-btn compact danger"
                            disabled={isSelf || isLastMaster}
                            title={isLastMaster ? "لا يمكن حذف آخر حساب Master فعال" : isSelf ? "لا يمكنك حذف حسابك" : undefined}
                            onClick={() => setConfirm({ kind: "deleteUser", payload: user })}
                          >
                            <Trash2 size={16} />
                            حذف
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );

  const renderRoles = () => (
    <>
      <section className="settings-card">
        <div className="settings-card-head">
          <div>
            <h2>الأدوار والصلاحيات</h2>
            <p className="muted">اختر دورًا من القائمة لتعديل صلاحياته. لا يتم تعديل أي دور آخر.</p>
          </div>
          {capabilities.createRoles ? (
            <button type="button" className="primary-btn" onClick={() => setRoleModalOpen(true)}>
              <Plus size={18} />
              دور جديد
            </button>
          ) : null}
        </div>
        <div className="settings-role-layout">
          <div className="settings-role-list">
            {roles.map((item) => (
              <button
                type="button"
                key={item.id}
                className={`settings-role-item${item.id === selectedRoleId ? " active" : ""}`}
                onClick={() => {
                  if (item.id === selectedRoleId) return;
                  if (hasUnsaved) {
                    setConfirm({ kind: "discard", payload: `role:${item.id}` });
                    return;
                  }
                  setSelectedRoleId(item.id);
                }}
              >
                <div>
                  <strong>{item.name}</strong>
                  <span className="muted">{item.description || "بدون وصف"}</span>
                </div>
                <div className="settings-inline">
                  <span className="badge badge-gray">{item.permissions.length} صلاحية</span>
                  <StatusBadge status={item.status} />
                </div>
              </button>
            ))}
          </div>
          <div className="settings-role-editor">
            {!selectedRole ? (
              <EmptyState icon={ShieldCheck} title="اختر دورًا" hint="اختر دورًا من القائمة لعرض صلاحياته." />
            ) : (
              <>
                <div className="settings-editor-head">
                  <div>
                    <h3>{selectedRole.name}</h3>
                    <p className="muted">{roleDraft.length} من {allPermissionKeys.length} صلاحية</p>
                  </div>
                  <div className="settings-row-actions">
                    {capabilities.editRoles ? (
                      <button type="button" className="ghost-btn compact" onClick={() => saveRoleMeta({ status: selectedRole.status === "active" ? "inactive" : "active" })} disabled={selectedRole.name === "Master" || busy === "role:meta"}>
                        {selectedRole.status === "active" ? "إيقاف الدور" : "تفعيل الدور"}
                      </button>
                    ) : null}
                    {capabilities.deleteRoles && !selectedRole.isSystemRole ? (
                      <button type="button" className="primary-btn compact danger" onClick={() => setConfirm({ kind: "deleteRole", payload: selectedRole })}>
                        <Trash2 size={16} />
                        حذف
                      </button>
                    ) : null}
                  </div>
                </div>
                {selectedRole.name === "Master" ? <div className="settings-alert info"><ShieldCheck size={18} /><span>دور Master محمي: لا يمكن إزالة صلاحيات الإدارة الأساسية.</span></div> : null}
                <div className="settings-toolbar">
                  <label className="settings-search">
                    <Search size={18} />
                    <input placeholder="ابحث في الصلاحيات" value={permissionSearch} onChange={(event) => setPermissionSearch(event.target.value)} />
                  </label>
                  <button type="button" className="ghost-btn compact" onClick={() => setGroupPermissions(allPermissionKeys, true)}>
                    تحديد الكل
                  </button>
                  <button type="button" className="ghost-btn compact" onClick={() => setGroupPermissions(allPermissionKeys, false)} disabled={selectedRole.name === "Master"}>
                    إلغاء الكل
                  </button>
                </div>
                <div className="settings-permission-groups">
                  {filteredPermissionGroups.map((group) => {
                    const keys = group.permissions.map((permission) => permission.key);
                    const enabledCount = keys.filter((key) => roleDraft.includes(key)).length;
                    return (
                      <div className="settings-permission-group" key={group.group}>
                        <div className="settings-group-head">
                          <strong>{group.group}</strong>
                          <div className="settings-inline">
                            <span className="muted">
                              {enabledCount}/{keys.length}
                            </span>
                            <button type="button" className="ghost-btn compact" onClick={() => setGroupPermissions(keys, enabledCount < keys.length)}>
                              {enabledCount === keys.length ? "إلغاء القسم" : "تحديد القسم"}
                            </button>
                          </div>
                        </div>
                        {group.permissions.map((permission) => {
                          const isLocked = selectedRole.name === "Master" && masterProtectedPermissions.includes(permission.key);
                          return (
                            <label className="settings-permission-row" key={permission.key}>
                              <input type="checkbox" checked={roleDraft.includes(permission.key)} disabled={isLocked && !roleDraft.includes(permission.key)} onChange={() => toggleDraftPermission(permission.key)} />
                              <span className="settings-permission-label">{permission.label}</span>
                              <span className="muted">{permission.action}</span>
                              {isLocked ? <span className="badge badge-blue">محمية</span> : null}
                            </label>
                          );
                        })}
                      </div>
                    );
                  })}
                  {filteredPermissionGroups.length === 0 ? <EmptyState icon={Search} title="لا توجد نتائج" hint="جرّب كلمة بحث أخرى." /> : null}
                </div>
                <div className="settings-save-bar">
                  <span className="muted">{roleDirty ? "لديك تغييرات غير محفوظة" : "محفوظ"}</span>
                  <div className="settings-row-actions">
                    <button type="button" className="ghost-btn" onClick={() => { setRoleDraft(selectedRole.permissions); setRoleDirty(false); }} disabled={!roleDirty}>
                      <RefreshCw size={16} />
                      تراجع
                    </button>
                    <button type="button" className="primary-btn" onClick={saveRolePermissions} disabled={!roleDirty || !capabilities.editRoles || busy === "role:save"}>
                      {busy === "role:save" ? <Loader2 size={18} className="spin" /> : <Check size={18} />}
                      حفظ الصلاحيات
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </section>
    </>
  );

  const renderOverrides = () => {
    const saving = busy === "override:save";
    const canEdit = capabilities.managePermissions && !saving;
    const inheritedSet = selectedOverrideUser ? rolePermissionSet(selectedOverrideUser) : new Set<PermissionKey>();
    const overrideEffective = selectedOverrideUser ? effectivePermissionsFor({ ...selectedOverrideUser, permissionOverrides: overrideDraft }, roles) : new Set<PermissionKey>();
    const matchCount = filteredModuleGroups.reduce((total, group) => total + group.rows.length, 0);
    const selectedRole = roles.find((role) => role.name === selectedOverrideUser?.role) || null;

    return (
      <section className="settings-card settings-overrides">
        <div className="settings-card-head settings-overrides-head">
          <div>
            <h2>صلاحيات المستخدمين</h2>
            <p className="muted">صلاحيات مخصصة تطبّق على مستخدم واحد فوق صلاحيات دوره. المنع أقوى من المنح، و«حسب الدور» يرجّع الصلاحية إلى الدور.</p>
          </div>
          <div className="settings-overrides-user">
            <label className="settings-field">
              <span>اختر المستخدم</span>
              <div className="settings-combo" ref={userPickerRef}>
                <button
                  type="button"
                  className={`settings-combo-trigger${userPickerOpen ? " open" : ""}`}
                  onClick={() => setUserPickerOpen((open) => !open)}
                  aria-expanded={userPickerOpen}
                  aria-haspopup="listbox"
                  disabled={!users.length}
                >
                  <span className={selectedOverrideUser ? "" : "placeholder"}>
                    {selectedOverrideUser ? `${selectedOverrideUser.fullName} — ${selectedOverrideUser.username}` : users.length ? "اختر المستخدم" : "لا يوجد مستخدمون"}
                  </span>
                  <ChevronDown size={18} />
                </button>
                {userPickerOpen ? (
                  <div className="settings-combo-panel">
                    <label className="settings-combo-search">
                      <Search size={16} />
                      <input autoFocus placeholder="ابحث بالاسم أو اسم المستخدم أو الدور" value={userPickerSearch} onChange={(event) => setUserPickerSearch(event.target.value)} />
                    </label>
                    <div className="settings-combo-list">
                      {pickerUsers.map((item) => (
                        <button
                          type="button"
                          key={item.id}
                          className={`settings-combo-option${item.id === selectedOverrideUserId ? " active" : ""}`}
                          onClick={() => switchOverrideUser(item.id)}
                          role="option"
                          aria-selected={item.id === selectedOverrideUserId}
                        >
                          <span className="settings-combo-option-name">{item.fullName}</span>
                          <span className="muted">{item.username}</span>
                          <span className="badge badge-gray">{item.role}</span>
                        </button>
                      ))}
                      {pickerUsers.length === 0 ? <p className="muted settings-combo-empty">لا يوجد مستخدمون مطابقون.</p> : null}
                    </div>
                  </div>
                ) : null}
              </div>
            </label>
            {selectedOverrideUser ? (
              <div className="settings-overrides-user-card">
                <div>
                  <strong>{selectedOverrideUser.fullName}</strong>
                  <span className="muted">{selectedOverrideUser.username}</span>
                </div>
                <div className="settings-overrides-user-meta">
                  <span className="badge badge-gray">الدور: {selectedOverrideUser.role}</span>
                  {selectedRole && !selectedRole.isSystemRole ? <span className="muted">{selectedRole.description || "دور مخصص"}</span> : null}
                  <span className={selectedOverrideUser.status === "active" ? "badge badge-green" : "badge badge-gray"}>
                    {selectedOverrideUser.status === "active" ? "نشط" : "موقوف"}
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {!selectedOverrideUser ? (
          <EmptyState icon={UserCog} title="اختر مستخدمًا" hint="اختر مستخدمًا من القائمة أعلاه لعرض صلاحياته المخصصة وتعديلها." />
        ) : (
          <>
            <div className="settings-overrides-toolbar">
              <label className="settings-search settings-search-wide">
                <Search size={18} />
                <input
                  placeholder="بحث عن صلاحية"
                  value={overrideSearch}
                  onChange={(event) => setOverrideSearch(event.target.value)}
                  aria-label="بحث عن صلاحية"
                />
                {overrideSearch ? (
                  <button type="button" className="settings-search-clear" onClick={() => setOverrideSearch("")} aria-label="مسح البحث">
                    <X size={16} />
                  </button>
                ) : null}
              </label>
              <div className="settings-overrides-toolbar-meta">
                <span className="muted">
                  {overrideSearchActive ? `${matchCount} صلاحية مطابقة` : `${allPermissionKeys.length} صلاحية في ${MODULE_GROUPS.length} أقسام`}
                </span>
                {overrideDraft.allow.length || overrideDraft.deny.length ? (
                  <button type="button" className="ghost-btn compact" onClick={() => { setOverrideDraft({ allow: [], deny: [] }); setOverrideDirty(true); }} disabled={!canEdit}>
                    مسح كل التخصيصات
                  </button>
                ) : null}
              </div>
            </div>

            <div className="settings-overrides-table-wrap">
              <table className="settings-overrides-table">
                <thead>
                  <tr>
                    <th scope="col">الصلاحية</th>
                    <th scope="col">صلاحية الدور</th>
                    <th scope="col">التخصيص للمستخدم</th>
                    <th scope="col">الصلاحية الفعلية</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredModuleGroups.map((group) => {
                    const open = isOverrideGroupOpen(group.id);
                    const governedBy = group.governedBy ? MODULE_GROUPS.find((item) => item.id === group.governedBy!.groupId) : null;
                    return (
                      <Fragment key={group.id}>
                        <tr className="settings-overrides-group-row">
                          <th colSpan={4} scope="colgroup">
                            <button type="button" className="settings-overrides-group-toggle" onClick={() => toggleOverrideGroup(group.id)} aria-expanded={open}>
                              <span className="settings-overrides-group-caret">{open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}</span>
                              <span className="settings-overrides-group-name">{group.label}</span>
                              <span className="settings-overrides-group-count">{group.rows.length} صلاحية</span>
                            </button>
                            <span className="settings-overrides-group-hint">{group.hint}</span>
                          </th>
                        </tr>
                        {open ? (
                          group.rows.length ? (
                            group.rows.map((permission) => {
                              const inherited = inheritedSet.has(permission);
                              const allowed = overrideDraft.allow.includes(permission);
                              const denied = overrideDraft.deny.includes(permission);
                              const mode: "inherit" | "allow" | "deny" = denied ? "deny" : allowed ? "allow" : "inherit";
                              const effective = denied ? false : allowed ? true : inherited;
                              return (
                                <tr key={permission} className="settings-overrides-row">
                                  <th scope="row" className="settings-overrides-permission">
                                    <span className="settings-overrides-permission-name">{PERMISSION_LABELS[permission] || permission}</span>
                                    <span className="settings-overrides-permission-key">{permission}</span>
                                  </th>
                                  <td>
                                    <span className={`settings-overrides-state ${inherited ? "is-allowed" : "is-denied"}`}>
                                      {inherited ? <Check size={16} /> : <Ban size={16} />}
                                      {inherited ? "مسموح" : "غير مسموح"}
                                    </span>
                                  </td>
                                  <td>
                                    <select
                                      className={`settings-overrides-select is-${mode}`}
                                      value={mode}
                                      disabled={!canEdit}
                                      aria-label={`تخصيص صلاحية ${PERMISSION_LABELS[permission] || permission}`}
                                      onChange={(event) => setOverrideMode(permission, event.target.value as "inherit" | "allow" | "deny")}
                                    >
                                      <option value="inherit">حسب الدور</option>
                                      <option value="allow">سماح</option>
                                      <option value="deny">منع</option>
                                    </select>
                                  </td>
                                  <td>
                                    <span className={`settings-overrides-state ${effective ? "is-allowed" : "is-denied"}`}>
                                      {effective ? <Check size={16} /> : <Ban size={16} />}
                                      {effective ? "مسموح" : "غير مسموح"}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })
                          ) : (
                            <tr className="settings-overrides-row settings-overrides-row-note">
                              <td colSpan={4}>
                                <p className="muted">{group.hint}</p>
                                {governedBy ? (
                                  <button
                                    type="button"
                                    className="ghost-btn compact"
                                    onClick={() => {
                                      setOverrideSearch("");
                                      setCollapsedGroups((current) => ({ ...current, [governedBy.id]: false }));
                                    }}
                                  >
                                    عرض صلاحيات {governedBy.label}
                                  </button>
                                ) : null}
                              </td>
                            </tr>
                          )
                        ) : null}
                      </Fragment>
                    );
                  })}
                  {filteredModuleGroups.length === 0 ? (
                    <tr className="settings-overrides-row">
                      <td colSpan={4}>
                        <EmptyState icon={Search} title="لا توجد صلاحيات مطابقة" hint="جرّب كلمة بحث أخرى أو امسح البحث لعرض كل الصلاحيات." />
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div className="settings-overrides-actionbar">
              <div className="settings-overrides-status">
                <span className={`settings-overrides-flag ${overrideDirty ? "is-dirty" : "is-clean"}`}>
                  {overrideDirty ? "لديك تغييرات غير محفوظة" : "كل التغييرات محفوظة"}
                </span>
                <span className="muted">
                  منح {overrideDraft.allow.length} • منع {overrideDraft.deny.length} • الصلاحيات المتاحة لهذا المستخدم {overrideEffective.size} من {allPermissionKeys.length}
                </span>
              </div>
              <div className="settings-row-actions">
                <button type="button" className="primary-btn" onClick={resetOverrideDraft} disabled={!overrideDirty || saving}>
                  <X size={18} />
                  إلغاء
                </button>
                <button type="button" className="primary-btn" onClick={saveOverrides} disabled={!overrideDirty || !canEdit || saving}>
                  {saving ? <Loader2 size={18} className="spin" /> : <Check size={18} />}
                  حفظ التغييرات
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    );
  };
  const renderDepartments = () => (
    <section className="settings-card">
      <div className="settings-card-head">
        <div>
          <h2>الأقسام وقنوات التشغيل</h2>
          <p className="muted">أقسام العمال المسجلة في النظام والقنوات المستخدمة في تشغيل الطوابير.</p>
        </div>
      </div>
      <h3 className="settings-subtitle">أقسام العمال</h3>
      <div className="settings-grid-cards">
        {Object.entries(WORKER_DEPARTMENT_LABELS).map(([key, label]) => {
          const count = (workers || []).filter((item) => item.department === key).length;
          const activeCount = (workers || []).filter((item) => item.department === key && item.active).length;
          return (
            <div className="settings-mini-card" key={key}>
              <div className="settings-mini-head">
                <Factory size={18} />
                <strong>{label}</strong>
                <span className="badge badge-gray">{key}</span>
              </div>
              <p className="muted">
                {workers === null ? "جارٍ التحميل..." : `${activeCount} فعال من ${count}`}
              </p>
            </div>
          );
        })}
      </div>
      <h3 className="settings-subtitle">قنوات التشغيل</h3>
      <div className="table-wrap settings-table">
        <table>
          <thead>
            <tr>
              <th>القناة</th>
              <th>المسار</th>
              <th>الصلاحية المفتاحية</th>
              <th>الأدوار المانحة</th>
            </tr>
          </thead>
          <tbody>
            {QUEUE_CHANNELS.map((channel) => {
              const Icon = channel.icon;
              const granting = roles.filter((item) => item.status === "active" && item.permissions.includes(channel.permission));
              return (
                <tr key={channel.id}>
                  <td>
                    <div className="settings-inline">
                      <Icon size={18} />
                      <strong>{channel.label}</strong>
                    </div>
                  </td>
                  <td className="muted">{channel.route}</td>
                  <td>
                    <span className="badge badge-violet">{channel.permission}</span>
                  </td>
                  <td>
                    {granting.length === 0 ? <span className="muted">لا يوجد</span> : granting.map((item) => <span className="badge badge-gray" key={item.id}>{item.name}</span>)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );

  const renderResources = () => {
    const error = resourceError.workers || resourceError.machines;
    return (
      <section className="settings-card">
        <div className="settings-card-head">
          <div>
            <h2>العمال والماكينات</h2>
            <p className="muted">سجلات النظام الفعلية. الإضافة والتعديل تتم من شاشات التشغيل والعمالة.</p>
          </div>
          <button
            type="button"
            className="ghost-btn compact"
            onClick={() => {
              reloadResources();
              void loadResource("workers", true);
              void loadResource("machines", true);
            }}
          >
            <RefreshCw size={16} />
            تحديث
          </button>
        </div>
        {error ? (
          <div className="settings-alert error">
            <CircleAlert size={18} />
            <span>{error}</span>
          </div>
        ) : null}
        <h3 className="settings-subtitle">العمال</h3>
        {workers === null ? (
          <div className="settings-loading">
            <Loader2 size={20} className="spin" />
            <span>جارٍ تحميل العمال...</span>
          </div>
        ) : workers.length === 0 ? (
          <EmptyState icon={Factory} title="لا يوجد عمال مسجلون" />
        ) : (
          <div className="table-wrap settings-table">
            <table>
              <thead>
                <tr>
                  <th>الاسم</th>
                  <th>القسم</th>
                  <th>الكارت</th>
                  <th>الهاتف</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {workers
                  .filter((item) => !query || item.name.toLowerCase().includes(normalizeText(query)))
                  .map((item) => (
                    <tr key={item.id}>
                      <td>{item.name}</td>
                      <td>{WORKER_DEPARTMENT_LABELS[item.department] || item.department}</td>
                      <td className="muted">{item.card_id || "-"}</td>
                      <td className="muted">{item.phone || "-"}</td>
                      <td>
                        <StatusBadge status={item.active ? "active" : "inactive"} />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
        <h3 className="settings-subtitle">الماكينات</h3>
        {machines === null ? (
          <div className="settings-loading">
            <Loader2 size={20} className="spin" />
            <span>جارٍ تحميل الماكينات...</span>
          </div>
        ) : machines.length === 0 ? (
          <EmptyState icon={Cpu} title="لا توجد ماكينات مسجلة" />
        ) : (
          <div className="settings-grid-cards">
            {machines
              .filter((item) => !query || item.name.toLowerCase().includes(normalizeText(query)))
              .map((item) => (
                <div className="settings-mini-card" key={item.id}>
                  <div className="settings-mini-head">
                    <Cpu size={18} />
                    <strong>{item.name}</strong>
                    <StatusBadge status={item.active ? "active" : "inactive"} />
                  </div>
                  <p className="muted">الترتيب: {item.position}</p>
                </div>
              ))}
          </div>
        )}
      </section>
    );
  };

  const renderFinance = () => (
    <section className="settings-card">
      <div className="settings-card-head">
        <div>
          <h2>الإعدادات المالية</h2>
          <p className="muted">طرق الدفع المتاحة في النظام والفترات الشهرية المفتوحة.</p>
        </div>
      </div>
      <h3 className="settings-subtitle">طرق الدفع</h3>
      <div className="settings-grid-cards">
        {PAYMENT_METHODS.filter((item) => !query || item.label.toLowerCase().includes(normalizeText(query))).map((item) => (
          <div className="settings-mini-card" key={item.value}>
            <div className="settings-mini-head">
              <WalletCards size={18} />
              <strong>{item.label}</strong>
              <span className="badge badge-gray">{item.value}</span>
            </div>
          </div>
        ))}
      </div>
      <h3 className="settings-subtitle">الفترات الشهرية</h3>
      {periods === null ? (
        <div className="settings-loading">
          <Loader2 size={20} className="spin" />
          <span>جارٍ تحميل الفترات...</span>
        </div>
      ) : periods.length === 0 ? (
        <EmptyState icon={WalletCards} title="لم يتم فتح أي فترة شهرية" />
      ) : (
        <div className="table-wrap settings-table">
          <table>
            <thead>
              <tr>
                <th>الشهر</th>
                <th>السنة</th>
                <th>ملاحظات</th>
              </tr>
            </thead>
            <tbody>
              {periods
                .filter((item) => !query || `${MONTH_NAMES[item.month - 1] || item.month} ${item.year}`.toLowerCase().includes(normalizeText(query)))
                .map((item) => (
                  <tr key={item.id}>
                    <td>{MONTH_NAMES[item.month - 1] || item.month}</td>
                    <td>{item.year}</td>
                    <td className="muted">{item.notes || "-"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );

  const renderSecurity = () => (
    <>
      <section className="settings-card">
        <div className="settings-card-head">
          <div>
            <h2>الأمان</h2>
            <p className="muted">إدارة كلمة المرور والحسابات النشطة.</p>
          </div>
        </div>
        {accountPanel}
        <SecuritySummary users={users} username={username} />
      </section>
      <section className="settings-card danger-zone">
        <div className="settings-card-head">
          <div>
            <h2>منطقة الخطر</h2>
            <p className="muted">إجراءات تؤثر على جميع المستخدمين.</p>
          </div>
        </div>
        <div className="settings-danger-zone">
          <div>
            <strong>إعادة تعيين كلمات مرور جميع المستخدمين</strong>
            <p className="muted">سيتم ضبط كلمة المرور إلى كلمة المرور الافتراضية للمستخدمين النشطين بدون إجبارهم على تغييرها عند تسجيل الدخول القادم.</p>
          </div>
          {capabilities.resetAllPasswords ? (
            <button type="button" className="primary-btn danger" onClick={() => setConfirm({ kind: "resetAll" })}>
              إعادة تعيين الكل
            </button>
          ) : null}
        </div>
      </section>
      <section className="settings-card">
        <div className="settings-card-head">
          <div>
            <h2>سجل الأمان</h2>
            <p className="muted">آخر 60 حدث أمني مسجل.</p>
          </div>
        </div>
        {resourceError.audit ? (
          <div className="settings-alert error">
            <CircleAlert size={18} />
            <span>{resourceError.audit}</span>
          </div>
        ) : null}
        {auditRows === null ? (
          <div className="settings-loading">
            <Loader2 size={20} className="spin" />
            <span>جارٍ تحميل السجل...</span>
          </div>
        ) : auditRows.length === 0 ? (
          <EmptyState icon={Gauge} title="لا توجد أحداث مسجلة" />
        ) : (
          <div className="table-wrap settings-table">
            <table>
              <thead>
                <tr>
                  <th>الحدث</th>
                  <th>النوع</th>
                  <th>الوقت</th>
                </tr>
              </thead>
              <tbody>
                {auditRows
                  .filter((item) => !query || `${AUDIT_ACTION_LABELS[item.action] || item.action} ${item.entity_type || ""}`.toLowerCase().includes(normalizeText(query)))
                  .map((item) => (
                    <tr key={item.id}>
                      <td>{AUDIT_ACTION_LABELS[item.action] || item.action}</td>
                      <td className="muted">{item.entity_type || "-"}</td>
                      <td className="muted">{item.created_at ? formatDateTimeEnglish(item.created_at) : "-"}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );

  const renderSection = (id: SectionId): ReactNode => {
    if (id === "overview") return renderOverview();
    if (id === "users") return renderUsers();
    if (id === "roles") return renderRoles();
    if (id === "overrides") return renderOverrides();
    if (id === "departments") return renderDepartments();
    if (id === "resources") return renderResources();
    if (id === "finance") return renderFinance();
    return renderSecurity();
  };

  return (
    <div className="settings-page" dir="rtl">
      <header className="settings-header">
        <div>
          <h1>الإعدادات</h1>
          <p className="muted">إدارة المستخدمين والأدوار والصلاحيات وإعدادات التشغيل</p>
        </div>
        <label className="settings-search wide">
          <Search size={18} />
          <input placeholder="ابحث في الإعدادات" value={query} onChange={(event) => setQuery(event.target.value)} />
          {query ? (
            <button type="button" className="settings-icon-btn" onClick={() => setQuery("")} aria-label="مسح البحث">
              <X size={16} />
            </button>
          ) : null}
        </label>
      </header>

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="أقسام الإعدادات">
          {visibleSections.map((item) => {
            const Icon = item.icon;
            const count = sectionMatchCount(item.id);
            return (
              <button type="button" key={item.id} className={`settings-nav-item${item.id === section ? " active" : ""}`} onClick={() => requestSection(item.id)}>
                <span className="settings-nav-icon">
                  <Icon size={20} />
                </span>
                <span className="settings-nav-copy">
                  <strong>{item.label}</strong>
                  <span className="muted">{item.description}</span>
                </span>
                {count >= 0 ? <span className="badge badge-gray">{count}</span> : null}
              </button>
            );
          })}
        </nav>
        <main className="settings-content">
          {notice ? (
            <div className={`settings-alert ${notice.tone}`}>
              {notice.tone === "success" ? <Check size={18} /> : <CircleAlert size={18} />}
              <span>{notice.text}</span>
              <button type="button" className="settings-icon-btn" onClick={() => setNotice(null)} aria-label="إغلاق">
                <X size={16} />
              </button>
            </div>
          ) : null}
          {renderSection(section)}
        </main>
      </div>

      {userModal === "create" || userModal === "edit" ? (
        <Modal
          title={userModal === "create" ? "مستخدم جديد" : `تعديل ${users.find((item) => item.id === editingUserId)?.username || ""}`}
          subtitle={userModal === "create" ? "سيتم إنشاء الحساب بكلمة المرور المحددة" : "تعديل بيانات الحساب الأساسية"}
          onClose={() => setUserModal(null)}
          footer={
            <>
              <button type="button" className="ghost-btn" onClick={() => setUserModal(null)} disabled={busy !== null}>
                إلغاء
              </button>
              <button type="submit" form="settings-user-form" className="primary-btn" disabled={busy !== null}>
                {busy ? <Loader2 size={18} className="spin" /> : <Check size={18} />}
                حفظ
              </button>
            </>
          }
        >
          <form id="settings-user-form" className="settings-form-grid" onSubmit={submitUser}>
            <label>
              اسم المستخدم
              <input value={userForm.username} onChange={(event) => setUserForm((current) => ({ ...current, username: event.target.value }))} />
              {userFormErrors.username ? <span className="settings-field-error">{userFormErrors.username}</span> : null}
            </label>
            <label>
              الاسم الكامل
              <input value={userForm.fullName} onChange={(event) => setUserForm((current) => ({ ...current, fullName: event.target.value }))} />
              {userFormErrors.fullName ? <span className="settings-field-error">{userFormErrors.fullName}</span> : null}
            </label>
            <label>
              الدور
              <select value={userForm.role} onChange={(event) => setUserForm((current) => ({ ...current, role: event.target.value }))}>
                {roles.map((item) => (
                  <option key={item.id} value={item.name}>
                    {item.name}
                  </option>
                ))}
              </select>
              {userFormErrors.role ? <span className="settings-field-error">{userFormErrors.role}</span> : null}
            </label>
            <label>
              الحالة
              <select value={userForm.status} onChange={(event) => setUserForm((current) => ({ ...current, status: event.target.value as "active" | "inactive" }))}>
                <option value="active">مفعل</option>
                <option value="inactive">موقوف</option>
              </select>
            </label>
            {userModal === "create" ? (
              <>
                <label>
                  كلمة المرور
                  <input type="password" value={userForm.password} onChange={(event) => setUserForm((current) => ({ ...current, password: event.target.value }))} />
                  {userFormErrors.password ? <span className="settings-field-error">{userFormErrors.password}</span> : null}
                </label>
                <label>
                  تأكيد كلمة المرور
                  <input type="password" value={userForm.confirmPassword} onChange={(event) => setUserForm((current) => ({ ...current, confirmPassword: event.target.value }))} />
                  {userFormErrors.confirmPassword ? <span className="settings-field-error">{userFormErrors.confirmPassword}</span> : null}
                </label>
              </>
            ) : null}
            <label className="settings-checkbox-row">
              <input type="checkbox" checked={userForm.mustChangePassword} onChange={(event) => setUserForm((current) => ({ ...current, mustChangePassword: event.target.checked }))} />
              إجبار تغيير كلمة المرور عند أول تسجيل دخول
            </label>
          </form>
        </Modal>
      ) : null}

      {passwordModalUserId ? (
        <Modal
          title="تغيير كلمة المرور"
          subtitle={users.find((item) => item.id === passwordModalUserId)?.username}
          onClose={() => setPasswordModalUserId("")}
          footer={
            <>
              <button type="button" className="ghost-btn" onClick={() => setPasswordModalUserId("")} disabled={busy !== null}>
                إلغاء
              </button>
              <button type="submit" form="settings-password-form" className="primary-btn" disabled={busy !== null}>
                {busy === "user:password" ? <Loader2 size={18} className="spin" /> : <Check size={18} />}
                حفظ
              </button>
            </>
          }
        >
          <form id="settings-password-form" className="settings-form-grid" onSubmit={submitPassword}>
            <label>
              كلمة المرور الجديدة
              <input type="password" value={passwordForm.password} onChange={(event) => setPasswordForm((current) => ({ ...current, password: event.target.value }))} />
            </label>
            <label>
              تأكيد كلمة المرور
              <input type="password" value={passwordForm.confirmPassword} onChange={(event) => setPasswordForm((current) => ({ ...current, confirmPassword: event.target.value }))} />
            </label>
            <label className="settings-checkbox-row">
              <input type="checkbox" checked={passwordForm.mustChangePassword} onChange={(event) => setPasswordForm((current) => ({ ...current, mustChangePassword: event.target.checked }))} />
              إجبار تغيير كلمة المرور عند أول تسجيل دخول
            </label>
            {passwordFormError ? (
              <div className="settings-alert error">
                <CircleAlert size={18} />
                <span>{passwordFormError}</span>
              </div>
            ) : null}
          </form>
        </Modal>
      ) : null}

      {roleModalOpen ? (
        <Modal
          title="دور جديد"
          subtitle="سيبدأ الدور بصلاحية لوحة المعلومات فقط"
          onClose={() => setRoleModalOpen(false)}
          footer={
            <>
              <button type="button" className="ghost-btn" onClick={() => setRoleModalOpen(false)} disabled={busy !== null}>
                إلغاء
              </button>
              <button type="submit" form="settings-role-form" className="primary-btn" disabled={busy !== null}>
                {busy === "role:create" ? <Loader2 size={18} className="spin" /> : <Check size={18} />}
                إنشاء
              </button>
            </>
          }
        >
          <form id="settings-role-form" className="settings-form-grid" onSubmit={createRole}>
            <label>
              اسم الدور
              <input value={roleForm.name} onChange={(event) => setRoleForm((current) => ({ ...current, name: event.target.value }))} />
            </label>
            <label>
              وصف الدور
              <input value={roleForm.description} onChange={(event) => setRoleForm((current) => ({ ...current, description: event.target.value }))} />
            </label>
            {roleFormError ? (
              <div className="settings-alert error">
                <CircleAlert size={18} />
                <span>{roleFormError}</span>
              </div>
            ) : null}
          </form>
        </Modal>
      ) : null}

      {confirm?.kind === "status" ? <ConfirmDialog title={confirm.payload.status === "active" ? "إيقاف المستخدم" : "تفعيل المستخدم"} message={`هل تريد ${confirm.payload.status === "active" ? "إيقاف" : "تفعيل"} حساب ${confirm.payload.username}؟`} confirmLabel={confirm.payload.status === "active" ? "إيقاف" : "تفعيل"} busy={busy === "user:status"} onConfirm={applyUserStatus} onCancel={() => setConfirm(null)} /> : null}
      {confirm?.kind === "deleteUser" ? <ConfirmDialog title="حذف المستخدم" message={`سيتم حذف حساب ${confirm.payload.username} نهائيًا. لا يمكن التراجع.`} confirmLabel="حذف" tone="danger" busy={busy === "user:delete"} onConfirm={removeUser} onCancel={() => setConfirm(null)} /> : null}
      {confirm?.kind === "deleteRole" ? <ConfirmDialog title="حذف الدور" message={`سيتم حذف دور ${confirm.payload.name} نهائيًا.`} confirmLabel="حذف" tone="danger" busy={busy === "role:delete"} onConfirm={removeRole} onCancel={() => setConfirm(null)} /> : null}
      {confirm?.kind === "resetAll" ? <ConfirmDialog title="إعادة تعيين كل كلمات المرور" message="سيتم تغيير كلمة مرور جميع المستخدمين النشطين إلى كلمة المرور الافتراضية وتسجيل خروجك. سيتم طلب تأكيد إضافي." confirmLabel="متابعة" tone="danger" busy={busy === "reset-all"} onConfirm={resetAllPasswords} onCancel={() => setConfirm(null)} /> : null}
      {confirm?.kind === "discard" ? (
        <ConfirmDialog
          title="تغييرات غير محفوظة"
          message="لديك تغييرات غير محفوظة في الصلاحيات. هل تريد المتابعة وفقدانها؟"
          confirmLabel="متابعة دون حفظ"
          tone="danger"
          onConfirm={() => {
            const payload = confirm.payload;
            if (typeof payload === "string" && payload.startsWith("role:")) {
              setRoleDirty(false);
              setSelectedRoleId(payload.slice(5));
            } else if (typeof payload === "string" && payload.startsWith("override:")) {
              setOverrideDirty(false);
              setSelectedOverrideUserId(payload.slice(9));
            } else {
              goToSection(payload as SectionId);
            }
            setConfirm(null);
          }}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
    </div>
  );
}

function SecuritySummary({ users, username }: { users: SettingsUser[]; username: string }) {
  const activeMasters = activeMasterCount(users);
  const withOverrides = users.filter((user) => user.permissionOverrides.allow.length + user.permissionOverrides.deny.length > 0).length;
  const mustChange = users.filter((user) => user.status === "active" && user.mustChangePassword).length;
  const items = [
    {
      label: "حسابات Master فعالة",
      value: activeMasters,
      danger: activeMasters <= 1,
      hint: activeMasters <= 1 ? "لا يمكن حذف أو إيقاف آخر حساب Master" : "",
    },
    { label: "مستخدمون بصلاحيات مخصصة", value: withOverrides, danger: false, hint: "" },
    { label: "حسابات عليها تغيير كلمة مرور", value: mustChange, danger: false, hint: "مستخدمون عليهم تغيير كلمة المرور عند أول دخول" },
    { label: "دورك الحالي", value: users.find((user) => user.username === username)?.role || "-", danger: false, hint: "" },
  ];
  return (
    <div className="settings-stat-grid">
      {items.map((item) => (
        <div className="settings-stat" key={item.label}>
          <span className={`settings-stat-icon ${item.danger ? "red" : "blue"}`}>{item.danger ? <CircleAlert size={20} /> : <ShieldCheck size={20} />}</span>
          <div>
            <strong>{item.value}</strong>
            <span className="muted">{item.label}</span>
            {item.hint ? <span className="settings-hint">{item.hint}</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}