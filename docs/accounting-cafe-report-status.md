# Cafe monthly factual reconciliation — isolated staging

Implemented for `pkgrqalpazhwdcxmthvb`, branch `feature/hpp-actual-staging`. Owner page: `/finance/cafe-reconciliation`. Production and main remain untouched.

## Usable behavior

- Record monthly product facts: opening, received, sold normal/bundle/discount, confirmed waste, unsold return, closing cafe stock. Every quantity and money field must be explicit; blank is unknown, never zero.
- Record net Bunbun entitlement per sales category, confirmed unpaid balance and confirmed overpayment. No percentage deduction or retail-price estimate. Cash variance does not alter product quantities or infer waste.
- Select source CAFE_OUT / unsold CAFE_IN records. Structured/valued cafe identity cannot be overridden. Unclassified movements remain completeness issues until their destination is evidenced; no notes/FIFO inference.
- Link all or part of actual `incomes.pemasukan_bunbun`, including a later-month deposit, up to a chosen cutoff. Current report versions across cafes/months cannot allocate more than the original net deposit. Revisions release their own prior active allocation without counting it twice.
- Save reports even with discrepancies; persistent factual records are distinct from financial posting. Corrections append revisions; history and original source snapshots remain available. Idempotent retry does not reset the current version.
- Compare next month's opening against the preceding current report's closing. Flag later source/prior-report changes when reopening a saved report.
- Private RLS tables; service-only SECURITY INVOKER RPC; Edge verifies remote user plus current active Owner; trusted isolated origins only; signed five-minute review and exact explicit confirmation. SQL serializes report/receipt allocation, checks source fingerprint/version/closed period, and freezes linked physical/income sources. This is not a new stock or cash writer.

## Honest accounting boundary

`FACTS_RECONCILED` means factual quantities and linked deposits match the supplied evidence and selected operational sources. It does **not** mean revenue/COGS, cafe waste, receivables, advances, or the accounting month are posted/reconciled. Every response keeps `readyToClose:false`, `actualProfitAvailable:false`, and `accountingStatus:REQUIRES_LEDGER_RECONCILIATION`.

This module creates no public sales, stock movements, cashbook records or journals. It does not activate the monthly financial reporting endpoint or change existing close-gate semantics. Actual cafe report-to-sale import, cafe waste/advance accounting and the final report-close integration remain subsequent work. Source data must not be invented to clear differences.

UI limits: 50 products, 300 source movements of each type, 100 linked receipts. Candidate deposits cover the report month and the following two months, plus already linked deposits on a revision; the service supports explicit older/later receipt IDs with the same cutoff and cap checks. At most 2,000 monthly movement sources; larger histories require a scoped import. Oversized signed reviews are rejected before saving.

## Validation

Node reconciliation/auth tests cover full net deposits despite legacy 70% metadata, explained/unexplained payment variances without inferred waste, cents, credit sign, explicit zeros, source mismatch/omissions, prior closing, duplicate IDs, no implicit promo prices, signed confirmation, expiry, role revocation and backend stale rejection.

PostgreSQL rollback suite checks real tables, source fingerprints stable across recording, immutable revisions, retry without pointer rollback, 80+40 allocations from one net 120 source, over-allocation failure, source locks, stale source, atomic late failure, browser denial, and zero financial/physical writes. Separate disposable PostgreSQL 16/17 CI race tests submit two competing 80 allocations against one deposit of 120. All fixtures are synthetic and rollback, or exist only in disposable CI databases.

Authenticated Owner browser submission still requires a real-session acceptance check; SQL/CI success is not browser-session evidence.

Cloud validation: the full cafe report rollback suite passed on isolated staging; test report, source, income and journal counts returned to zero. Edge `accounting-cafe-report` v1 is ACTIVE with JWT verification. Security advisors show only the four intentional new private RLS/no-browser-policy tables (43 total informational notices); existing warnings remain 17 definer grants and one Auth password-protection setting, with no new definer exposure. Local total: 357 Node tests pass, eight source-accounting PostgreSQL suites pass, targeted lint and Vite build pass. CI/deployment completion is checkpointed separately.
