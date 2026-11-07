/**
 * Production lot inspection on the Owner HPP Audit page. SELECT only.
 * Loads full stock movement history for the batch's split IDs, paginated.
 * All financial amounts remain unknown until independent verification.
 */
import { supabase } from "../lib/supabase";
import { getBatchCostingSnapshot } from "./batchCostingReadService";
import { assessBatchLotSources } from "../utils/accountingBatchLotAudit";

const PAGE_SIZE = 500;
const LIMIT = 20000;

export async function getBatchLotSourceAudit(batchId) {
  const base = await getBatchCostingSnapshot(batchId);
  const splitIds = base.splits.map(s => s.id);
  const stockMovements = [];
  if (splitIds.length) {
    if (splitIds.length > 200) throw new Error("Batch memiliki terlalu banyak split untuk satu audit.");
    let finished = false;
    for (let offset = 0; offset < LIMIT; offset += PAGE_SIZE) {
      const { data, error } = await supabase.from("product_stock_movements")
        .select("id,movement_date,movement_type,batch_split_id,product_id,qty,is_deleted")
        .eq("is_deleted",false).in("batch_split_id",splitIds)
        .in("movement_type",["FINISHED_IN","FROZEN_IN","FROZEN_OUT"])
        .order("id",{ascending:true}).range(offset,offset+PAGE_SIZE-1);
      if (error) throw new Error("Gagal memeriksa mutasi lot: " + error.message);
      if (!Array.isArray(data)) throw new Error("Mutasi lot tidak dapat dibaca.");
      stockMovements.push(...data);
      if (data.length < PAGE_SIZE) { finished = true; break; }
    }
    if (!finished) throw new Error("Mutasi lot melampaui batas audit; hasil parsial tidak dipakai.");
  }
  return {
    ...base,
    stockMovements,
    lotAudit:assessBatchLotSources({
      batch:base.batch, materials:base.materials,
      splits:base.splits,stockMovements,
    }),
  };
}
