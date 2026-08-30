import { supabase } from "../lib/supabase";

const SPLIT_TABLE = "production_batch_splits";
const MOVEMENT_TABLE = "product_stock_movements";

function createUuid() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  if (typeof globalThis.crypto?.getRandomValues !== "function") {
    throw new Error("Browser tidak mendukung pembuatan operation key.");
  }

  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createProductStockOperationKey() {
  return createUuid();
}

export function getProductStockErrorMessage(error) {
  const message = String(error?.message || "").trim();
  if (!message) return "Proses stok produk gagal. Silakan coba lagi.";
  if (message.includes("Akses operasional")) return "Anda tidak memiliki akses untuk memproses stok produk.";
  if (message.includes("Permintaan ini sudah pernah dicatat")) return "Tindakan ini sudah diproses. Hindari mengirim ulang tindakan yang sama.";
  if (message.includes("Stok frozen lot tidak cukup")) return message;
  if (message.includes("Stok produk jadi tidak cukup")) return message;
  if (message.includes("Produk aktif tidak ditemukan")) return "Produk tidak aktif atau tidak ditemukan.";
  return message;
}

function throwProductStockError(error) {
  throw new Error(getProductStockErrorMessage(error));
}

export async function invokeFrozenFlowRpc(functionName, params, operationKey) {
  const key = operationKey || createProductStockOperationKey();
  const { data, error } = await supabase.rpc(functionName, { ...params, p_operation_key: key });
  if (error) throwProductStockError(error);
  return { ...(data ?? {}), operationKey: key };
}

function mapSplit(row) {
  return {
    id: row.id,
    productionBatchId: row.production_batch_id,
    productId: row.product_id,
    productSku: row.products?.sku ?? "",
    productNama: row.products?.nama ?? "",
    sourceSplitId: row.source_split_id,
    sourceLotCode: row.source_split?.lot_code ?? (row.source_split_id ? row.lot_code ?? "" : ""),
    route: row.route,
    lotCode: row.lot_code ?? "",
    qty: Number(row.qty || 0),
    bakedGoodQty: Number(row.baked_good_qty || 0),
    bakedRejectQty: Number(row.baked_reject_qty || 0),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMovement(row) {
  return {
    id: row.id,
    tanggal: row.movement_date,
    tipe: row.movement_type,
    productId: row.product_id,
    productSku: row.products?.sku ?? "",
    productNama: row.products?.nama ?? "",
    batchSplitId: row.batch_split_id,
    lotCode: row.production_batch_splits?.lot_code ?? "",
    jumlah: Number(row.qty || 0),
    satuan: row.unit,
    keterangan: row.notes ?? "",
    operationKey: row.operation_key,
    saleId: row.sale_id,
    createdAt: row.created_at,
  };
}

export async function getProductionBatchSplits(productionBatchId) {
  const { data, error } = await supabase.from(SPLIT_TABLE).select(`*, products (sku, nama)`).eq("production_batch_id", productionBatchId).eq("is_deleted", false).order("created_at", { ascending: true });
  if (error) throwProductStockError(error);
  return (data ?? []).map(mapSplit);
}

export async function getFrozenProcessingSplits() {
  const { data, error } = await supabase.from(SPLIT_TABLE).select(`*, products (sku, nama)`).eq("route", "DIRECT").not("source_split_id", "is", null).in("status", ["PROOFING", "BAKING"]).eq("is_deleted", false).order("created_at", { ascending: true });
  if (error) throwProductStockError(error);
  return (data ?? []).map(mapSplit);
}

export async function getProductStockMovements({ productId, batchSplitId, movementTypes } = {}) {
  let query = supabase.from(MOVEMENT_TABLE).select(`*, products (sku, nama), production_batch_splits (lot_code)`).eq("is_deleted", false).order("movement_date", { ascending: false }).order("created_at", { ascending: false });
  if (productId) query = query.eq("product_id", productId);
  if (batchSplitId) query = query.eq("batch_split_id", batchSplitId);
  if (movementTypes?.length) query = query.in("movement_type", movementTypes);
  const { data, error } = await query;
  if (error) throwProductStockError(error);
  return (data ?? []).map(mapMovement);
}

export async function getFrozenStockByProductAndLot() {
  const movements = await getProductStockMovements({ movementTypes: ["FROZEN_IN", "FROZEN_OUT"] });
  const lots = new Map();
  movements.forEach((movement) => {
    if (!movement.batchSplitId) return;
    const current = lots.get(movement.batchSplitId) || { lotId: movement.batchSplitId, lotCode: movement.lotCode, productId: movement.productId, productSku: movement.productSku, productNama: movement.productNama, masuk: 0, keluar: 0, saldo: 0 };
    if (movement.tipe === "FROZEN_IN") current.masuk += movement.jumlah;
    if (movement.tipe === "FROZEN_OUT") current.keluar += movement.jumlah;
    current.saldo = current.masuk - current.keluar;
    lots.set(movement.batchSplitId, current);
  });
  return Array.from(lots.values()).sort((a, b) => `${a.productNama}-${a.lotCode}`.localeCompare(`${b.productNama}-${b.lotCode}`, "id"));
}

export async function getAvailableFrozenLots() {
  const lots = await getFrozenStockByProductAndLot();
  return lots.filter((lot) => lot.saldo > 0);
}

export async function getFinishedProductBalances() {
  const movements = await getProductStockMovements({ movementTypes: ["FINISHED_IN", "CAFE_OUT", "CAFE_IN", "OPENING_BALANCE"] });
  const products = new Map();
  movements.forEach((movement) => {
    const current = products.get(movement.productId) || { productId: movement.productId, productSku: movement.productSku, productNama: movement.productNama, masuk: 0, keluar: 0, saldo: 0 };
    if (["FINISHED_IN", "OPENING_BALANCE", "CAFE_IN"].includes(movement.tipe)) current.masuk += movement.jumlah;
    if (movement.tipe === "CAFE_OUT") current.keluar += movement.jumlah;
    current.saldo = current.masuk - current.keluar;
    products.set(movement.productId, current);
  });
  return Array.from(products.values()).sort((a, b) => a.productNama.localeCompare(b.productNama, "id"));
}

export async function recordCafeDeposit({ productId, qty, movementDate, notes, operationKey }) {
  return invokeFrozenFlowRpc("record_cafe_deposit", { p_product_id: Number(productId), p_qty: Number(qty), p_movement_date: movementDate, p_notes: notes || null }, operationKey);
}

export async function recordMultiProductRelease({ movementDate, destination, notes, items, operationKey }) {
  const key = operationKey || createProductStockOperationKey();
  const payload = items.map((item) => ({ productId: Number(item.productId), quantity: Number(item.quantity) }));
  const { data, error } = await supabase.rpc("record_multi_product_release", {
    p_movement_date: movementDate,
    p_destination: destination,
    p_notes: notes?.trim() || null,
    p_items: payload,
    p_operation_key: key,
  });
  if (error) throwProductStockError(error);
  return { ...(data ?? {}), operationKey: key };
}
