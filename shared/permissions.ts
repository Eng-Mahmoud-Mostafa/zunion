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

export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === "string" && (permissionKeys as readonly string[]).includes(value);
}
