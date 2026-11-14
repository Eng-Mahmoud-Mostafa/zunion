import { canReceive, permissionSet, assignedTo } from "../backend/dist/notifications.js";

const profile = (username, full_name, role, permission_overrides = {}) => ({ id: username, username, full_name, role, is_active: true, permission_overrides });
const roles = { CustomFinance: ["dailyAccounts.view"], CustomDenied: ["dailyAccounts.view"], CustomFinish: ["finishing.view"] };
const master = profile("mahmoud", "Mahmoud", "Master");
const operator = profile("omar", "Omar", "Operator");
const worker = profile("worker1", "Worker One", "Worker");
const otherWorker = profile("worker2", "Worker Two", "Worker");
const finishing = profile("finishing1", "Finishing One", "Finishing");
const finance = profile("finance1", "Finance One", "CustomFinance");
const deniedFinance = profile("finance2", "Finance Two", "CustomDenied", { deny: ["dailyAccounts.view"] });
const customFinish = profile("finishcustom", "Finish Custom", "CustomFinish");
const operationOrder = { id: "order-1", order_number: "100", work_stage: "operation", status: "SENT_TO_WORKER", draft: false, worker_name: "Worker One", operation_workers: ["Worker One"] };
const finishingOrder = { ...operationOrder, work_stage: "finishing", status: "SENT_TO_FINISH" };
const checks = [
  ["production queue reaches operator", canReceive("operation", operator, permissionSet(operator, roles), operationOrder)],
  ["production queue excludes finishing team", !canReceive("operation", finishing, permissionSet(finishing, roles), operationOrder)],
  ["production queue excludes unassigned worker broadcast", !canReceive("operation", worker, permissionSet(worker, roles), operationOrder)],
  ["assignment reaches matching worker", assignedTo(worker, operationOrder) && canReceive("assignment", worker, permissionSet(worker, roles), operationOrder)],
  ["assignment excludes other worker", !canReceive("assignment", otherWorker, permissionSet(otherWorker, roles), operationOrder)],
  ["finishing transfer reaches finishing role", canReceive("finishing", finishing, permissionSet(finishing, roles), finishingOrder)],
  ["finishing transfer reaches configured custom role", canReceive("finishing", customFinish, permissionSet(customFinish, roles), finishingOrder)],
  ["finishing transfer excludes worker", !canReceive("finishing", worker, permissionSet(worker, roles), finishingOrder)],
  ["finance reaches Master", canReceive("finance", master, permissionSet(master, roles))],
  ["finance reaches authorized custom role", canReceive("finance", finance, permissionSet(finance, roles))],
  ["finance excludes worker", !canReceive("finance", worker, permissionSet(worker, roles))],
  ["finance override deny is enforced", !canReceive("finance", deniedFinance, permissionSet(deniedFinance, roles))],
  ["draft is excluded from production queue", !canReceive("operation", operator, permissionSet(operator, roles), { ...operationOrder, draft: true })],
];
for (const [name, pass] of checks) console.log(`${pass ? "PASS" : "FAIL"} ${name}`);
if (checks.some(([, pass]) => !pass)) process.exitCode = 1;
