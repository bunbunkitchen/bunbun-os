/** Pure, conservative checks; no monetary costs are calculated here. */
export function assessBatchCostingSnapshot({ batch, materials = [], splits = [] }) {
  if (!batch || !Array.isArray(materials) || !Array.isArray(splits)) {
    throw new Error("Data batch tidak lengkap.");
  }
  const missingMaterialValues = materials
    .filter((line) => line.unit_value === null || line.unit_value === undefined)
    .map((line) => line.id);
  const warnings = [];
  if (!materials.length) warnings.push("Tidak ada transaksi pemakaian bahan untuk batch ini.");
  if (missingMaterialValues.length) {
    warnings.push(`${missingMaterialValues.length} transaksi pemakaian bahan belum memiliki unit_value.`);
  }
  if (materials.some((line) => !Number.isFinite(Number(line.qty)) || Number(line.qty) <= 0)) {
    warnings.push("Ada kuantitas pemakaian bahan tidak valid.");
  }
  if (materials.some((line) => line.ingredient_id === null || line.ingredient_id === undefined)) {
    warnings.push("Ada pemakaian bahan tanpa ingredient_id; sub-recipe perlu ditelusuri.");
  }
  if (!splits.length) warnings.push("Belum ada split/hasil produksi yang tercatat.");
  if (new Set(splits.map((row) => String(row.id))).size !== splits.length) {
    warnings.push("ID split duplikat; hasil produksi harus diperiksa.");
  }
  return {
    warnings,
    missingMaterialValues,
    costingStatus: missingMaterialValues.length ? "NEEDS_VALUATION" :
      warnings.length ? "NEEDS_RECONCILIATION" : "NEEDS_COST_APPROVAL",
    // Having a unit_value alone is NOT evidence of a completed MWA reconciliation.
    readyToPost: false,
  };
}
