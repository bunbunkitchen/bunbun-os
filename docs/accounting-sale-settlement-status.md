# Sale entitlement and cafe settlement — 4 November 2026 (Jakarta)

Isolated staging only (`pkgrqalpazhwdcxmthvb`). No production/main rollout or approved real opening.

## Implemented behavior

- Owner verifies that goods were actually sold and explicitly chooses whether the recorded sale is gross cafe revenue or already Bunbun's net entitlement. No automatic 70% assumption. Sale source and line items are locked and checked; the net entitlement becomes revenue and a receivable once.
- Actual `incomes.pemasukan_bunbun` is allocated to one or several already-posted sale receivables. Supports partial and combined payments. The allocation total must equal actual net cash received; the old source percentage is not applied again. Cash/bank is debited and receivables credited, without new revenue.
- Outstanding receivables are locked in sale-ID order while validating/recording payments. Overpayment, duplicate invoice allocation, receipt before sale, stale source, repeated/changed operations and non-Owner calls are rejected. Financial posting does not decrement product stock again.
- Original sales, sale items and income rows become protected after journal posting. Reversal/correction of these sale/receipt documents is not yet implemented; direct edits/deletes remain blocked. Advance receipts, owner capital, other non-sale income and refunds require separate classifications/workflows.
- Owner panels on Sales and Income use a five-minute purpose-signed review followed by explicit confirmation. Other operational roles retain existing source entry permissions but cannot post or read private receivables directly. Source ledger is accessed through a service-only SECURITY INVOKER RPC; Edge verifies JWT remotely and reloads the active Owner profile.

## Unknown sold costs remain unknown

Sale postings start as `PENDING_VALUATION`; actual profit is not advertised as available. No recipe/master HPP or fixed operational allowance is used as evidence of actual sold cost. Missing sale postings or pending sold costs prevent closing the accounting period. The monthly report loader now checks sold-cost readiness before returning a financial snapshot; its original database-secret configuration/deployment is not activated by this rollout. This gate intentionally keeps incomplete COGS from appearing as zero in a final report.

## Validation

- 320 Node tests pass. Staging build passes.
- Four source-backed SQL suites pass in local ephemeral PostgreSQL/WASM using the actual source schema and ledger code. Revenue example: recorded gross 100000 + 50000, confirmed Bunbun entitlement 70000 + 35000 => revenue 105000. Actual net receipts 30000 then 75000 => cash increases 105000 and receivables become zero. Revenue stays 105000, no second discount, no product movement added, sold-cost readiness remains false.
- Cloud source inspection and missing-period posting gate passed with synthetic source rows rolled back; no real opening or journal created. Cloud read-only receivable list is empty and actualProfitAvailable=false.
- Dedicated PostgreSQL 16/17 CI covers all four rollback suites and a two-session receipt race: two 50000 receipts compete for a 70000 receivable; exactly one may commit and 20000 must remain. Race fixtures commit only in the disposable CI database, never on Supabase. Check that workflow's final result separately from the local results.
- `accounting-revenue` deployed with verify_jwt=true and the exact staging target/origins. Full authenticated Owner browser submission is still a separate check; no claim of real business posting.
- Advisor remains at the previous 17 authenticated definer warnings and leaked-password warning; private RLS/no-policy INFO count is now 29, by design for service-only tables.

## Next

Actual raw-material consumption, WIP/finished/frozen/consignment valuation and sold COGS must be connected to their sources. Add reviewed sale/receipt reversals and downstream corrections, complete actual Owner browser tests, and approve real opening evidence before production cutover.
