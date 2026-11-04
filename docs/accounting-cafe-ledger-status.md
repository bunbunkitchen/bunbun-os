# Monthly cafe report to accounting — isolated staging

Owner action on `/finance/cafe-reconciliation`; target `pkgrqalpazhwdcxmthvb`, branch `feature/hpp-actual-staging` only. No production/main rollout or invented business opening/transactions.

## Implemented

A signed five-minute Owner review can turn a current reconciled factual report into net revenue and a cafe receivable. CREATE inserts one actual-sold monthly invoice with item quantities from normal/bundle/discount categories, then uses the existing reviewed revenue writer (Dr1120 / Cr4010). It never creates another stock movement. Net totals are already Bunbun's entitlement; no second sharing percentage. Category amounts/quantities stay on the immutable source report. Exact-cent pricing partitions units between adjacent cent prices, so three units with net80 become one26.66 and two26.67, preserving both quantity and nominal exactly.

Monthly consolidated invoices are recognized at month end, within a reviewed opening and OPEN accounting period. LINK accepts all existing active cafe/month invoices only when already posted on NET_BUNBUN basis with identical per-product sold quantities/net amounts and total entitlement. CREATE refuses any existing monthly cafe sales. Shipment-shaped old sales cannot be imported as another revenue invoice; mismatches require source/financial correction.

Receipt review collects current report allocations across cafes/months. Every linked report must have exactly one imported invoice for this automatic settlement path, and all allocations must equal the full `incomes.pemasukan_bunbun`. The existing receipt writer records Dractual bank/cash / Cr1120, without creating another income/cashbook source or second revenue. Already posted identical allocations can be verified without another journal. Multi-invoice LINK reports or deposits partly belonging to non-cafe sales use the existing explicit settlement workflow; this module never guesses the remaining allocation.

The new actual-sold invoice feeds the existing product-cost SALE flow: Owner explicitly selects the correct valued CONSIGNMENT lots for that cafe, posting Dr5010 / Cr1240. No guessed FIFO, recipe/master-price actual HPP, or duplicate physical issue. UI links to the existing actual-cost review panel. Pending actual COGS continues to block period close.

Imported report versions freeze against direct factual revision. Monthly cafe sales inserts/updates coordinate on the same scope lock, preventing another invoice entering a consolidated imported cafe/month without financial correction. Existing posted sales/items and income sources retain their existing immutable guards. Exact retries return the original operation; altered retries or changed source snapshots fail atomically.

Private RLS tables, no anon/authenticated grants; public transport SECURITY INVOKER service-only. Edge checks the exact staging project/origin, remotely verifies Auth, reloads current active Owner, purpose-signs exact choices/source digest, and requires explicit confirmation. Browser cannot provide actor, money, percentage, journals, lot costs or physical writers.

## Explicit remaining boundaries

- Deposits earlier than a consolidated month-end invoice require advance accounting. Review blocks rather than redating receipts or recognizing a whole month's sales too early. Overpayments and free promotional goods also require their explicit accounting classification first.
- Cafe waste journals, advance receipt/application, sold refunds/reversals and downstream financial corrections remain separate work. Facts may include waste, but this revenue bridge never converts money differences into waste or pretends waste costs are posted.
- The new close gate rejects recorded reports with unimported positive revenue, unposted/mismatched deposit allocations, unresolved unpaid balances, any cafe waste, or overpayment. Existing actual-COGS guards remain. This does not activate the final monthly financial endpoint or assert complete business readiness. API keeps `actualProfitAvailable:false` and factual reports keep `readyToClose:false`. Known actual lot HPP must still be posted through the existing cost flow, and historical opening evidence remains unresolved.
- Inserting a public sales row here is an actual-sold invoice from approved report evidence; it is not another cafe shipment. Raw report persistence alone still makes no financial posting.
- Authenticated Owner browser acceptance is not established by SQL/CI tests. Preview is behind Vercel authentication.

## Validation

364 Node tests: exact signed source/choice binding, net receipt account/source choices, rejected client money/actor/stock/journal injection, unique explicit LINK IDs, dates, role revocation, expiry, actor/purpose isolation, safe backend errors, source/staging/origin/session/body gates; previous reconciler/financial tests retained.

Nine full source-accounting PostgreSQL suites run in the local ephemeral database with the complete stock-writer schema and gateOFF. New synthetic rollback exercises CREATE, existing-invoice LINK without duplicate,80+40=120 net receipt despite stored70% metadata, exact cents, stale source, revision/source locks, missing invoice portions, receipt idempotency, monthly date/earlier-deposit holds, browser denial and pending-COGS close block. A trusted synthetic opening lot (separately from the already-tested full cost provenance pipeline) verifies imported invoice -> actual cafe lot COGS40, remaining inventory20 and profit80 from net revenue120; no new physical movements or income sources. All fixtures roll back. Cloud/CI/deployment results are checkpointed after verification.

Cloud staging validation: the new full report/revenue/receipt/lot-COGS rollback suite passed and rolled back every synthetic financial/operational source. `accounting-cafe-ledger` v1 ACTIVE with JWT verification. Security advisors add only three intended private RLS/no-browser-policy informational tables (46 total); existing17 definer warnings and one password-protection warning remain unchanged. CI/deployment results are recorded in the implementation runbook once final checks finish.
