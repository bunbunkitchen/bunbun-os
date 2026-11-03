# Purchasing integration — 4 November 2026 (Jakarta)

Installed only on Supabase staging `pkgrqalpazhwdcxmthvb`:

- Source-backed full ingredient purchase + one linked full payment, including normalized raw stock cost, posted atomically after approved opening and open accounting periods.
- Controlled price/payment-account correction: exact reversing journals plus replacement entries; original journals and prior source snapshots retained. Physical receipt quantity stays unchanged. Price changes after ingredient usage are rejected pending downstream revaluation. Closed periods are never reopened.
- Owner-only `accounting-purchase` Edge endpoint with gateway JWT verification, remote Auth verification and fresh profile authorization. Five-minute HMAC-signed review binds action, source snapshots, actor and choices; explicit confirmation cannot substitute changed values. The service RPC is SECURITY INVOKER and executable only by service_role; the private ledger remains unavailable to browser roles.
- Owner Purchasing panel is limited to the exact staging project, with inspection then confirmation and precise old/new totals. The server returns a blocked review when opening/period is not ready; this is not approval of a real opening.

## Validation evidence

- Private correction rollback test passed: bank opening 100000, original purchase 20000, corrected purchase 24000 => closing combined cash/bank 76000, raw cost 24000, raw quantity still 2000 g, no operating expense/profit from purchasing. Retry, stale/reused operation, non-Owner, NaN, closed period, consumed-material guard, late failure atomic rollback, spoofed client correction context and browser access were tested.
- Service transport review with a synthetic source passed: matched purchase/payment/receipt found, posted=false, periodReady=false without opening. Synthetic rows rolled back. Missing source returns null under a read-only service-role transaction.
- The subsequent expanded SQL test through the service wrapper was not completed: tool confirmations expired. This is not evidence of a passing full live HTTP/browser transaction. The private writer and correction results above predate that extension.
- Node tests cover signed review, expiry, cross-Owner/altered tokens, fresh Owner status on confirmation, source/period failures, input limits and exact decimal correction totals. All 300 Node tests pass. Vite build passes with the staging target enabled, including the Owner panel.
- No real periods, journals, mappings, corrections or operational transactions were created. Stock tracking stays OFF. Production and main remain untouched.

## Files and deployment order

1. Existing private ledger core and source-backed purchase posting must be installed before correction and service transport SQL.
2. `cloud-purchase-correction-staging.sql` contains the final corrected function version; cloud also has the follow-up `staging_purchase_correction_reversal_valuation_guard` migration applied. It excludes accounting reversal movements when detecting downstream physical use.
3. `cloud-purchase-service-staging.sql` contains the final explicit `v_purchase_id` version; cloud also has the follow-up `staging_purchase_service_explicit_identifier` migration applied.
4. Deploy `accounting-purchase` plus its three shared JS dependencies, verify_jwt=true. No database password is required; the Edge runtime's built-in secret stays server-side.
5. Publish only reviewed purchasing integration files to `feature/hpp-actual-staging`. Preserve other uncommitted work and never merge main as part of this step.

## Remaining scope

Not yet complete accounting: nonpurchase expenses, sales entitlement and actual sold COGS, allocated cafe settlements, production cost movement/valuation, supplier returns, quantity/date/item corrections, partial or multiple payments, downstream cost correction, approved real opening, full authenticated browser tests and cloud concurrency. Recipe master HPP policy remains unchanged. Automatic production activation is not part of this rollout.
