/**
 * Read-only source audit for a single month, scoped to Owner-only UI.
 * Uses authenticated Supabase queries, RLS, and paginates every source.
 * NO INSERT/UPDATE/DELETE, schema changes, or journal posting.
 */
import { supabase } from "../lib/supabase";
import { buildAccountingSourceReadiness, nextReportMonth } from "../utils/accountingSourceReadiness";

const PAGE_SIZE = 500;
const MAX_ROWS = 50000;

async function fetchCompletePages(createQuery, label) {
  const results = [];
  for (let start = 0; start < MAX_ROWS; start += PAGE_SIZE) {
    const { data, error } = await createQuery()
      .range(start, start + PAGE_SIZE - 1);
    if (error) throw new Error("Gagal membaca " + label + ": " + error.message);
    if (!Array.isArray(data)) throw new Error("Data " + label + " tidak dapat diverifikasi.");
    results.push(...data);
    if (data.length < PAGE_SIZE) return results;
  }
  throw new Error(label + " melebihi batas audit 50.000 transaksi; hasil parsial tidak digunakan.");
}

export async function loadAccountingSourceReadiness(month) {
  const nextMonth = nextReportMonth(month);
  const begin = month + "-01";
  const end = nextMonth + "-01";

  const [
    sales, incomes, expenses, purchases, productMovements, ingredientMovements,
  ] = await Promise.all([
    fetchCompletePages(() => supabase.from("sales")
      .select("id,sale_date,sales_channel,total_amount,is_deleted")
      .eq("is_deleted", false)
      .gte("sale_date", begin).lt("sale_date", end)
      .order("id", { ascending: true }), "Sales"),
    fetchCompletePages(() => supabase.from("incomes")
      .select("id,tanggal,asal_setoran,pemasukan_bunbun,is_deleted")
      .eq("is_deleted", false)
      .gte("tanggal", begin).lt("tanggal", end)
      .order("id", { ascending: true }), "Pemasukan"),
    fetchCompletePages(() => supabase.from("expenses")
      .select("id,tanggal,kategori,nominal,purchase_id,is_deleted")
      .eq("is_deleted", false)
      .gte("tanggal", begin).lt("tanggal", end)
      .order("id", { ascending: true }), "Pengeluaran"),
    fetchCompletePages(() => supabase.from("purchases")
      .select("id,tanggal,total,ingredient_id,maintenance_item_id,is_deleted")
      .eq("is_deleted", false)
      .gte("tanggal", begin).lt("tanggal", end)
      .order("id", { ascending: true }), "Purchasing"),
    fetchCompletePages(() => supabase.from("product_stock_movements")
      .select("id,movement_date,movement_type,sale_id,qty,is_deleted")
      .eq("is_deleted", false)
      .gte("movement_date", begin).lt("movement_date", end)
      .order("id", { ascending: true }), "Mutasi stok produk"),
    fetchCompletePages(() => supabase.from("inventory_transactions")
      .select("id,transaction_date,transaction_type,unit_value,is_deleted")
      .eq("is_deleted", false)
      .gte("transaction_date", begin).lt("transaction_date", end)
      .order("id", { ascending: true }), "Mutasi bahan"),
  ]);

  return buildAccountingSourceReadiness({
    month, sales, incomes, expenses, purchases,
    productMovements, ingredientMovements,
  });
}
