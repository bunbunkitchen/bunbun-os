/**
 * Owner-only UI read adapter — links sales -> sale_items -> stock CAFE_OUT.
 *
 * All tables are read-only, through current user's Supabase RLS session.
 * Query by explicit original sale IDs, not approximate product/date matching.
 * Cross-month stock links are retained because a linked movement can have
 * a different date. Orphan CAFE_OUT is filtered by movement_date.
 *
 * Refuse incomplete pages and changed row counts (never use partial reports).
 */
import { supabase } from "../lib/supabase";
import { reconcileSaleStockSourceRows } from "../utils/accountingSaleStockReconciliation";
import { nextReportMonth } from "../utils/accountingSourceReadiness";

const PAGE_SIZE = 400;
const CHUNK = 90;
const MAX_ROWS = 50000;

async function readAll(createQuery, label) {
  let expected = null;
  const rows = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
    const { data, count, error } = await createQuery()
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error("Gagal memuat " + label + ": " + error.message);
    if (!Array.isArray(data) || !Number.isSafeInteger(count) || count < 0 ||
      (expected !== null && count !== expected)) {
      throw new Error(label + " berubah ketika dibaca atau jumlah data tidak lengkap.");
    }
    expected = count;
    rows.push(...data);
    if (rows.length === expected) return rows;
    if (data.length < PAGE_SIZE || rows.length > expected) {
      throw new Error(label + " terbaca sebagian; hasil audit ditolak.");
    }
  }
  throw new Error(label + " melebihi batas baca 50.000 baris.");
}

async function readBySaleIds(ids, table, fields, extra = query => query) {
  const all = [];
  for (let start = 0; start < ids.length; start += CHUNK) {
    const subset = ids.slice(start, start + CHUNK);
    const rows = await readAll(() => extra(
      supabase.from(table)
        .select(fields, { count: "exact" })
        .in("sale_id", subset),
    ), table);
    all.push(...rows);
    if (all.length > MAX_ROWS) {
      throw new Error(table + " melebihi batas audit; hasil parsial ditolak.");
    }
  }
  return all;
}

export async function loadMonthlySaleStockLinkAudit(month) {
  const next = nextReportMonth(month);
  const first = month + "-01";
  const exclusiveEnd = next + "-01";
  const sales = await readAll(() => supabase.from("sales")
    .select("id,sale_date,sales_channel,total_amount,is_deleted", { count: "exact" })
    .eq("is_deleted", false)
    .gte("sale_date", first)
    .lt("sale_date", exclusiveEnd), "sales");

  const saleIds = sales.map(row => row.id);
  const [saleItems, movements, orphanMovements] = await Promise.all([
    readBySaleIds(saleIds, "sale_items",
      "id,sale_id,product_id,quantity,subtotal,order_type"),
    readBySaleIds(saleIds, "product_stock_movements",
      "id,movement_date,movement_type,sale_id,product_id,qty,batch_split_id,is_deleted",
      query => query.eq("is_deleted", false)),
    readAll(() => supabase.from("product_stock_movements")
      .select("id,movement_date,movement_type,sale_id,product_id,qty,batch_split_id,is_deleted",
        { count: "exact" })
      .eq("is_deleted", false)
      .eq("movement_type", "CAFE_OUT")
      .is("sale_id", null)
      .gte("movement_date", first).lt("movement_date", exclusiveEnd),
    "CAFE_OUT tanpa sale_id"),
  ]);

  return reconcileSaleStockSourceRows({
    month, sales, saleItems, movements, orphanMovements,
  });
}
