import { supabase } from "../lib/supabase";

const SALES_TABLE = "sales";
const ITEMS_TABLE = "sale_items";

const CHANNEL_LABELS = {
  PUBLIC_HUB: "Public Hub",
  PUBLIC_COFFEE: "The Public Coffee",
  DIRECT: "Direct / Online",
  CAFE_OTHER: "Cafe Lain",
};

const ORDER_TYPE_LABELS = {
  DINE_IN: "Dine In",
  TAKE_AWAY: "Take Away",
};

function mapSaleItem(row) {
  return {
    id: row.id,
    saleId: row.sale_id,
    productId: row.product_id,
    productSku: row.product_sku || "",
    productName: row.product_name || "",
    quantity: Number(row.quantity || 0),
    sellingPrice: Number(row.selling_price || 0),
    subtotal: Number(row.subtotal || 0),
    orderType: row.order_type || "",
    orderTypeLabel: ORDER_TYPE_LABELS[row.order_type] || "Belum diisi",
  };
}

function mapSale(row) {
  return {
    id: row.id,
    saleDate: row.sale_date,
    salesChannel: row.sales_channel,
    channelLabel: CHANNEL_LABELS[row.sales_channel] || row.sales_channel,
    totalAmount: Number(row.total_amount || 0),
    notes: row.notes || "",
    items: (row.sale_items || []).map(mapSaleItem),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getCurrentUser() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) throw error;
  if (!user) throw new Error("Pengguna belum login.");

  return user;
}

function normalizeOrderType(value) {
  if (value === "DINE_IN") return "DINE_IN";
  if (value === "TAKE_AWAY") return "TAKE_AWAY";
  return "";
}

function normalizeItems(items = []) {
  return items
    .filter(
      (item) =>
        item &&
        item.productId &&
        Number(item.quantity) > 0
    )
    .map((item) => {
      const quantity = Number(item.quantity);
      const sellingPrice = Number(item.sellingPrice || 0);
      const orderType = normalizeOrderType(item.orderType);

      if (!orderType) {
        throw new Error(
          `Jenis pesanan untuk ${item.productName || "produk"} wajib dipilih.`
        );
      }

      return {
        productId: Number(item.productId),
        productSku: item.productSku || "",
        productName: item.productName || "",
        quantity,
        sellingPrice,
        subtotal: quantity * sellingPrice,
        orderType,
      };
    });
}

function buildItemPayload(saleId, items) {
  return items.map((item) => ({
    sale_id: saleId,
    product_id: item.productId,
    product_sku: item.productSku,
    product_name: item.productName,
    quantity: item.quantity,
    selling_price: item.sellingPrice,
    subtotal: item.subtotal,
    order_type: item.orderType,
  }));
}

export async function getAllSales() {
  const { data, error } = await supabase
    .from(SALES_TABLE)
    .select(`
      *,
      sale_items (
        id,
        sale_id,
        product_id,
        product_sku,
        product_name,
        quantity,
        selling_price,
        subtotal,
        order_type
      )
    `)
    .eq("is_deleted", false)
    .order("sale_date", { ascending: false })
    .order("id", { ascending: false });

  if (error) throw error;
  return (data || []).map(mapSale);
}

export async function createSale(sale) {
  const user = await getCurrentUser();
  const items = normalizeItems(sale.items);

  if (items.length === 0) {
    throw new Error("Minimal harus ada satu produk dalam penjualan.");
  }

  const totalAmount = items.reduce(
    (total, item) => total + item.subtotal,
    0
  );

  const salePayload = {
    sale_date:
      sale.saleDate || new Date().toISOString().slice(0, 10),
    sales_channel: sale.salesChannel,
    total_amount: totalAmount,
    notes: sale.notes?.trim() || null,
    is_deleted: false,
    created_by: user.id,
    updated_by: user.id,
  };

  const { data: saleData, error: saleError } = await supabase
    .from(SALES_TABLE)
    .insert(salePayload)
    .select("*")
    .single();

  if (saleError) throw saleError;

  const { data: itemData, error: itemError } = await supabase
    .from(ITEMS_TABLE)
    .insert(buildItemPayload(saleData.id, items))
    .select("*");

  if (itemError) {
    await supabase.from(SALES_TABLE).delete().eq("id", saleData.id);
    throw itemError;
  }

  return mapSale({ ...saleData, sale_items: itemData });
}

export async function updateSale(saleId, sale) {
  const user = await getCurrentUser();
  const items = normalizeItems(sale.items);

  if (items.length === 0) {
    throw new Error("Minimal harus ada satu produk dalam penjualan.");
  }

  const totalAmount = items.reduce(
    (total, item) => total + item.subtotal,
    0
  );

  const { data: saleData, error: saleError } = await supabase
    .from(SALES_TABLE)
    .update({
      sale_date: sale.saleDate,
      sales_channel: sale.salesChannel,
      total_amount: totalAmount,
      notes: sale.notes?.trim() || null,
      updated_by: user.id,
    })
    .eq("id", saleId)
    .select("*")
    .single();

  if (saleError) throw saleError;

  const { error: deleteItemsError } = await supabase
    .from(ITEMS_TABLE)
    .delete()
    .eq("sale_id", saleId);

  if (deleteItemsError) throw deleteItemsError;

  const { data: itemData, error: itemError } = await supabase
    .from(ITEMS_TABLE)
    .insert(buildItemPayload(saleId, items))
    .select("*");

  if (itemError) throw itemError;

  return mapSale({ ...saleData, sale_items: itemData });
}

export async function softDeleteSale(saleId) {
  const user = await getCurrentUser();

  const { error } = await supabase
    .from(SALES_TABLE)
    .update({ is_deleted: true, updated_by: user.id })
    .eq("id", saleId);

  if (error) throw error;
}

export function getSalesChannelLabel(channel) {
  return CHANNEL_LABELS[channel] || channel || "-";
}

export function getOrderTypeLabel(orderType) {
  return ORDER_TYPE_LABELS[orderType] || "Belum diisi";
}
