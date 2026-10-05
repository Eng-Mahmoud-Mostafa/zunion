export const permissionKeys = [
  "dashboard.view", "orders.view", "orders.create", "orders.edit", "orders.delete", "orders.print",
  "customers.view", "customers.create", "customers.edit", "customers.delete", "customers.print",
  "products.view", "products.create", "products.edit", "products.delete", "products.print",
  "search.use", "expenses.view", "expenses.create", "expenses.print", "revenues.view", "revenues.create", "revenues.print",
  "dailyAccounts.view", "salaries.view",
  "operation.view", "operation.update", "operation.upload", "operation.print",
  "finishing.view", "finishing.update", "finishing.upload", "finishing.print",
  "reports.view", "reports.print", "import.export",
  "users.view", "users.create", "users.edit", "users.deactivate", "users.delete", "users.resetPassword", "users.resetAllPasswords",
  "roles.view", "roles.create", "roles.edit", "roles.delete", "permissions.manage", "audit.view", "settings.view",
] as const;

export type PermissionKey = typeof permissionKeys[number];

export const allPermissionKeys: PermissionKey[] = [...permissionKeys];

export const masterProtectedPermissions: PermissionKey[] = [
  "users.view", "users.create", "users.edit", "users.deactivate", "users.delete", "users.resetPassword", "users.resetAllPasswords",
  "roles.view", "roles.create", "roles.edit", "roles.delete", "permissions.manage", "audit.view", "settings.view",
];

export const roleDefaultPermissions: Record<string, PermissionKey[]> = {
  Master: [...allPermissionKeys],
  Helper: [
    "dashboard.view", "orders.view", "orders.create", "orders.edit", "orders.print",
    "customers.view", "customers.create", "customers.edit", "customers.print",
    "products.view", "search.use", "import.export",
  ],
  Operator: [
    "dashboard.view",
    "orders.view", "orders.create", "orders.edit", "orders.print",
    "customers.view", "customers.create", "customers.edit", "customers.print",
    "products.view", "products.create", "products.edit", "products.print",
    "search.use",
    "operation.view", "operation.update", "operation.upload", "operation.print",
    "finishing.view", "finishing.update", "finishing.upload", "finishing.print",
    "reports.view", "reports.print", "import.export",
  ],
  Supervisor: [
    "dashboard.view",
    "orders.view", "orders.create", "orders.edit", "orders.print",
    "products.view", "products.create", "products.edit", "products.print",
    "search.use",
    "operation.view", "operation.update", "operation.upload", "operation.print",
    "reports.view", "reports.print", "import.export",
  ],
  Worker: [
    "dashboard.view", "orders.view", "orders.edit", "orders.print",
    "products.view",
    "operation.view", "operation.update", "operation.upload", "operation.print",
  ],
  Finishing: [
    "finishing.view", "finishing.update", "finishing.upload", "finishing.print",
  ],
  Finish: [
    "orders.view", "orders.edit", "orders.print",
    "finishing.view", "finishing.update", "finishing.upload", "finishing.print",
  ],
};

export function effectivePermissions(user: { role?: string; permission_overrides?: { allow?: unknown; deny?: unknown } }): PermissionKey[] {
  const base = new Set<PermissionKey>(roleDefaultPermissions[user.role ?? ""] ?? []);
  const overrides = user.permission_overrides ?? {};
  for (const value of Array.isArray(overrides.allow) ? overrides.allow : []) {
    if (isPermissionKey(value)) base.add(value);
  }
  for (const value of Array.isArray(overrides.deny) ? overrides.deny : []) {
    if (isPermissionKey(value)) base.delete(value);
  }
  return Array.from(base);
}

export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === "string" && (permissionKeys as readonly string[]).includes(value);
}

export function validatePermissions(values: unknown): PermissionKey[] {
  if (!Array.isArray(values)) return [];
  const unique = new Set<PermissionKey>();
  for (const value of values) {
    if (!isPermissionKey(value)) throw new Error(`Unknown permission: ${String(value)}`);
    unique.add(value);
  }
  return Array.from(unique);
}

export const MASTER_ROLE_NAME = "Master";

export type RoleUpdateIntent = {
  /** Name currently stored for the role. Never trust the incoming name here. */
  currentName: string;
  nextName?: string;
  status?: string;
  permissions?: PermissionKey[];
};

/**
 * Decides whether a role update may be applied.
 *
 * The Master checks deliberately key off `currentName`, not `nextName`.
 * Keying off the submitted name lets a caller rename Master to anything else in
 * the same request and thereby skip every protection below.
 *
 * Returns null when the update is allowed, or an error message when it is not.
 */
export function roleUpdateRejection(intent: RoleUpdateIntent): string | null {
  const submittedName = intent.nextName?.trim();
  const nextName = submittedName || intent.currentName;

  if (intent.currentName === MASTER_ROLE_NAME) {
    // Compare the trimmed submitted name directly. Falling back to currentName
    // here would let a whitespace-only name slip through and blank the role.
    if (intent.nextName !== undefined && submittedName !== MASTER_ROLE_NAME) {
      return "لا يمكن تغيير اسم دور Master";
    }
    if (intent.status === "inactive") {
      return "لا يمكن إيقاف دور Master";
    }
    if (intent.permissions) {
      const missing = masterProtectedPermissions.filter((key) => !intent.permissions!.includes(key));
      if (missing.length) return "لا يمكن إزالة صلاحيات الإدارة الأساسية من دور Master";
    }
  } else if (submittedName === MASTER_ROLE_NAME) {
    // Renaming a role to "Master" would grant it every permission via the
    // role-name lookup, so the name is reserved for the built-in role.
    return "اسم Master محجوز ولا يمكن نقله إلى دور آخر";
  }

  if (intent.permissions && nextName !== MASTER_ROLE_NAME && intent.permissions.includes("users.resetAllPasswords")) {
    return "صلاحية إعادة تعيين كل كلمات المرور محمية لدور Master فقط";
  }

  return null;
}

/** True when the name is reserved for the built-in Master role. */
export function isReservedRoleName(name: string): boolean {
  return name.trim() === MASTER_ROLE_NAME;
}
