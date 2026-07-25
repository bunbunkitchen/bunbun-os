import { supabase } from "../lib/supabase";
import { createInventoryTransaction } from "./inventoryService";
import { createExpense } from "./expenseService";

const TABLE_NAME = "purchases";

function mapPurchase(row) {
  return {
    id: row.id,
    tanggal: row.tanggal,
    supplierId: row.supplier_id,
    supplierNama: row.suppliers?.nama ?? "",
    ingredientId: row.ingredient_id,
    ingredientKode: row.ingredients?.kode ?? "",
    ingredientNama: row.ingredients?.nama ?? "",
    jumlah: Number(row.jumlah),
    satuan: row.satuan,
    hargaSatuan: Number(row.harga_satuan),
    total: Number(row.total),
    keterangan: row.keterangan ?? "",
  };
}

async function getCurrentUser() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    throw error;
  }

  if (!user) {
    throw new Error("Pengguna belum login.");
  }

  return user;
}

export async function getAllPurchases() {
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select(`
      *,
      suppliers (
        nama
      ),
      ingredients (
        kode,
        nama
      )
    `)
    .eq("is_deleted", false)
    .order("tanggal", {
      ascending: false,
    })
    .order("created_at", {
      ascending: false,
    });

  if (error) {
    throw error;
  }

  return (data ?? []).map(mapPurchase);
}

export async function createPurchase(purchase) {
  const user = await getCurrentUser();

  const jumlah = Number(purchase.jumlah);
  const hargaSatuan = Number(purchase.hargaSatuan);
  const total = jumlah * hargaSatuan;

  const payload = {
    tanggal: purchase.tanggal,
    supplier_id:
      purchase.supplierId || null,
    ingredient_id:
      purchase.ingredientId,
    jumlah,
    satuan: purchase.satuan,
    harga_satuan: hargaSatuan,
    total,
    keterangan:
      purchase.keterangan || null,
    created_by: user.id,
    updated_by: user.id,
  };

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .insert(payload)
    .select(`
      *,
      suppliers (
        nama
      ),
      ingredients (
        kode,
        nama
      )
    `)
    .single();

  if (error) {
    throw error;
  }

  const savedPurchase = mapPurchase(data);

await createInventoryTransaction({
  tanggal: savedPurchase.tanggal,
  tipe: "PURCHASE",
  ingredientId:
    savedPurchase.ingredientId,
  recipeId: null,
  productionBatchId: null,
  purchaseId: savedPurchase.id,
  jumlah: savedPurchase.jumlah,
  satuan: savedPurchase.satuan,
  keterangan: `Pembelian bahan baku${
    savedPurchase.supplierNama
      ? ` dari ${savedPurchase.supplierNama}`
      : ""
  }`,
});

await createExpense({
  tanggal: savedPurchase.tanggal,
  kategori: "Bahan Baku",
  nominal: savedPurchase.total,
  purchaseId: savedPurchase.id,
  keterangan: `Pembelian ${savedPurchase.ingredientNama}${
    savedPurchase.supplierNama
      ? ` dari ${savedPurchase.supplierNama}`
      : ""
  }`,
});

return savedPurchase;
}

export async function updatePurchase(
  purchaseId,
  purchase
) {
  const user = await getCurrentUser();

  const jumlah = Number(purchase.jumlah);
  const hargaSatuan = Number(
    purchase.hargaSatuan
  );
  const total = jumlah * hargaSatuan;

  const purchasePayload = {
    tanggal: purchase.tanggal,
    supplier_id:
      purchase.supplierId || null,
    ingredient_id:
      purchase.ingredientId,
    jumlah,
    satuan: purchase.satuan,
    harga_satuan: hargaSatuan,
    total,
    keterangan:
      purchase.keterangan || null,
    updated_by: user.id,
  };

  const {
    data: purchaseData,
    error: purchaseError,
  } = await supabase
    .from(TABLE_NAME)
    .update(purchasePayload)
    .eq("id", purchaseId)
    .select(`
      *,
      suppliers (
        nama
      ),
      ingredients (
        kode,
        nama
      )
    `)
    .single();

  if (purchaseError) {
    throw purchaseError;
  }

  const updatedPurchase =
    mapPurchase(purchaseData);

  const {
    error: inventoryError,
  } = await supabase
    .from("inventory_transactions")
    .update({
      transaction_date:
        updatedPurchase.tanggal,
      ingredient_id:
        updatedPurchase.ingredientId,
      qty: updatedPurchase.jumlah,
      unit: updatedPurchase.satuan,
      notes: `Pembelian bahan baku${
        updatedPurchase.supplierNama
          ? ` dari ${updatedPurchase.supplierNama}`
          : ""
      }`,
      updated_by: user.id,
    })
    .eq("purchase_id", purchaseId)
    .eq("transaction_type", "PURCHASE")
    .eq("is_deleted", false);

  if (inventoryError) {
    throw inventoryError;
  }

  const {
    error: expenseError,
  } = await supabase
    .from("expenses")
    .update({
      tanggal:
        updatedPurchase.tanggal,
      nominal:
        updatedPurchase.total,
      keterangan: `Pembelian ${updatedPurchase.ingredientNama}${
        updatedPurchase.supplierNama
          ? ` dari ${updatedPurchase.supplierNama}`
          : ""
      }`,
      updated_by: user.id,
    })
    .eq("purchase_id", purchaseId)
    .eq("is_deleted", false);

  if (expenseError) {
    throw expenseError;
  }

  return updatedPurchase;
}

export async function softDeletePurchase(
  purchaseId
) {
  const user = await getCurrentUser();

  const {
    error: purchaseError,
  } = await supabase
    .from(TABLE_NAME)
    .update({
      is_deleted: true,
      updated_by: user.id,
    })
    .eq("id", purchaseId);

  if (purchaseError) {
    throw purchaseError;
  }

  const {
    error: inventoryError,
  } = await supabase
    .from("inventory_transactions")
    .update({
      is_deleted: true,
      updated_by: user.id,
    })
    .eq("purchase_id", purchaseId)
    .eq("transaction_type", "PURCHASE")
    .eq("is_deleted", false);

  if (inventoryError) {
    throw inventoryError;
  }

  const {
    error: expenseError,
  } = await supabase
    .from("expenses")
    .update({
      is_deleted: true,
      updated_by: user.id,
    })
    .eq("purchase_id", purchaseId)
    .eq("is_deleted", false);

  if (expenseError) {
    throw expenseError;
  }
}