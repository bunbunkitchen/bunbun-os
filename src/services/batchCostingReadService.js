/**
 * Bunbun OS: read-only production batch costing data adapter.
 * No writes and no changes to existing HPP or stock logic.
 */
import { supabase } from "../lib/supabase";

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
      "id,transaction_date,transaction_type,ingredient_id,qty,unit,unit_value,purchase_id,created_at"
    )).eq("production_batch_id", Number(batchId)).eq("transaction_type", "PRODUCTION_OUT"),
    active(supabase.from("production_batch_splits").select(
      "id,product_id,source_split_id,route,lot_code,qty,baked_good_qty,baked_reject_qty,status"
    )).eq("production_batch_id", Number(batchId)),
  ]);
  if (materialsResult.error) throw materialsResult.error;
  if (splitsResult.error) throw splitsResult.error;

  const materials = materialsResult.data ?? [];
  const splits = splitsResult.data ?? [];
  const missingMaterialValues = materials.filter(
    (m) => m.unit_value === null || m.unit_value === undefined
  ).map((m) => m.id);

  return {
    batch,
    materials,
    splits,
    costingStatus: missingMaterialValues.length ? "NEEDS_VALUATION" : "READY_FOR_REVIEW",
    missingMaterialValues,
    // Never infer final yield solely from batch.status or split.qty.
    // Labor, overhead, valuation, and final output allocation are separate stages.
  };
}
