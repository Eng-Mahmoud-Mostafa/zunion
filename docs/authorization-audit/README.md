# Authorization synchronization audit — deployment gate

Status: **audit completed; runtime upgrade blocked before implementation/deployment**.

Baseline commit: `0ce686d`. This report distinguishes source findings and isolated reproductions from live database facts. No production roles, users, permissions, financial records or configuration were changed. No new permissions were granted or removed.

## Discovered inventory

Run `node scripts/audit-authorization.mjs` to regenerate the complete source inventory and API table.

- 28 frontend view identifiers, including internal `menu`/`image` helpers.
- 16 frontend TypeScript/TSX files and 26 backend TypeScript files.
- 109 Express API route registrations.
- 492 interactive-control candidates (buttons, links, form controls and click/submit/change/drop/keyboard handlers). These include navigation, filters and cancellation controls; they are not 492 distinct permissions.
- 136 explicit permission/authorization call sites.
- 50 current permission keys. Frontend/shared and backend catalogs currently match, but exist as separate definitions.

See `source-inventory.json` for every candidate's source, line, handlers, nearby conditions, page keys, permission checks and source table definitions. See `api-inventory.md` for every API route's middleware. Static inventories are not proof that every execution path is authorized, and are not a live database inventory.

### Active frontend views

Dashboard; order list; new order; order details/edit; drafts; draft edit; customer creation; product creation; products; search; embroidery; machine distribution; finishing; printing; sewing; general archive; all customers; legacy customer-account workflow; customer ledger; finance; reports; audit; import; attendance; alerts; settings. `menu` and `image` are internal navigation/viewer helpers. A removed sidebar link does not make its underlying route obsolete.

## Critical migration blocker — permission authority is split

Confirmed source paths in `backend/src/server.ts`:

1. `GET /api/roles` reads Supabase first and falls back to PostgreSQL.
2. Role creation/update/deletion write through `supabaseRest`.
3. `makeSession` reads role permissions through PostgreSQL `query`.
4. User profiles read Supabase first with local/seeded fallback. Per-user overrides can therefore come from a different store than the role permissions.
5. `requireAppPermission` and production guards trust signed permission claims. `/api/auth/me` refreshes claims/cookies, but it uses `makeSession` and therefore does not solve a divergent role store.
6. `requireAuth` checks a PostgreSQL token version. Role-permission updates do not, in that route, invalidate all affected users' session token versions.

`node scripts/check-authorization-authority-audit.mjs` reproduces this with isolated test doubles only:

- Start with the same custom role in both stores, allowing `operation.view`.
- Revoke permissions through the real role-update endpoint.
- The Supabase test store becomes empty; the PostgreSQL test store remains unchanged.
- A newly generated session still contains `operation.view`.
- An already signed session still reaches a safe, fake archive read after the editor revoke.

This demonstrates a real code-path inconsistency, not a claim about the current contents of either production database. Whether the deployed stores are identical or divergent, and which role/user IDs are authoritative, must be verified with authorized read-only access to both. Overwriting either store without that comparison risks restoring revoked grants or losing legitimate roles and assignments.

## Module findings

| Module | Current controls | Gaps requiring implementation |
|---|---|---|
| Shared catalog | Matching 50-key catalogs in frontend/backend | One typed registry with page/action/button metadata, dependencies and scope; eliminate duplicated key definitions |
| Sidebar/routes | Effective session permissions; refresh/focus updates; hidden empty parents; independent toggles | Production stages still share `operation.view`; customer account and basic customer access share `customers.view`; attendance shares `import.export` |
| Orders/drafts | Mixed role and permission checks; order-detail record checks | Individual create/edit/delete/send/print/attachment/QR paths must use action permissions plus record scope; QR route has no authentication middleware and needs an explicit public-sharing policy review |
| Embroidery/printing/sewing | `operation.view` / `operation.update` protect queue/archive/completion APIs | Independent page/archive/priority/worker/problem/completion permissions absent; coarse gates prevent requested per-button configuration |
| Production tools | Archive always rendered; priority uses `canReorder` | Archive visibility and priority read/save authority must be explicit and independent per stage |
| Finishing | Role-specific transitions and `finishing.*` keys | Worker/problem/completion controls need distinct permissions and consistent page/action dependencies |
| Machine distribution | Queue guards; role allowlists; coarse update permission for mutations | Viewing/assigning/moving/reordering must not imply machine creation/deletion; sensitive management keys absent |
| Customers | Role allowlists; customer-name links follow account route gate | Customer list query returns balance/payment aggregates with basic customer data; separate basic and financial projections/permissions required |
| Customer ledger/accounts | Role-based payment/period controls and APIs | Separate account read/payment/period/statement permissions; hide unauthorized controls instead of role-based disabled controls |
| Finance | Some view/create keys; role/session gates; financial redaction by role | Review each actual transaction endpoint and projection; separate edit/delete where implemented; do not invent absent actions |
| Workers | Master-only API mutations and `canManage={isMaster}` | Configurable view/create/edit/status/delete/profile-field authority missing; selection directory must remain separate from master-data administration |
| Parties | Master-only mutation paths | Configurable view/create/edit/status authority missing; retain centralized Settings administration and existing selection workflows |
| Users/roles | Existing configurable admin keys and Master/last-admin protections | Settings component is still Master-gated; custom admin permissions cannot replace this by themselves; store authority and immediate revocation unresolved |
| Other settings | Sections include security/finance/departments/resources/admin mail | Section-level access/action rules need verified endpoint mappings, rather than one settings page permission |
| Attendance | `import.export` route mapping plus hardcoded upload roles | Separate actual attendance read/preview/import/history/print capabilities; no payroll grants implied |
| Reports | Report view/print keys; some APIs restricted by role | Sensitive financial/employee data projections and exports need explicit scopes |
| Audit | Master-only API; `audit.view` frontend | Align read/search/export where implemented; never add ordinary audit erase/update authority |
| Files/photos | Authentication on file/photo reads; order detail read guard exists separately | Download/photo endpoints need ownership/record authorization review; authentication alone is insufficient for cross-record scope |

