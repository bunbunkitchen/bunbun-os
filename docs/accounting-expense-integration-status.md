# Period expense integration — 4 November 2026 (Jakarta)

Installed only in staging `pkgrqalpazhwdcxmthvb`: private expense posting and exact reversal/replacement correction, service-only SECURITY INVOKER RPC, and Owner review/confirmation Edge API. No real opening or financial posting is approved by this installation.

Supported: paid **nonproduction period** wages, utilities, period maintenance, rent and other operating costs. Owner must explicitly verify the period/nonproduction classification. Production cost allocation, ingredient purchases, assets, depreciation, stock losses and drawings are excluded. Purchase-linked expenses cannot be posted through this route. Existing legacy source category does not automatically determine a journal account.

The source amount is loaded from the locked expense row. Five-minute review tokens bind the original source snapshot, active Owner, selected accounts, evidence, action and operation ID. Purchase tokens cannot authorize expense actions. Confirmation rechecks Auth/profile and database source/period, so changed source data and closed periods cannot silently post. Direct source edits/deletes are blocked after posting; corrections keep previous source snapshots and immutable original journals. Date/category/deletion corrections require a separate workflow.

The Owner panel on Pengeluaran offers inspection then confirmation, displays original/corrected amounts and cash/bank choice, and blocks confirmation before approved opening/open period. Extra source categories Utilitas, Sewa and Operasional Lain are enabled only for the exact staging URL; the staging database constraint was expanded accordingly. Cashier/Admin operational forms do not grant journal posting authority.

## Evidence and limits

- All 309 Node tests pass; Vite build passes with staging settings enabled.
- Three SQL suites passed in an ephemeral local PostgreSQL/WASM database using the actual source schema and ledger SQL: paid purchasing, purchase corrections (including service wrapper), and period expense posting/correction. Local synthetic bank 100000 minus expense 20000 yields bank 80000 and period loss 20000; correction to 25000 yields bank 75000 and loss 25000. Original history stays intact. Retry, double-purchase prevention, production scope, cash depreciation rejection, Owner, opening, closed period, NaN, late failure rollback, and browser spoof/permission tests passed.
- Cloud source review and missing-period posting gate passed with a synthetic source rolled back. The full cloud expense rollback-suite confirmation expired before execution; local SQL evidence is not presented as a cloud or authenticated-browser success.
- Cloud read after testing: expenses/purchases/journals/periods/expense mappings/operations zero, stock tracking OFF, anon/authenticated RPC execution false. No production data changed.
- Advisor: 25 private RLS/no-policy INFO remain intentional service-only tables, the previous 17 authenticated definer warnings and leaked-password warning remain unresolved. No new browser definer grant.
- A dedicated CI workflow tests these source-backed SQL suites against PostgreSQL 16 and 17, using only throwaway service containers and synthetic local Auth fixtures. Check its run result separately from these local results.

Local repeatable SQL test (no server connection):

```sh
npm install --prefix /tmp/bunbun-pglite-test --save-exact --ignore-scripts @electric-sql/pglite@0.5.15
BUNBUN_PGLITE_MODULE=/tmp/bunbun-pglite-test/node_modules/@electric-sql/pglite/dist/index.js node scripts/staging/source-accounting-local.mjs
```

Cloud migration history: `isolated_staging_period_expense_posting`, followed by the reviewed source-category/read-only-review fix and explicit operation-key fix. `cloud-period-expense-staging.sql` contains the final combined version for fresh installation, not an idempotent rerun.

Next: authenticated browser review/confirmation, sales entitlement and actual sold COGS, allocated cafe settlements and actual production/material costing. Opening evidence remains separately unapproved. This is not complete financial accounting or permission to merge main.
