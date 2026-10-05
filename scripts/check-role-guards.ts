import { allPermissionKeys, isReservedRoleName, masterProtectedPermissions, roleUpdateRejection } from "../backend/src/permissions.js";

let failures = 0;

function check(label: string, condition: boolean) {
  if (condition) {
    console.log(`  PASS ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}`);
  }
}

/** Every permission except one protected key, to prove partial removal is caught. */
function permissionsWithout(key: string) {
  return allPermissionKeys.filter((item) => item !== key);
}

console.log("== 1. Master protections cannot be stripped ==");
const firstProtected = masterProtectedPermissions[0];
check(
  "removing a protected permission from Master is rejected",
  roleUpdateRejection({ currentName: "Master", permissions: permissionsWithout(firstProtected) }) !== null,
);
check(
  "removing every protected permission from Master is rejected",
  roleUpdateRejection({ currentName: "Master", permissions: [] }) !== null,
);
check(
  "re-sending the full permission set to Master is allowed",
  roleUpdateRejection({ currentName: "Master", permissions: [...allPermissionKeys] }) === null,
);

console.log("== 2. Renaming Master cannot bypass the guards ==");
check(
  "rename Master -> Manager while stripping permissions is rejected",
  roleUpdateRejection({
    currentName: "Master",
    nextName: "Manager",
    permissions: permissionsWithout(firstProtected),
  }) !== null,
);
check(
  "rename Master -> Manager while granting resetAllPasswords is rejected",
  roleUpdateRejection({ currentName: "Master", nextName: "Manager", permissions: ["users.resetAllPasswords"] }) !== null,
);
check(
  "rename Master -> Manager alone is rejected",
  roleUpdateRejection({ currentName: "Master", nextName: "Manager" }) !== null,
);
check(
  "whitespace-only rename attempt is rejected",
  roleUpdateRejection({ currentName: "Master", nextName: "   " }) !== null,
);
check(
  "renaming Master -> Master (no-op) is allowed",
  roleUpdateRejection({ currentName: "Master", nextName: "Master" }) === null,
);

console.log("== 3. Master cannot be deactivated ==");
check(
  "deactivating Master is rejected even with no permissions in the payload",
  roleUpdateRejection({ currentName: "Master", status: "inactive" }) !== null,
);
check(
  "deactivating Master while renaming away is rejected",
  roleUpdateRejection({ currentName: "Master", nextName: "Manager", status: "inactive" }) !== null,
);
check(
  "setting Master status to active is allowed",
  roleUpdateRejection({ currentName: "Master", status: "active" }) === null,
);

console.log("== 4. resetAllPasswords is Master-only ==");
check(
  "granting resetAllPasswords to a non-Master role is rejected",
  roleUpdateRejection({ currentName: "Supervisor", permissions: ["users.view", "users.resetAllPasswords"] }) !== null,
);
check(
  "renaming a role TO Master in order to keep resetAllPasswords is rejected",
  roleUpdateRejection({ currentName: "Supervisor", nextName: "Master", permissions: ["users.resetAllPasswords"] }) !== null,
);
check(
  "reducing Master to only resetAllPasswords is rejected (it drops the other protected keys)",
  roleUpdateRejection({ currentName: "Master", permissions: ["users.resetAllPasswords"] }) !== null,
);
check(
  "Master keeping resetAllPasswords alongside the full set is allowed",
  roleUpdateRejection({ currentName: "Master", permissions: [...allPermissionKeys] }) === null,
);

console.log("== 5. Ordinary roles are unaffected ==");
check(
  "renaming a normal role is allowed",
  roleUpdateRejection({ currentName: "Supervisor", nextName: "Shift Lead" }) === null,
);
check(
  "deactivating a normal role is allowed",
  roleUpdateRejection({ currentName: "Supervisor", status: "inactive" }) === null,
);
check(
  "editing a normal role's permissions is allowed",
  roleUpdateRejection({ currentName: "Supervisor", permissions: ["orders.view", "orders.edit"] }) === null,
);

console.log("== 6. Reserved role name ==");
check("'Master' is reserved", isReservedRoleName("Master"));
check("'  Master  ' is reserved after trimming", isReservedRoleName("  Master  "));
check("'Master Admin' is not reserved", !isReservedRoleName("Master Admin"));
check("'Helper' is not reserved", !isReservedRoleName("Helper"));

if (failures > 0) {
  console.log(`\n${failures} ROLE GUARD CHECK(S) FAILED`);
  process.exit(1);
}
console.log("\nALL ROLE GUARD CHECKS PASSED");