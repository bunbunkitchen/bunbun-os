/**
 * Contract-only adapter between a draft future release plan and a PRIVATE,
 * trusted backend. It DOES NOT invoke Supabase; it does not obtain a service
 * role key, approve physical counts or create a stock transaction.
 *
 * The trusted Edge/backend MUST independently re-fetch lot positions and
 * source stock, verify the Owner JWT, validate the approved cutover and bind
 * actor_id SERVER-SIDE. Never forward browser actor_id to the SQL routine.
 */
export function buildLotReleaseServerRequest(plan) {
  if (!plan || plan.status !== "NEW_LOT_RELEASE_PLAN_ONLY" ||
    plan.readyToPost !== false || plan.writesDatabase !== false ||
    plan.ownerApprovalVerified !== false || plan.sourceBalanceVerified !== false ||
    plan.createsCogs !== false || plan.createsSale !== false ||
    plan.requiresAtomicReleaseWithStockMovement !== true ||
    !Array.isArray(plan.productRows) || !Array.isArray(plan.allocationRows) ||
    plan.productRows.length === 0 || plan.allocationRows.length === 0) {
    throw new Error("Hanya preview pengeluaran lot yang valid dapat disusun menjadi request.");
  }

  const source = new Map();
  for (const row of plan.productRows) {
    if (!row || typeof row.productId !== "string" ||
      !Number.isSafeInteger(row.quantity) || row.quantity <= 0 ||
      row.assignedQty !== row.quantity || source.has(row.productId)) {
      throw new Error("Jumlah produk pada preview tidak lengkap.");
    }
    source.set(row.productId, {
      productId: row.productId,
      quantity: row.quantity,
      allocations: [],
    });
  }
  const keys = new Set();
  for (const allocation of plan.allocationRows) {
    const product = source.get(allocation?.productId);
    if (!product || allocation.operationKey !== plan.operationKey ||
      allocation.stockMovementId !== null ||
      allocation.destinationType !== plan.destinationType ||
      allocation.sourceLocation !== "FINISHED" ||
      allocation.movementDate !== plan.releaseDate ||
      allocation.allocationEvidenceRef !== plan.releaseEvidenceRef) {
      throw new Error("Baris lot tidak konsisten dengan transaksi sumber.");
    }
    const key = allocation.productId + ":" + allocation.lotId;
    if (keys.has(key)) throw new Error("Alokasi lot duplikat.");
    keys.add(key);
    if (!Number.isSafeInteger(allocation.qty) || allocation.qty <= 0) {
      throw new Error("Qty alokasi lot tidak valid.");
    }
    product.allocations.push({
      lotKey: allocation.lotId,
      qty: allocation.qty,
    });
  }
  for (const product of source.values()) {
    const total = product.allocations.reduce((sum,a) => sum + a.qty,0);
    if (!Number.isSafeInteger(total) || total !== product.quantity) {
      throw new Error("Jumlah lot tidak sama dengan pengeluaran produk.");
    }
  }
  return {
    action: "record-lot-assigned-release",
    operationKey: plan.operationKey,
    movementDate: plan.releaseDate,
    destination: plan.destination,
    destinationType: plan.destinationType,
    evidenceRef: plan.releaseEvidenceRef,
    items: [...source.values()],
    // Explicitly no actor_id, role, cost, COGS, revenue or cash field.
    // This is not a safe-to-post approval: the backend must recheck everything.
    browserEvidenceIsNotApproval: true,
  };
}
