# Production business-data reset — preparation only

No production deletion has been authorized or performed. The request requires an exact live inventory, verified database and storage backups, a dry run and explicit final approval. Deployment is not reset approval.

## Current access / scope

The checked-in schema is only a guide; it is not a verified live inventory. The local backend connection points to localhost and is unavailable. No usable production database connection or PostgreSQL dump tools are available in this session. The live application running normally does not provide backup privileges.

Use an authorized database connection supplied securely through the environment, never chat or tracked files. Run `node scripts/inventory-production-reset.mjs ABSOLUTE_PRIVATE_DIRECTORY` with `DATABASE_URL` and `ZUNION_TARGET_ENV=production`. The command uses a read-only repeatable-read transaction, inventories real tables/counts/columns/constraints/sequences, and identifies attachment-reference columns. Output must be outside the repository. Inventory files contain sensitive metadata; restrict access with operating-system ACLs. Do not publish them.

## Required before execution

1. Confirm the inventory target matches the deployed database. Review every live table and FK, including extension/storage schemas. Classify records as remove, preserve or unresolved; unknown tables and product/catalog assets remain unresolved until reviewed.
2. Enter a maintenance window and block business writes. Create a full PostgreSQL custom-format dump using a matching/supported `pg_dump` version (`--format=custom --file=PRIVATE_PATH DATABASE_URL`); capture globals/role definitions as permitted by the provider. Do not print secrets or put URLs in shell history. Preserve sequences; do not restart IDs or visible order numbers.
3. Verify dump archive listing with `pg_restore --list`, checksums, access permissions and restore into an isolated staging database. Compare all table counts and database schema, including functions/triggers/policies/indexes/constraints. Provider-managed roles/settings must have a documented recovery path. An untested export is not a verified backup.
4. Enumerate all order file/photo/JSON URL references and storage providers from actual live data. Back up referenced file bytes, filenames, content types and SHA-256 hashes. Compare against every preserved product/configuration/shared-asset reference. Preserve any uncertain/shared file. Embedded database photo bytes must be included in the database backup. Server-local temporary upload paths may already be unavailable; report missing files rather than calling the backup complete.
5. Prepare explicit dependency-ordered DELETE statements from the reviewed live FK graph. No TRUNCATE CASCADE, disabling constraints, schema removal, identifier resets, broad storage bucket deletion or automatic product deletion. Preserve authentication users/roles/passwords/sessions, machine configurations, departments, financial account/category definitions, notification preferences and operational settings. Archive/audit snapshots must be classified rather than assumed safe to discard.
6. Restore the backup in staging and run the exact deletion transaction there. Check all per-table counts, FK integrity, empty reports/balances, preserved configuration hashes and authentication access. Exercise all workflows in staging, including financial writes. Do not seed fake data in cleaned production.
7. Present the final affected-record inventory, product decisions, file manifest, backup/restore evidence, dry-run results and preserved-record counts to the user. Obtain explicit approval of that exact destructive plan. Changes after approval invalidate the counts and require a new inventory/approval.
8. Execute the reviewed transaction during the maintenance window, record a cleanup audit event, verify counts/integrity/config hashes and empty states, then resume service. Delete only approved exclusively owned storage files after database commit and verified backup. Any storage failure requires a reconciliation report; do not report success prematurely.

## Restoration

Keep production writes blocked. Restore the verified dump into a fresh database with the approved `pg_restore` options and provider-supported roles/settings. Restore each backed-up storage object with its original key and metadata; verify hashes and reference resolution. Verify schema/counts/authentication/configuration in isolation, then repoint the existing deployment to the restored database through secure environment configuration and redeploy. Never restore over active business writes. Preserve the original database and backup until recovery is verified.

## Application safeguards prepared

- Startup reports orphan machine assignments without deleting them.
- Startup no longer inserts named sample parties. Referenced parties can still be backfilled from existing orders/customers; after an approved full cleanup those sources will be empty.
- Empty local party lists remain empty. New browsers no longer receive built-in demo orders.
- Automatic legacy image migration only updates a server-existing order; a missing/deleted cached order is not automatically recreated with POST.

These safeguards do not delete business records, clear users' browser data, reset balances or constitute a completed production reset.
