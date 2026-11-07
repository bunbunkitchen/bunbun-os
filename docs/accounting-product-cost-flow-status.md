# Product cost transfers and actual sold-lot COGS — 4 November 2026 Jakarta

Isolated staging `pkgrqalpazhwdcxmthvb` only. No production/main rollout or real opening/transaction invented.

## Implemented source-backed events

| Event | Actual source | Financial result |
| --- | --- | --- |
| Frozen release | FROZEN_OUT and matching derived split | Dr1215 proofing / Cr1230 frozen, same quantity/value |
| Frozen baking | Matching FINISHED_IN, reconciled good/reject result; explicit dated evidence for all-reject result | Dr1220 usable output and Dr6070 abnormal loss / Cr1215 proofing |
| Cafe shipment | CAFE_OUT and explicit verified lot/cafe | Dr1240 consignment / Cr1220 finished; no revenue or COGS |
| Unsold cafe return | CAFE_IN without a sold-sale reference | Dr1220 finished / Cr1240 consignment; no revenue reversal |
| Finished waste | Actual ADJUSTMENT_OUT and explicit waste/loss evidence | Dr6070 / Cr1220 |
| Actual sold goods | Already-confirmed revenue source, every sale-item product/quantity matched to valued lots | Dr5010 / Cr1220 direct or Cr1240 same cafe; sale COGS state becomes POSTED |

Costs follow an explicit source lot, never guessed FIFO. Partial withdrawals retain fractional-cent remainder in the remaining position. Final withdrawal takes the exact residual. Every event rechecks source identity, product, quantity, location, cafe, original operational tracking when present, current cost position and accounting period under locks. No operational stock or cashbook movement is created again. Only supported canonical cafes PUBLIC_HUB/PUBLIC_COFFEE and DIRECT are accepted; generic CAFE_OTHER needs a distinct identity first.

Initial root values seed private FROZEN/FINISHED cost positions. A derived frozen split receives the source cost through PROOFING and is never counted as another new production batch. Normal loss can be explicitly absorbed in usable output; abnormal reject cost is separately reconciled. An all-reject bake consumes the full proofing value into loss and requires dated actual evidence (no fabricated FINISHED_IN).

## Important scope boundaries

- **Incremental baking labor/overhead allocation is not implemented.** Baking cannot be costed when additional costs are unknown. Owner must explicitly document that no additional baking cost remains outside the transferred lot value; the checkbox is never preselected. Otherwise keep the event pending for a separate cost-allocation workflow. Do not silently treat gas/labor as zero or apply the Rp2,615 recipe allowance.
- Cafe COGS is based on **actual sold quantities**, never the original shipment quantity unless all of it actually sold. Cafe sale rows may represent external sold facts without another kitchen stock-out; when sale-linked stock rows do exist, all must already be valued shipments to that same cafe and match source product totals. Direct sales require actual linked kitchen stock-out. This does not implement the external cafe report importer or partial reclassification of an old shipment-shaped sale row.
- Cafe waste, bundles/discount reporting, sold refunds/reversals, incremental baking costs, opening-lot backfill and downstream corrections remain separate work. Finished waste is supported from an existing physical source; money differences do not infer cafe waste.
- Physical event date and journal date are separate. The journal cannot precede known source/position costs and must stay in the event's calendar month. Cross-month missing costs require accrual/correction, not shifting COGS to a convenient month. Per-position chronology is enforced, including incoming returns into an already-used destination position.

## Authorization and reporting

Private RLS tables, no browser grants; service-only SECURITY INVOKER RPC. Edge remotely verifies Auth and reloads the current active Owner, requires the exact staging project/origin, and purpose-signs a five-minute source/choice review. Confirmation rechecks all source/position/period facts. Exact retries return the original journal; altered retries, duplicate source use, overdrawn positions or stale reviews fail atomically.

Valued physical sources and sold-sale stock links become immutable. Thaw freezes derived identity/quantity while still allowing actual baking results; after baking valuation that source is immutable. No direct stock cancellation is allowed through a costed sale without a financial reversal workflow.

Period close and the future monthly report cost-readiness gate reject unvalued stock events, incomplete batch costs, unallocated production pools and pending all-reject baking. Readiness scans complete source history, not the UI's limited choice lists. UI inspection lists at most 500 recent movements/sales; more than 500 nonzero cost positions fails closed pending a narrower query. Full final profit is not advertised: all flow API responses keep actualProfitAvailable=false, and the monthly report endpoint remains unactivated.

## Validation

- 345 Node tests cover authorization freshness, purpose/expiry, source/choice signing, actual sale identity, all-reject dates and unknown incremental costs, bounded IDs/quantities, rejected client cost/actor/journal injection, blockers and changed positions. Targeted lint/build are checked before rollout.
- Seven actual-source SQL suites run together with the full existing stock-writer schema (gate OFF) in ephemeral local PostgreSQL. Full source pipeline and optional operational tracking cafe mismatch are tested.
- Synthetic lifecycle: root production value200 -> frozen/proofing/baked, cafe consignment and actual sold/unsold return, direct sold, finished waste and all-reject baking. Final inventory100 + sold COGS60 + separately classified loss40 =200. Revenue120 -60 -40 =20. Net deposit120 is received in full despite stored 70% metadata; bank closes1120 from1000. No extra physical stock or material consumption rows.
- Separate PostgreSQL16/17 CI race: two7-unit sold costs compete for a10-unit/value100 position; exactly one COGS70 can commit, inventory3/value30 remains and the other sale stays pending. Synthetic race positions are seeded only in a disposable CI database; full source provenance is tested by the independent rollback suite.
- Final cloud rollback, preview and CI results are recorded in the implementation runbook after completion. Authenticated Owner browser posting remains a separate pending verification. Historical 1-Aug opening and cafe monthly facts still require real evidence before business activation.
