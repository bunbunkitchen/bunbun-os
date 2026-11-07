# Source-backed actual material cost — 4 November 2026 (Jakarta)

Isolated staging `pkgrqalpazhwdcxmthvb` only. No production/main rollout, real opening approval or invented business value.

## Implemented

- Owner panel in Audit Biaya HPP after inspecting a batch. The server re-reads a positive active `PRODUCTION_OUT` linked to a Finished batch with recorded consumption. The Owner verifies actual usage and its evidence, reviews the server value, then explicitly confirms a five-minute purpose-signed token.
- Each ingredient uses the moving weighted average of its posted RAW cost pool (approved opening plus posted purchase acquisition values less prior valued usage). kg/g, liter/ml and pc/pcs normalize to base units. Historical `unit_value`, recipe master prices and the Rp2,615 allowance do not supply missing actual costs.
- Journal Dr1215 WIP / Cr1210 RAW; equal and opposite quantity/value cost movements. No cash, revenue, expense, operational inventory movement or product stock is created again. Fractional cents stay in the remaining raw pool; the final withdrawal takes the exact remainder.
- Physical source order is `(transaction_date,id)`. Prior unvalued purchases, consumption or unsupported adjustments, later already-valued receipts, incompatible units, insufficient stock/value and unavailable opening/period block confirmation. This intentionally requires chronological reconciliation rather than silently including a later purchase in an earlier average.
- Source history and ledger pool use complete SHA-256 digests, never truncated history. Source/current pool/Owner/period are rechecked under ingredient, source and batch locks at confirmation. Same request returns the same journal; changed replay fails.
- Posted material source/history and its batch become immutable. Earlier raw cost changes and material reversal require a downstream revaluation workflow. Do not run price or cash-account purchase corrections through a previously consumed pool: the current full invoice reversal is conservatively blocked until that workflow exists. Newly entered later operational movements remain possible for other batches.
- Narrow public RPC is SECURITY INVOKER and service-only; private mapping has RLS and no browser grants. Edge Auth uses remote user verification and a fresh active Owner profile. The exact staging project and trusted browser origin are required.

## Validation and rollout evidence

- 328 Node tests passed, including signed source binding, rejected client costs/actors, expiry/purpose separation, fresh role checks, missing evidence, source changes and unknown-cost blockers. Staging Vite build and targeted ESLint pass.
- Five full actual-source SQL suites passed in local ephemeral PostgreSQL/WASM. Material example: approved raw 3g/1.00; use 1g costs 0.33; buy 1g/2.00; use 1g costs 0.89; consume remaining 2g costs 1.78. Total WIP=3.00, RAW quantity/value=0, no new physical movements, no material expense or fabricated profit.
- PostgreSQL 16/17 CI includes those suites and two independent-session tests. The new material race uses its own disposable database: two usages of 2g compete for a 3g/1.00 pool, exactly one may post, leaving RAW 1g/0.34 and WIP 0.66. CI final result must be checked separately from the local result.
- Backend `accounting-material` v1 is active with verify_jwt=true. Full source-backed material SQL regression also passed on isolated Supabase staging, with every synthetic source, opening and journal rolled back. Final cloud read: journals/material postings/inventory transactions/batches all zero; anon/authenticated RPC EXECUTE=false. This SQL test is not an authenticated Owner browser/API posting test, which remains outstanding. Preview/CI completion is recorded separately in the implementation runbook.

## Remaining actual HPP work

This release values raw material usage only. Labor/overhead evidence, WIP completion into finished/frozen/reject lots, later conversion/consignment/waste and sold-lot COGS are not activated. `completeProductCost=false` and `actualProfitAvailable=false` remain explicit. Monthly cafe reporting must separate shipments, actual sold units, remaining stock, waste, bundles/discounts and actual **net Bunbun** deposits; a cash difference alone is not waste. Historical 1-Aug opening evidence remains unresolved independently of this code.
