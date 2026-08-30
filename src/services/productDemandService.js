import { supabase } from "../lib/supabase";

function getLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getCurrentMonthRange() {
  const now = new Date();
  return {
    monthStart: getLocalDateString(new Date(now.getFullYear(), now.getMonth(), 1)),
    monthEnd: getLocalDateString(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
}

function sortTop(map) {
  return Array.from(map.values())
    .sort((a, b) => b.qty - a.qty || a.nama.localeCompare(b.nama, "id"))
    .slice(0, 5);
}

export async function getProductDemandInsights() {
  const { monthStart, monthEnd } = getCurrentMonthRange();

  const [salesResult, movementResult] = await Promise.all([
    supabase
      .from("sales")
      .select(`
        id,
        sale_date,
        is_deleted,
        sale_items (
          product_id,
          product_name,
          quantity
        )
      `)
      .gte("sale_date", monthStart)
      .lte("sale_date", monthEnd)
      .eq("is_deleted", false),

    supabase
      .from("product_stock_movements")
      .select(`
        product_id,
        qty,
        movement_type,
        products (
          nama
        )
      `)
      .gte("movement_date", monthStart)
      .lte("movement_date", monthEnd)
      .eq("is_deleted", false)
      .eq("movement_type", "CAFE_OUT"),
  ]);

  if (salesResult.error) throw salesResult.error;
  if (movementResult.error) throw movementResult.error;

  const salesMap = new Map();
  (salesResult.data ?? []).forEach((sale) => {
    (sale.sale_items ?? []).forEach((item) => {
      const id = item.product_id;
      const current = salesMap.get(id) || {
        productId: id,
        nama: item.product_name || "Produk tidak diketahui",
        qty: 0,
      };
      current.qty += Number(item.quantity || 0);
      salesMap.set(id, current);
    });
  });

  const outgoingMap = new Map();
  (movementResult.data ?? []).forEach((movement) => {
    const id = movement.product_id;
    const current = outgoingMap.get(id) || {
      productId: id,
      nama: movement.products?.nama || "Produk tidak diketahui",
      qty: 0,
    };
    current.qty += Number(movement.qty || 0);
    outgoingMap.set(id, current);
  });

  return {
    topProductsBySales: sortTop(salesMap),
    topProductsByOutgoing: sortTop(outgoingMap),
  };
}
