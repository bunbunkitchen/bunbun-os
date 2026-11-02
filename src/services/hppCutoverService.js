/**
 * Cutover data source: only SELECT; no writes to existing cash/stock flows.
 * Active stock movements on dates strictly BEFORE the proposed cutover.
 */
import { supabase } from "../lib/supabase";
import { buildCutoverIngredientReview, isValidIsoDate } from "../utils/hppCutoverOpening";

async function loadAll(factory) {
  const pageSize = 500;
  const all = [];
  for (let page = 0; page < 100; page++) {
    const { data, error } = await factory().range(page * pageSize, (page + 1) * pageSize - 1);
    if (error) throw error;
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < pageSize) return all;
  }
  throw new Error("Audit melampaui 50.000 baris; gunakan cakupan yang lebih kecil.");
}

export async function getProposedCutoverInventory(cutoverDate) {
  if (!isValidIsoDate(cutoverDate)) throw new Error("Tanggal cutover harus valid.");
  const [ingredients, movements] = await Promise.all([
    loadAll(() => supabase.from("ingredients")
      .select("id,nama,satuan,is_deleted")
      .eq("is_deleted", false).order("id", { ascending: true })),
    loadAll(() => supabase.from("inventory_transactions")
      .select("id,ingredient_id,transaction_date,transaction_type,qty,unit,is_deleted")
      .eq("is_deleted", false)
      .lt("transaction_date", cutoverDate)
      .order("transaction_date", { ascending: true })
      .order("id", { ascending: true })),
  ]);

  return buildCutoverIngredientReview({ cutoverDate, ingredients, movements });
}
