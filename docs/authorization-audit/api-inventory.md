# API authorization inventory

Static middleware inventory; an empty middleware field is a review flag, not proof of vulnerability. Handler-level checks and record scope must also be reviewed.

| Method | Route | Source line | Middleware |
|---|---|---|---|
| GET | "/api/health" | backend/src/server.ts:82 |  |
| GET | "/api/notifications" | backend/src/server.ts:631 | requireAuth |
| PATCH | "/api/notifications/read-all" | backend/src/server.ts:637 | requireAuth |
| PATCH | "/api/notifications/:id/read" | backend/src/server.ts:644 | requireAuth |
| POST | "/api/auth/login" | backend/src/server.ts:684 |  |
| POST | "/api/auth/change-password" | backend/src/server.ts:702 | requireAuth |
| GET | "/api/settings/admin-email" | backend/src/server.ts:765 | requireMasterSession |
| PUT | "/api/settings/admin-email" | backend/src/server.ts:770 | requireMasterSession |
| POST | "/api/auth/forgot-password" | backend/src/server.ts:799 |  |
| POST | "/api/auth/verify-reset-code" | backend/src/server.ts:841 |  |
| POST | "/api/auth/reset-password" | backend/src/server.ts:875 |  |
| POST | "/api/auth/mandatory-change-password" | backend/src/server.ts:931 |  |
| POST | "/api/auth/logout" | backend/src/server.ts:960 | requireAuth |
| GET | "/api/auth/me" | backend/src/server.ts:966 | requireAuth |
| GET | "/api/users" | backend/src/server.ts:984 | requireAppPermission("users.view") |
| POST | "/api/users" | backend/src/server.ts:1017 | requireAppPermission("users.create", "ليس لديك صلاحية لإضافة مستخدم") |
| PATCH | "/api/users/:id" | backend/src/server.ts:1220 | requireAppPermission("users.edit") |
| POST | "/api/users/:id/reset-password" | backend/src/server.ts:1251 | requireAppPermission("users.resetPassword") |
| POST | "/api/users/reset-all-passwords" | backend/src/server.ts:1266 | requireAppPermission("users.resetAllPasswords") |
| PATCH | "/api/users/:id/status" | backend/src/server.ts:1318 | requireAppPermission("users.deactivate") |
| DELETE | "/api/users/:id" | backend/src/server.ts:1342 | requireAppPermission("users.delete") |
| GET | "/api/roles" | backend/src/server.ts:1357 | requireAppPermission("roles.view") |
| POST | "/api/roles" | backend/src/server.ts:1372 | requireAppPermission("roles.create") |
| PATCH | "/api/roles/:id" | backend/src/server.ts:1393 | requireAppPermission("roles.edit") |
| DELETE | "/api/roles/:id" | backend/src/server.ts:1428 | requireAppPermission("roles.delete") |
| GET | "/api/orders" | backend/src/server.ts:1441 | requireAuth |
| GET | "/api/orders/archive" | backend/src/server.ts:1489 | requireAuth |
| POST | "/api/orders" | backend/src/server.ts:1520 | requireAuth; requireRole("Master", "Helper", "Operator", "Supervisor") |
| GET | "/api/orders/:id" | backend/src/server.ts:1596 | requireAuth |
| GET | "/api/orders/:id/qr" | backend/src/server.ts:1605 |  |
| GET | "/api/orders/:id/details" | backend/src/server.ts:1614 | requireAuth |
| PUT | "/api/orders/:id" | backend/src/server.ts:1637 | requireAuth; requireRole("Master", "Helper", "Operator", "Supervisor") |
| GET | "/api/orders/:id/history" | backend/src/server.ts:1729 | requireAuth |
| PATCH | "/api/orders/:id/machine" | backend/src/server.ts:1739 | requireAuth; requireRole("Master", "Helper", "Operator", "Supervisor", "Worker") |
| PATCH | "/api/orders/:id/worker" | backend/src/server.ts:1750 | requireAuth; requireRole("Master", "Helper", "Operator", "Supervisor", "Worker") |
| PATCH | "/api/orders/:id/staff" | backend/src/server.ts:1764 | requireAuth; requireRole("Master", "Helper", "Operator", "Supervisor", "Worker") |
| PATCH | "/api/orders/:id/problem" | backend/src/server.ts:1781 | requireAuth; requireRole("Master", "Helper", "Operator", "Supervisor", "Worker") |
| PATCH | "/api/orders/:id/sewing" | backend/src/server.ts:1792 | requireAuth; requireRole("Master", "Helper", "Operator", "Supervisor", "Worker") |
| PATCH | "/api/orders/:id/printing" | backend/src/server.ts:1810 | requireAuth; requireRole("Master", "Helper", "Operator", "Supervisor", "Worker") |
| GET | "/api/production/:stage/queue" | backend/src/server.ts:1834 | requireAuth; requireProductionPermission("operation.view") |
| PUT | "/api/production/:stage/queue" | backend/src/server.ts:1840 | requireAuth; requireProductionPermission("operation.update") |
| GET | "/api/production/:stage/archive" | backend/src/server.ts:1850 | requireAuth; requireProductionPermission("operation.view") |
| PATCH | "/api/orders/:id/complete-production" | backend/src/server.ts:1869 | requireAuth; requireProductionPermission("operation.update"); requireRole("Master", "Helper", "Operator", "Supervisor", "Worker") |
| PATCH | "/api/orders/:id/finishing" | backend/src/server.ts:1883 | requireAuth; requireRole("Master", "Helper", "Operator", "Supervisor", "Worker", "Finishing", "Finish") |
| GET | "/api/workers" | backend/src/server.ts:1917 | requireAuth |
| POST | "/api/workers" | backend/src/server.ts:1932 | requireAuth; requireRole("Master") |
| PATCH | "/api/workers/:id" | backend/src/server.ts:1955 | requireAuth; requireRole("Master") |
| DELETE | "/api/workers/:id" | backend/src/server.ts:1978 | requireAuth; requireRole("Master") |
| POST | "/api/attendance/preview" | backend/src/server.ts:2025 | requireAuth; requireRole(...ATTENDANCE_ROLES) |
| POST | "/api/attendance/import" | backend/src/server.ts:2032 | requireAuth; requireRole(...ATTENDANCE_ROLES) |
| GET | "/api/attendance/employees" | backend/src/server.ts:2045 | requireAuth |
| PATCH | "/api/orders/:id/status" | backend/src/server.ts:2054 | requireAuth |
| GET | "/api/machine-assignments" | backend/src/server.ts:2085 | requireAuth; requireProductionPermission("operation.view"); requireRole("Master", "Helper", "Operator", "Supervisor", "Worker", "Finishing", "Finish") |
| POST | "/api/machine-assignments" | backend/src/server.ts:2090 | requireAuth; requireProductionPermission("operation.update"); requireRole("Master", "Helper", "Operator", "Supervisor", "Worker") |
| PATCH | "/api/machine-assignments/reorder" | backend/src/server.ts:2111 | requireAuth; requireProductionPermission("operation.update"); requireRole("Master", "Helper", "Operator", "Supervisor", "Worker") |
| PATCH | "/api/machine-assignments/:id" | backend/src/server.ts:2125 | requireAuth; requireProductionPermission("operation.update"); requireRole("Master", "Helper", "Operator", "Supervisor", "Worker") |
| DELETE | "/api/machine-assignments/:id" | backend/src/server.ts:2138 | requireAuth; requireProductionPermission("operation.update"); requireRole("Master", "Helper", "Operator", "Supervisor", "Worker") |
| GET | "/api/machines" | backend/src/server.ts:2153 | requireAuth; requireRole("Master", "Helper", "Operator", "Supervisor", "Worker", "Finishing", "Finish") |
| POST | "/api/machines" | backend/src/server.ts:2162 | requireAuth; requireProductionPermission("operation.update"); requireRole("Master", "Helper", "Operator", "Supervisor") |
| PATCH | "/api/machines/:id" | backend/src/server.ts:2176 | requireAuth; requireProductionPermission("operation.update"); requireRole("Master", "Helper", "Operator", "Supervisor") |
| DELETE | "/api/machines/:id" | backend/src/server.ts:2198 | requireAuth; requireProductionPermission("operation.update"); requireRole("Master", "Helper", "Operator", "Supervisor") |
| GET | "/api/parties" | backend/src/server.ts:2216 | requireAuth |
| POST | "/api/parties" | backend/src/server.ts:2225 | requireAuth; requireRole("Master") |
| PATCH | "/api/parties/:id" | backend/src/server.ts:2241 | requireAuth; requireRole("Master") |
| DELETE | "/api/orders/:id" | backend/src/server.ts:2270 | requireAuth; requireRole("Master") |
| GET | "/api/orders/:id/print" | backend/src/server.ts:2279 | requireAuth; requireRole("Master", "Helper", "Operator", "Supervisor", "Worker", "Finishing", "Finish") |
| POST | "/api/orders/:id/files" | backend/src/server.ts:2292 | requireAuth; requireRole("Master", "Helper", "Operator", "Supervisor", "Worker", "Finishing", "Finish"); upload.array("files", 5) |
| GET | "/api/orders/:id/files/:fileId" | backend/src/server.ts:2314 | requireAuth |
| POST | "/api/uploads" | backend/src/server.ts:2322 | requireAuth; upload.single("file") |
| GET | "/api/photos/:id" | backend/src/server.ts:2343 | requireAuth |
| GET | "/api/files/:name" | backend/src/server.ts:2359 | requireAuth |
| GET | "/api/customers" | backend/src/server.ts:2367 | requireAuth; requireRole("Master", "Helper", "Operator") |
| POST | "/api/customers" | backend/src/server.ts:2381 | requireAuth; requireRole("Master", "Helper", "Operator") |
| GET | "/api/customers/:id" | backend/src/server.ts:2402 | requireAuth; requireRole("Master", "Helper", "Operator") |
| GET | "/api/customers/:id/details" | backend/src/server.ts:2409 | requireAuth; requireRole("Master", "Helper", "Operator") |
| PUT | "/api/customers/:id" | backend/src/server.ts:2437 | requireAuth; requireRole("Master") |
| DELETE | "/api/customers/:id" | backend/src/server.ts:2455 | requireAuth; requireAppPermission("customers.delete") |
| GET | "/api/customers/:id/orders" | backend/src/server.ts:2472 | requireAuth; requireRole("Master", "Helper", "Operator") |
| GET | "/api/customer-accounts/transactions" | backend/src/server.ts:2480 | requireAuth; requireRole("Master", "Helper", "Operator") |
| GET | "/api/customer-accounts/:id" | backend/src/server.ts:2494 | requireAuth; requireRole("Master", "Helper", "Operator") |
| GET | "/api/customer-accounts/:id/transactions" | backend/src/server.ts:2504 | requireAuth; requireRole("Master", "Helper", "Operator") |
| POST | "/api/customer-accounts/transactions" | backend/src/server.ts:2522 | requireAuth; requireRole("Master", "Helper", "Operator") |
| DELETE | "/api/customer-accounts/transactions/:id" | backend/src/server.ts:2561 | requireAuth; requireRole("Master", "Helper", "Operator") |
| PATCH | "/api/customer-accounts/transactions/:id" | backend/src/server.ts:2577 | requireAuth; requireRole("Master", "Helper", "Operator") |
| GET | "/api/account-balances" | backend/src/server.ts:2623 | requireAuth; requireRole("Master", "Helper", "Operator") |
| GET | "/api/finance/customer-payments" | backend/src/server.ts:2631 | requireAuth; requireRole("Master", "Helper", "Operator") |
| GET | "/api/account-ledger/:customerId" | backend/src/server.ts:2639 | requireAuth; requireRole("Master", "Helper", "Operator") |
| POST | "/api/account-ledger/:customerId/payments" | backend/src/server.ts:2666 | requireAuth; requireRole("Master", "Helper", "Operator") |
| POST | "/api/account-ledger/:customerId/periods" | backend/src/server.ts:2699 | requireAuth; requireRole("Master", "Helper") |
| GET | "/api/products" | backend/src/server.ts:2729 | requireAuth |
| POST | "/api/products" | backend/src/server.ts:2734 | requireAuth; requireRole("Master", "Helper", "Operator", "Supervisor") |
| PUT | "/api/products/:id" | backend/src/server.ts:2758 | requireAuth; requireRole("Master", "Supervisor") |
| DELETE | "/api/products/:id" | backend/src/server.ts:2784 | requireAuth; requireRole("Master") |
| GET | "/api/search/orders" | backend/src/server.ts:2791 | requireAuth |
| GET | "/api/search" | backend/src/server.ts:2799 | requireAuth |
| POST | "/api/orders/:id/items" | backend/src/server.ts:2851 | requireAuth; requireRole("Master", "Helper") |
| PUT | "/api/orders/:id/items/:itemId" | backend/src/server.ts:2863 | requireAuth; requireRole("Master", "Helper", "Worker", "Finishing", "Finish") |
| DELETE | "/api/orders/:id/items/:itemId" | backend/src/server.ts:2873 | requireAuth; requireRole("Master", "Helper") |
| GET | "/api/monthly-periods" | backend/src/server.ts:2881 | requireAuth; requireRole("Master", "Helper") |
| POST | "/api/monthly-periods" | backend/src/server.ts:2886 | requireAuth; requireRole("Master", "Helper") |
| GET | "/api/expenses" | backend/src/server.ts:2894 | requireAuth; requireRole("Master", "Helper") |
| POST | "/api/expenses" | backend/src/server.ts:2899 | requireAuth; requireRole("Master", "Helper") |
| GET | "/api/incomes" | backend/src/server.ts:2908 | requireAuth; requireRole("Master", "Helper") |
| POST | "/api/incomes" | backend/src/server.ts:2913 | requireAuth; requireRole("Master", "Helper") |
| GET | "/api/reports/monthly-summary" | backend/src/server.ts:2922 | requireAuth; requireRole("Master", "Helper") |
| GET | "/api/dashboard/summary" | backend/src/server.ts:2931 | requireAuth |
| GET | "/api/dashboard/alerts" | backend/src/server.ts:2946 | requireAuth |
| GET | "/api/audit" | backend/src/server.ts:2968 | requireAuth; requireRole("Master") |
| POST | "/api/finance/transactions" | backend/src/server.ts:2989 | requireFinanceSession |
