/**
 * READ-ONLY inspection of Bunbun production -> finished/frozen product lots.
 * It is deliberately NOT a valuation: missing historical unit_value, missing
 * acquisition proofs, or CAFE_OUT lacking split/lot linkage are blockers.
 */
const TYPES = new Set(["FINISHED_IN","FROZEN_IN","FROZEN_OUT"]);
const asId = value => String(value ?? "");
export function assessBatchLotSources({ batch, materials, splits, stockMovements }) {
  if (!batch || !Array.isArray(materials) || !Array.isArray(splits) ||
    !Array.isArray(stockMovements)) {
    throw new Error("Data batch dan lot tidak lengkap.");
  }
  const issues = [];
  const roots = splits.filter(s => s.source_split_id == null);
  const derived = splits.filter(s => s.source_split_id != null);
  const ids = new Set();
  const splitIds = new Set(splits.map(s => asId(s.id)));
  for (const row of stockMovements) {
    if (ids.has(asId(row.id))) {
      issues.push("Mutasi produk duplikat; periksa id " + row.id + ".");
    }
    ids.add(asId(row.id));
    if (row.is_deleted === true) {
      issues.push("Mutasi produk terhapus tidak dapat menjadi sumber audit.");
    } else if (!TYPES.has(row.movement_type) ||
      !splitIds.has(asId(row.batch_split_id))) {
      issues.push("Mutasi produk tidak cocok dengan split atau status aktif.");
    }
  }
  const releases = roots.filter(s => ["DIRECT","FROZEN"].includes(s.route))
    .map(split => {
      const id = asId(split.id);
      const stockType = split.route === "DIRECT" ? "FINISHED_IN" : "FROZEN_IN";
      const expectedQty = split.route === "DIRECT" ?
        Number(split.baked_good_qty) : Number(split.qty);
      const matches = stockMovements.filter(m => asId(m.batch_split_id) === id &&
        m.movement_type === stockType);
      const actualQty = matches.reduce((sum,m) => sum + Number(m.qty),0);
      const consistent = Number.isSafeInteger(expectedQty) && expectedQty > 0 &&
        matches.length === 1 && actualQty === expectedQty &&
        matches.every(m => asId(m.product_id) === asId(split.product_id));
      if (!consistent) {
        issues.push("Split #" + id + " belum cocok dengan mutasi " + stockType + ".");
      }
      return {
        splitId:id, productId:asId(split.product_id), route:split.route,
        qtyExpected:Number.isFinite(expectedQty) ? expectedQty : null,
        qtyReleased:Number.isFinite(actualQty) ? actualQty : null,
        movementIds:matches.map(m => asId(m.id)), sourceQtyConfirmed:consistent,
        provisionalCost:null,
      };
    });
  for (const split of derived) {
    if (!splitIds.has(asId(split.source_split_id))) {
      issues.push("Split turunan #" + split.id + " tanpa split frozen asal.");
    }
  }
  const missingCost = materials.filter(line => line.unit_value == null ||
    !Number.isFinite(Number(line.unit_value)) || Number(line.unit_value) <= 0);
  if (missingCost.length) {
    issues.push(missingCost.length + " baris bahan tidak memiliki unit_value positif yang terverifikasi.");
  }
  if (materials.length === 0) issues.push("Belum ada transaksi pemakaian bahan untuk batch.");
  if (batch.status !== "Finished" || batch.inventory_consumed !== true) {
    issues.push("Batch belum Finished atau pemakaian bahan belum tercatat.");
  }
  if (!roots.length) issues.push("Belum ada split asal yang melepaskan produk.");
  if (roots.some(s => !["DIRECT","FROZEN","REJECT"].includes(s.route))) {
    issues.push("Ada tipe split asal yang belum didukung.");
  }
  // Even if legacy unit_value has values, that doesn't prove physical count,
  // acquisition proof, labor allocation, actual sold qty or actual cost.
  issues.push("Biaya bahan, tenaga kerja, overhead dan reject per batch belum disahkan dengan bukti terpisah.");
  issues.push("CAFE_OUT belum tertaut lot asal; penjualan dan HPP produk terjual perlu alokasi sumber nyata.");
  return {
    batchId:asId(batch.id),
    rawTransactionCount:materials.length,
    materialCostUnverifiedCount:missingCost.length,
    rootSplitCount:roots.length,
    derivedSplitCount:derived.length,
    directReleaseCount:releases.filter(r=>r.route==="DIRECT").length,
    frozenReleaseCount:releases.filter(r=>r.route==="FROZEN").length,
    otherStockMovementCount:stockMovements.filter(m=>m.movement_type==="FROZEN_OUT").length,
    releaseRows:releases, issues,
    sourceCompletenessVerified:false,
    actualHppKnown:false,
    readyToPost:false, writesDatabase:false,
  };
}
