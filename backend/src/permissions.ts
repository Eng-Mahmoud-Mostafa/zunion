export const permissionKeys = [
  "dashboard.view", "orders.view", "orders.create", "orders.edit", "orders.delete", "orders.print",
  "customers.view", "customers.create", "customers.edit", "customers.delete", "customers.print",
  "products.view", "products.create", "products.edit", "products.delete", "products.print",
  "search.use", "expenses.view", "expenses.create", "expenses.print", "revenues.view", "revenues.create", "revenues.print",
  "operation.view", "operation.update", "operation.upload", "operation.print",
  "finishing.view", "finishing.update", "finishing.upload", "finishing.print",
  "reports.view", "reports.print", "import.export",
  "users.view", "users.create", "users.edit", "users.deactivate", "users.delete", "users.resetPassword", "users.resetAllPasswords",
  "roles.view", "roles.create", "roles.edit", "roles.delete", "permissions.manage", "audit.view", "settings.view",
] as const;

export type PermissionKey = typeof permissionKeys[number];

export const masterPermissions = permissionKeys;

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
