# Cafe advances, actual waste and posted financial reports

Isolated staging `pkgrqalpazhwdcxmthvb` only. Owner page `/finance/cafe-reconciliation` now includes explicit review/confirm for the remaining common cafe accounting paths. Production/main and business opening approvals remain unchanged.

## Actual dated advances

An existing actual net deposit may be recognized on its real receipt date as Dractual bank/cash / Cr2130 cafe advance liability. All current report portions of that deposit must first account for the full `pemasukan_bunbun`; each cafe/month reservation is preserved. No new income source, repeated percentage deduction or premature revenue. Factual revisions may change sold evidence before invoice posting, but cannot change the reserved bank portions through a report revision.

After the real invoice is imported, Owner explicitly selects invoice/amount/application date. Dr2130 / Cr1120 applies available funds to the actual receivable, with no new cash or revenue. Date cannot precede receipt/invoice, allocation cannot exceed the reserved portion or receivable, and one source/invoice pair cannot be spent again. Same operation retries return the original journal. Financial reports use application dates (not the earlier bank receipt date) for dated receivable reconciliation.

This path supports deposits earlier than a consolidated month-end invoice without changing the real receipt date. Reservations require complete allocation of each bank source across known cafe/month reports. Overpayment carry-forward/refund and repeated incremental reallocation of the same receipt/invoice pair still require a dedicated financial correction workflow; they are not silently guessed or posted through this path. Free promo cost classification remains explicit and held separately.

## Evidenced cafe waste

Owner selects a confirmed waste product from a reconciled report and the exact valued CONSIGNMENT lots for that cafe. Total lot quantity must equal the report's confirmed physical waste; value is the actual remaining lot cost, with exact final residual cents. Month-end Dr6070 / Cr1240 consumes that consignment value. No second kitchen stock-out, cash expense, income, price/master HPP substitution or money-to-waste inference.

Positions are locked under the same actual-cost inventory system. Different cafes/products, future cost positions, overdraw, missing/zero actual cost, duplicate valuation and stale reviews fail. Valued waste freezes its report against direct revision even if the report has no sold goods. Actual sold COGS remains a separate exact lot allocation using the existing product-cost flow; both operations conserve the same consignment pool.

## Read-only financial endpoint

`accounting-owner-monthly-report` now uses a narrow service-only SECURITY INVOKER RPC instead of requiring a database URL/password. Exact isolated project/origins, gateway JWT verification, remote user verification and fresh active Owner checks remain. It loads only posted ledger views and validates all P&L, cash and balance equations in the existing handler and client.

Missing approved opening/period, incomplete actual sold/product costs, unresolved cafe reports, or any unposted income/purchase/expense source through the report month return PERIOD_NOT_READY. Unknown costs are never zero profit inputs. Advance liability, application and actual waste appear in their proper dated cash/financial/P&L views. The frontend enables the read client only for the exact isolated staging URL (existing explicit config still takes precedence); production stays disabled. Reports remain posted-journal-only, unaudited and unsuitable as automatic bonus/expansion approval.

## Validation and limitations

371 Node tests cover all existing boundaries plus advance/waste purpose signing, exact source/choice binding, rejected actor/percentage/recipe-cost/journal injection, positive allocations, dates/precision, freshness/expiry, role revocation, backend error isolation and origin/body limits.

Eleven actual-schema PostgreSQL rollback suites include: early net20 receipt on10December -> liability20 with zero December revenue; month-end sold invoice20 -> apply20 clears advance/AR; one cafe waste unit actual10 plus actual sold COGS10 consume opening consignment20 completely, December profit0 and bank1140 after starting bank1120. No repeated cash/physical source. Tests also check source reservations, retry/stale/overdraw/date guards, waste close readiness, Owner inspection, positive posted financial reports and unavailable reports for missing opening/pending sources. Synthetic opening-lot provenance is labeled fixture-only; the full actual purchase/material/production provenance pipeline remains separately tested.

SQL fixtures use scoped `\\ir` includes for the real PostgreSQL CI runner and safe in-repository expansion for the local ephemeral runner. Separate PostgreSQL16/17 CI sessions compete to apply an advance and value waste; each source can commit only once. Production-mode and explicit staging-mode bundles are both built, including the new staging UI branches with a synthetic noncredential build key.

Historical opening remains an evidence problem, not an implementation default: authoritative reconstruction `Bunbun_Draf_Saldo_Awal_1_Agustus_2026.md` v4 still lacks verified cash/bank/receivables/payables, some inventory/production reconciliation and historical actual cost evidence. No real opening, zero substitutions, changed historical dates or business financial rows are generated from that uncertainty. Equipment remains deferred as instructed.

Authenticated Owner browser acceptance is currently blocked: cloud browser auto-review refused the redirect from the authorized preview to the distinct private Vercel origin. No security bypass, alternate browser surface or indirect account access was attempted. Specific Vercel login-origin permission is needed to continue that browser acceptance check; connector/SQL/CI deployment work remains unaffected.