### Existing security protections to preserve

Master role rename/deactivation protections, reserved Master name checks, protected administrative keys, last-active-Master protection, signed cookies, token-version invalidation, production eligibility/queue checks, audit writes and existing record restrictions remain untouched.

### Obsolete permissions

No permission was deleted during this audit. The current catalogs contain no separate key for the removed production Workers button or removed customer-account sidebar link. Account authorization and Settings worker administration remain active functionality. `salaries.view` and other settings/report-oriented keys require actual live feature/data review before deprecation; a missing sidebar item is not sufficient evidence.

## Required safe implementation sequence

1. Obtain read-only inventories of PostgreSQL and Supabase roles, user/profile IDs, status, permission arrays, per-user overrides, role assignments and token versions. Exclude password material from reports. Compare both stores; identify and document the authority and any legacy synchronization requirement.
2. Validate a protected administrative recovery path and staging copy. Preserve all existing IDs, user assignments and legitimate grants. Do not replace production role arrays with code defaults.
3. Create one typed permission registry with Arabic labels, module, level, dependencies and endpoint/action mappings. Normal buttons use the action permission directly; separate visibility keys only for useful non-mutating entry points (such as opening an archive or priority panel).
4. Build an idempotent, versioned mapping for demonstrably equivalent old/new capabilities. Newly sensitive financial/destructive/administrative actions stay ungranted by default. Do not derive grants solely from a parent page. Store migration evidence and compare before/after assignments. Unknown keys/ambiguous mappings require review rather than silent dropping.
5. Resolve effective permissions from the authoritative store for backend decisions. Revocation must take effect on the next protected request, or use documented secure token invalidation. A UI poll is not a security boundary. Enforce page/action dependencies and existing record/department scope together.
6. Replace hardcoded role checks for configurable capabilities without broadening protected record scopes. Add backend guards before data reads/mutations and scope queries/projections, especially customer financial data and files. Keep Master recovery and last-admin rules.
7. Add reusable permission-aware UI rendering to every important control. Retain temporarily disabled states for authorized but unavailable actions. Unmount revoked dialogs, guard keyboard/context actions, and ensure production tool panels cannot bypass their button gates.
8. Upgrade the existing role cards/editor to three labelled levels with search, expand/collapse, per-section select/clear, accurate counters, dependencies and save. Keep role IDs and design; no parallel administration system.
9. Verify all role/stage/action combinations, user overrides, view-only flows, stale-session revocation, cross-record/file access, financial projections, Master recovery, migrations repeated twice, no default privilege escalation, desktop/mobile RTL, dropdown behavior and database persistence in staging.
10. Only after the authority/migration blockers and acceptance tests are resolved: build, commit, push, deploy a candidate, verify authenticated multi-role behavior, then promote. No business-data reset is part of this work.

## Access and deployment status

The session has not obtained authorized read-only production access to both permission stores. The available local backend connection was previously verified as unavailable localhost; a running production health endpoint is not access to role inventories. No role synchronization migration can be certified from source files or fake fixtures alone.

The request explicitly says: **“If a critical authorization or migration issue prevents safe deployment, preserve the existing system and report the blocker rather than bypassing security.”** That gate applies here. This audit adds documentation and isolated checks only. It does not implement or claim the requested unified permission system, does not deploy an incomplete editor, and does not change the current production application.

## Read-only authority comparison tool

Run `node scripts/inventory-permission-stores.mjs ABSOLUTE_PRIVATE_DIRECTORY` only with authorized environment-provided `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `ZUNION_TARGET_ENV=production`. The script uses a read-only PostgreSQL transaction and paginated Supabase GET requests, excludes credentials/password material, records targets and role-ID/permission differences, and refuses to write inside the repository. Restrict the output directory with operating-system ACLs; do not commit the inventory. A Supabase service key must be treated as privileged even though this script only reads.

The comparison tool was syntax-checked but **not run against production**, because access is unavailable. It does not select an authority, reconcile conflicts or perform migrations.

## Validation completed

- Source inventory generator and comparison-tool syntax checks.
- Isolated authority mismatch/revocation reproduction using real route/session logic with fake stores.
- Existing session-refresh test, 90 unauthorized workflow request checks, multi-role navigation tests, and desktop/tablet/mobile dropdown regression tests.
- Backend TypeScript build and frontend production build passed. Existing bundle-size warning remains.

These are audit/baseline checks, not acceptance tests for a completed permission upgrade.
