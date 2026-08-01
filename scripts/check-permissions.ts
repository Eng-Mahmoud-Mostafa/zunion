import { allPermissionKeys, isPermissionKey, permissionKeys, roleDefaultPermissions, type PermissionKey } from "../shared/permissions";
import { permissionKeys as backendPermissionKeys } from "../backend/src/permissions";

let failures = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  PASS ${message}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${message}`);
  }
}

function assertSetEqual(label: string, actual: string[], expected: string[]) {
  const a = [...actual].sort();
  const b = [...expected].sort();
  assert(JSON.stringify(a) === JSON.stringify(b), `${label}: ${a.join(",")}`);
}

function hasAll(role: string, keys: PermissionKey[]) {
  const perms = roleDefaultPermissions[role] ?? [];
  return keys.every((key) => perms.includes(key));
}

function hasNone(role: string, keys: PermissionKey[]) {
  const perms = roleDefaultPermissions[role] ?? [];
  return keys.every((key) => !perms.includes(key));
}

console.log("== 1. Every default permission is a valid key ==");
for (const [role, perms] of Object.entries(roleDefaultPermissions)) {
  assert(perms.every((key) => isPermissionKey(key)), `${role} has only valid permission keys`);
}

console.log("== 2. Backend and shared key sets are identical ==");
assertSetEqual("permissionKeys vs backend permissionKeys", [...permissionKeys], [...backendPermissionKeys]);

console.log("== 3. Master (Reda/Hassan - Management): full access ==");
assertSetEqual("Master permissions", roleDefaultPermissions.Master, [...allPermissionKeys]);
assert(roleDefaultPermissions.Master.includes("dailyAccounts.view") && roleDefaultPermissions.Master.includes("salaries.view"), "Master has salaries + daily accounts");

console.log("== 4. Operator (Omar/Youssef/Khalifa/Opr 1-3): everything except Salaries + Daily Accounts ==");
const operatorHas: PermissionKey[] = [
  "dashboard.view",
  "orders.view", "orders.create", "orders.edit", "orders.print",
  "customers.view", "customers.create", "customers.edit", "customers.print",
  "products.view", "products.create", "products.edit", "products.print",
  "search.use",
  "operation.view", "operation.update", "operation.upload", "operation.print",
  "finishing.view", "finishing.update", "finishing.upload", "finishing.print",
  "reports.view", "reports.print", "import.export",
];
const operatorDenied: PermissionKey[] = [
  "orders.delete", "customers.delete", "products.delete",
  "expenses.view", "expenses.create", "expenses.print",
  "revenues.view", "revenues.create", "revenues.print",
  "dailyAccounts.view", "salaries.view",
  "users.view", "roles.view", "permissions.manage", "audit.view", "settings.view",
];
assert(hasAll("Operator", operatorHas), `Operator has ${operatorHas.join(", ")}`);
assert(hasNone("Operator", operatorDenied), `Operator denied ${operatorDenied.join(", ")}`);

console.log("== 5. Supervisor (Supervisor 1-3): everything except Salaries, Daily Accounts, Customer Accounts, Finishing ==");
const supervisorHas: PermissionKey[] = [
  "dashboard.view",
  "orders.view", "orders.create", "orders.edit", "orders.print",
  "products.view", "products.create", "products.edit", "products.print",
  "search.use",
  "operation.view", "operation.update", "operation.upload", "operation.print",
  "reports.view", "reports.print", "import.export",
];
const supervisorDenied: PermissionKey[] = [
  "orders.delete", "customers.delete", "products.delete",
  "customers.view", "customers.create", "customers.edit", "customers.print",
  "expenses.view", "revenues.view", "dailyAccounts.view", "salaries.view",
  "finishing.view", "finishing.update", "finishing.upload", "finishing.print",
  "users.view", "roles.view", "permissions.manage", "audit.view", "settings.view",
];
assert(hasAll("Supervisor", supervisorHas), `Supervisor has ${supervisorHas.join(", ")}`);
assert(hasNone("Supervisor", supervisorDenied), `Supervisor denied ${supervisorDenied.join(", ")}`);

console.log("== 6. Finishing (Finishing 1-2): finishing ONLY ==");
assertSetEqual("Finishing permissions", roleDefaultPermissions.Finishing, [
  "finishing.view", "finishing.update", "finishing.upload", "finishing.print",
]);
const finishingDenied: PermissionKey[] = [
  "dashboard.view", "orders.view", "orders.create", "orders.edit", "orders.delete", "orders.print",
  "customers.view", "products.view", "search.use",
  "expenses.view", "revenues.view", "dailyAccounts.view", "salaries.view",
  "operation.view", "operation.update", "operation.upload", "operation.print",
  "reports.view", "reports.print", "import.export",
  "users.view", "roles.view", "permissions.manage", "audit.view", "settings.view",
];
assert(hasNone("Finishing", finishingDenied), `Finishing denied ${finishingDenied.join(", ")}`);

console.log("== 7. Page-level visibility (route gates) ==");
const routePermissions: Record<string, PermissionKey | undefined> = {
  dashboard: "dashboard.view",
  orders: "orders.view",
  new: "orders.create",
  addCustomer: "customers.create",
  addProduct: "products.create",
  search: "orders.view",
  worker: "operation.view",
  finish: "finishing.view",
  customers: "customers.view",
  finance: "dailyAccounts.view",
  reports: "reports.view",
  import: "import.export",
  audit: "audit.view",
  settings: "settings.view",
  alerts: "orders.view",
};
const pages = ["dashboard", "orders", "new", "addCustomer", "addProduct", "search", "worker", "finish", "customers", "finance", "reports", "import", "audit", "settings", "alerts"];
const canPage = (role: string, page: string) => {
  const key = routePermissions[page];
  return !key || (roleDefaultPermissions[role] ?? []).includes(key);
};const expectPages = (role: string, allowed: string[]) => {
  const allowedSet = new Set(allowed);
  for (const page of pages) {
    assert(canPage(role, page) === allowedSet.has(page), `${role} page "${page}" ${allowedSet.has(page) ? "visible" : "hidden"}`);
  }
};
expectPages("Operator", ["dashboard", "orders", "new", "addCustomer", "addProduct", "search", "worker", "finish", "customers", "reports", "import", "alerts"]);
expectPages("Supervisor", ["dashboard", "orders", "new", "addProduct", "search", "worker", "reports", "import", "alerts"]);
expectPages("Finishing", ["finish"]);

console.log("\n" + (failures === 0 ? "ALL PERMISSION CHECKS PASSED" : `${failures} CHECK(S) FAILED`));
process.exit(failures === 0 ? 0 : 1);
