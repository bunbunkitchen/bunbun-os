/**
 * Bunbun OS: read-only production batch costing data adapter.
 * No writes and no changes to existing HPP or stock logic.
 */
import { supabase } from "../lib/supabase";
import { assessBatchCostingSnapshot } from "../utils/hppBatchAssessment";

const active = (query) => query.eq("is_deleted", false);

export async function getBatchCostingSnapshot(batchId) {
  if (!Number.isInteger(Number(batchId)) || Number(batchId) <= 0) {
    throw new Error("ID batch tidak valid.");
  }

  const { data: batch, error: batchError } = await active(
    supabase.from("production_batches").select(
      "id,kode,production_order_id,target,selesai,reject,status,inventory_consumed"
    )
  ).eq("id", Number(batchId)).single();
  if (batchError) throw batchError;

  const [materialsResult, splitsResult] = await Promise.all([
    active(supabase.from("inventory_transactions").select(
      "id,transaction_date,transaction_type,ingredient_id,qty,unit,unit_value,purchase_id,created_at",
      { count: "exact" }
    )).eq("production_batch_id", Number(batchId)).eq("transaction_type", "PRODUCTION_OUT"),
    active(supabase.from("production_batch_splits").select(
      "id,product_id,source_split_id,route,lot_code,qty,baked_good_qty,baked_reject_qty,status",
      { count: "exact" }
    )).eq("production_batch_id", Number(batchId)),
  ]);
  if (materialsResult.error) throw materialsResult.error;
  if (splitsResult.error) throw splitsResult.error;

  const materials = materialsResult.data ?? [];
  const splits = splitsResult.data ?? [];
  // Supabase Data API may cap rows. Partial batch reads are not valid costing
  // evidence, even if all returned rows appear internally consistent.
  if (materialsResult.count === null || splitsResult.count === null ||
    materials.length !== materialsResult.count ||
    splits.length !== splitsResult.count) {
    throw new Error("Data batch melebihi batas query; audit parsial ditolak.");
  }
  return {
    batch,
    materials,
    splits,
    ...assessBatchCostingSnapshot({ batch, materials, splits }),
    // A split quantity or batch status is not the final usable yield.
  };
}
