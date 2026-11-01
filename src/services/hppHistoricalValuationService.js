/**
 * Read-only adapter for per-ingredient historical MWA reconciliation.
 * No RPC, inserts, updates or deletes.
 */
import { supabase } from "../lib/supabase";
import { reconstructIngredientMWA } from "../utils/hppHistoricalValuation";

async function loadPages(factory) {
  const results = [];
  for (let page = 0; page < 100; page++) {
    const { data, error } = await factory().range(page * 500, (page + 1) * 500 - 1);
    if (error) throw error;
    results.push(...(data || []));
    if (!data || data.length < 500) return results;
  }
  throw new Error("Melebihi batas audit 50.000 baris untuk satu bahan.");
}

export async function getHistoricalIngredientAudit(ingredientId) {
  const id = Number(ingredientId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("ID bahan tidak valid.");
  const [ingredientResult, purchases, movements] = await Promise.all([
    supabase.from("ingredients").select("id,nama,satuan")
      .eq("id", id).single(),
    loadPages(() => supabase.from("purchases")
      .select("id,ingredient_id,tanggal,jumlah,satuan,total,is_deleted")
      .eq("ingredient_id", id).order("id", { ascending: true })),
    loadPages(() => supabase.from("inventory_transactions")
      .select("id,ingredient_id,transaction_date,transaction_type,qty,unit,purchase_id,unit_value,stock_source,production_batch_id,is_deleted")
      .eq("ingredient_id", id).eq("is_deleted", false)
      .order("transaction_date", { ascending: true })
      .order("id", { ascending: true })),
  ]);
  if (ingredientResult.error) throw ingredientResult.error;
  // Opening balance is intentionally unspecified: no zero opening is assumed.
  return reconstructIngredientMWA({
    ingredient: ingredientResult.data, purchases, movements, opening: null,
  });
}
