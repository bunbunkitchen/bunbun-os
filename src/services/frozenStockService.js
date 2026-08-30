import { supabase } from "../lib/supabase";

const MOVEMENT_TABLE = "product_stock_movements";

export async function getFrozenProductBalances() {
  const { data, error } = await supabase
    .from(MOVEMENT_TABLE)
    .select(`
      product_id,
      movement_type,
      qty,
      products (
        sku,
        nama
      )
    `)
    .eq("is_deleted", false)
    .in("movement_type", ["FROZEN_IN", "FROZEN_OUT"]);

  if (error) throw error;

  const products = new Map();

  for (const row of data ?? []) {
    if (!row.product_id) continue;

    const current = products.get(row.product_id) || {
      productId: row.product_id,
      productSku: row.products?.sku ?? "",
      productNama: row.products?.nama ?? "",
      masuk: 0,
      keluar: 0,
      saldo: 0,
    };

    const qty = Number(row.qty || 0);

    if (row.movement_type === "FROZEN_IN") {
      current.masuk += qty;
    } else if (row.movement_type === "FROZEN_OUT") {
      current.keluar += qty;
    }

    current.saldo = current.masuk - current.keluar;
    products.set(row.product_id, current);
  }

  return Array.from(products.values())
    .filter((item) => item.saldo !== 0)
    .sort((a, b) => a.productNama.localeCompare(b.productNama, "id"));
}
