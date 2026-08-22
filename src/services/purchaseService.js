import { supabase } from "../lib/supabase";

import {
  createInventoryTransaction,
} from "./inventoryService";

import {
  createExpense,
} from "./expenseService";

const TABLE_NAME = "purchases";

function normalizeUnit(unit) {
  return String(unit || "")
    .trim()
    .toLowerCase();
}

function toBaseQuantity(
  quantity,
  unit
) {
  const value = Number(quantity || 0);
  const normalized =
    normalizeUnit(unit);

  if (normalized === "kg") {
    return value * 1000;
  }

  if (
    normalized === "liter" ||
    normalized === "l"
  ) {
    return value * 1000;
  }

  return value;
}

function fromBaseQuantity(
  quantity,
  unit
) {
  const value = Number(quantity || 0);
  const normalized =
    normalizeUnit(unit);

  if (normalized === "kg") {
    return value / 1000;
  }

  if (
    normalized === "liter" ||
    normalized === "l"
  ) {
    return value / 1000;
  }

  return value;
}

/*
 * Mengubah jumlah sediaan menjadi
 * jumlah inventory dalam satuan master.
 *
 * Contoh:
 *
 * 4 × 250 gram
 * master = kg
 *
 * 4 × 250 = 1000 gram
 * 1000 gram = 1 kg
 */
function calculateInventoryQuantity({
  jumlahSediaan,
  isiPerSediaan,
  satuanSediaan,
  satuanInventory,
}) {
  const totalSediaan =
    Number(jumlahSediaan || 0) *
    Number(isiPerSediaan || 0);

  const baseQuantity =
    toBaseQuantity(
      totalSediaan,
      satuanSediaan
    );

  return fromBaseQuantity(
    baseQuantity,
    satuanInventory
  );
}

function mapPurchase(row) {
  const isMaintenance =
    Boolean(
      row.maintenance_item_id
    );

  return {
    id: row.id,

    tanggal:
      row.tanggal,

    supplierId:
      row.supplier_id,

    supplierNama:
      row.suppliers?.nama ?? "",

    purchaseType:
      isMaintenance
        ? "MAINTENANCE"
        : "INGREDIENT",

    ingredientId:
      row.ingredient_id,

    ingredientKode:
      row.ingredients?.kode ?? "",

    ingredientNama:
      row.ingredients?.nama ?? "",

    maintenanceItemId:
      row.maintenance_item_id,

    maintenanceItemKode:
      row.maintenance_items?.kode ??
      "",

    maintenanceItemNama:
      row.maintenance_items?.nama ??
      "",

    itemKode:
      isMaintenance
        ? row.maintenance_items
            ?.kode ?? ""
        : row.ingredients
            ?.kode ?? "",

    itemNama:
      isMaintenance
        ? row.maintenance_items
            ?.nama ?? ""
        : row.ingredients
            ?.nama ?? "",

    /*
     * jumlah = quantity inventory
     * dalam satuan master bahan.
     *
     * Untuk maintenance:
     * jumlah = jumlah pembelian maintenance.
     */
    jumlah:
      Number(row.jumlah || 0),

    satuan:
      row.satuan,

    /*
     * Informasi kemasan aktual.
     */
    jumlahSediaan:
      row.jumlah_sediaan == null
        ? null
        : Number(
            row.jumlah_sediaan
          ),

    isiPerSediaan:
      row.isi_per_sediaan == null
        ? null
        : Number(
            row.isi_per_sediaan
          ),

    satuanSediaan:
      row.satuan_sediaan ?? "",

    /*
     * Harga aktual pembelian.
     * TIDAK berhubungan dengan
     * harga Master Bahan Baku.
     */
    hargaSatuan:
      Number(
        row.harga_satuan || 0
      ),

    total:
      Number(row.total || 0),

    keterangan:
      row.keterangan ?? "",
  };
}

async function getCurrentUser() {
  const {
    data: { user },
    error,
  } =
    await supabase.auth.getUser();

  if (error) {
    throw error;
  }

  if (!user) {
    throw new Error(
      "Pengguna belum login."
    );
  }

  return user;
}

export async function getAllPurchases() {
  const { data, error } =
    await supabase
      .from(TABLE_NAME)
      .select(`
        *,
        suppliers (
          nama
        ),
        ingredients (
          kode,
          nama
        ),
        maintenance_items (
          kode,
          nama
        )
      `)
      .eq(
        "is_deleted",
        false
      )
      .order("tanggal", {
        ascending: false,
      })
      .order("created_at", {
        ascending: false,
      });

  if (error) {
    throw error;
  }

  return (
    data ?? []
  ).map(mapPurchase);
}

export async function createPurchase(
  purchase
) {
  const user =
    await getCurrentUser();

  const isMaintenance =
    purchase.purchaseType ===
    "MAINTENANCE";

  let jumlah;
  let total;

  /*
   * ============================
   * BAHAN BAKU
   * ============================
   */
  if (!isMaintenance) {
    const jumlahSediaan =
      Number(
        purchase.jumlahSediaan
      );

    const isiPerSediaan =
      Number(
        purchase.isiPerSediaan
      );

    const hargaSatuan =
      Number(
        purchase.hargaSatuan
      );

    if (
      jumlahSediaan <= 0
    ) {
      throw new Error(
        "Jumlah sediaan harus lebih dari 0."
      );
    }

    if (
      isiPerSediaan <= 0
    ) {
      throw new Error(
        "Isi per sediaan harus lebih dari 0."
      );
    }

    if (
      !purchase.satuanSediaan
    ) {
      throw new Error(
        "Satuan sediaan wajib diisi."
      );
    }

    jumlah =
      calculateInventoryQuantity({
        jumlahSediaan,
        isiPerSediaan,
        satuanSediaan:
          purchase.satuanSediaan,
        satuanInventory:
          purchase.satuan,
      });

    total =
      jumlahSediaan *
      hargaSatuan;
  }

  /*
   * ============================
   * MAINTENANCE
   * ============================
   */
  else {
    /*
     * PENTING:
     *
     * Jangan gunakan:
     *
     * const jumlah = ...
     *
     * karena akan membuat variable
     * baru di dalam block else.
     *
     * Kita harus mengisi variable
     * `jumlah` yang sudah dideklarasikan
     * di atas agar bisa digunakan
     * oleh payload Supabase.
     */
    jumlah =
      Number(
        purchase.jumlah
      );

    const hargaSatuan =
      Number(
        purchase.hargaSatuan
      );

    if (jumlah <= 0) {
      throw new Error(
        "Jumlah pembelian harus lebih dari 0."
      );
    }

    total =
      jumlah *
      hargaSatuan;
  }

  const payload = {
    tanggal:
      purchase.tanggal,

    supplier_id:
      purchase.supplierId ||
      null,

    ingredient_id:
      isMaintenance
        ? null
        : purchase.ingredientId,

    maintenance_item_id:
      isMaintenance
        ? purchase.maintenanceItemId
        : null,

    /*
     * Untuk:
     *
     * INGREDIENT:
     * jumlah inventory hasil
     * konversi kemasan.
     *
     * MAINTENANCE:
     * jumlah langsung dari form.
     */
    jumlah,

    satuan:
      purchase.satuan,

    harga_satuan:
      Number(
        purchase.hargaSatuan
      ),

    total,

    jumlah_sediaan:
      isMaintenance
        ? null
        : Number(
            purchase.jumlahSediaan
          ),

    isi_per_sediaan:
      isMaintenance
        ? null
        : Number(
            purchase.isiPerSediaan
          ),

    satuan_sediaan:
      isMaintenance
        ? null
        : purchase.satuanSediaan,

    keterangan:
      purchase.keterangan ||
      null,

    created_by:
      user.id,

    updated_by:
      user.id,
  };

  const { data, error } =
    await supabase
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
        ),
        maintenance_items (
          kode,
          nama
        )
      `)
      .single();

  if (error) {
    throw error;
  }

  const savedPurchase =
    mapPurchase(data);

  /*
   * Hanya bahan baku yang
   * masuk inventory.
   */
  if (
    savedPurchase.purchaseType ===
    "INGREDIENT"
  ) {
    await createInventoryTransaction({
      tanggal:
        savedPurchase.tanggal,

      tipe:
        "PURCHASE",

      ingredientId:
        savedPurchase.ingredientId,

      recipeId: null,

      productionBatchId:
        null,

      purchaseId:
        savedPurchase.id,

      jumlah:
        savedPurchase.jumlah,

      satuan:
        savedPurchase.satuan,

      keterangan:
        `Pembelian bahan baku${
          savedPurchase.supplierNama
            ? ` dari ${savedPurchase.supplierNama}`
            : ""
        }`,
    });
  }

  /*
   * Purchasing tetap menjadi
   * expense berdasarkan harga
   * aktual pembelian.
   */
  await createExpense({
    tanggal:
      savedPurchase.tanggal,

    kategori:
      savedPurchase.purchaseType ===
      "MAINTENANCE"
        ? "Maintenance"
        : "Bahan Baku",

    nominal:
      savedPurchase.total,

    purchaseId:
      savedPurchase.id,

    keterangan:
      `Pembelian ${savedPurchase.itemNama}${
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
  const user =
    await getCurrentUser();

  const isMaintenance =
    purchase.purchaseType ===
    "MAINTENANCE";

  let jumlah;
  let total;

  /*
   * Hitung ulang quantity inventory
   * berdasarkan kemasan baru.
   */
  if (!isMaintenance) {
    jumlah =
      calculateInventoryQuantity({
        jumlahSediaan:
          Number(
            purchase.jumlahSediaan
          ),

        isiPerSediaan:
          Number(
            purchase.isiPerSediaan
          ),

        satuanSediaan:
          purchase.satuanSediaan,

        satuanInventory:
          purchase.satuan,
      });

    total =
      Number(
        purchase.jumlahSediaan
      ) *
      Number(
        purchase.hargaSatuan
      );
  } else {
    jumlah =
      Number(
        purchase.jumlah
      );

    total =
      jumlah *
      Number(
        purchase.hargaSatuan
      );
  }

  const purchasePayload = {
    tanggal:
      purchase.tanggal,

    supplier_id:
      purchase.supplierId ||
      null,

    ingredient_id:
      isMaintenance
        ? null
        : purchase.ingredientId,

    maintenance_item_id:
      isMaintenance
        ? purchase.maintenanceItemId
        : null,

    jumlah,

    satuan:
      purchase.satuan,

    harga_satuan:
      Number(
        purchase.hargaSatuan
      ),

    total,

    jumlah_sediaan:
      isMaintenance
        ? null
        : Number(
            purchase.jumlahSediaan
          ),

    isi_per_sediaan:
      isMaintenance
        ? null
        : Number(
            purchase.isiPerSediaan
          ),

    satuan_sediaan:
      isMaintenance
        ? null
        : purchase.satuanSediaan,

    keterangan:
      purchase.keterangan ||
      null,

    updated_by:
      user.id,
  };

  const {
    data: purchaseData,
    error: purchaseError,
  } =
    await supabase
      .from(TABLE_NAME)
      .update(
        purchasePayload
      )
      .eq(
        "id",
        purchaseId
      )
      .select(`
        *,
        suppliers (
          nama
        ),
        ingredients (
          kode,
          nama
        ),
        maintenance_items (
          kode,
          nama
        )
      `)
      .single();

  if (purchaseError) {
    throw purchaseError;
  }

  const updatedPurchase =
    mapPurchase(
      purchaseData
    );

  /*
   * Cari transaksi inventory
   * terkait purchase ini.
   */
  const {
    data:
      inventoryTransaction,
    error:
      inventoryLookupError,
  } = await supabase
    .from(
      "inventory_transactions"
    )
    .select("id")
    .eq(
      "purchase_id",
      purchaseId
    )
    .eq(
      "transaction_type",
      "PURCHASE"
    )
    .eq(
      "is_deleted",
      false
    )
    .maybeSingle();

  if (inventoryLookupError) {
    throw inventoryLookupError;
  }

  /*
   * ============================
   * INGREDIENT
   * ============================
   */
  if (
    updatedPurchase.purchaseType ===
    "INGREDIENT"
  ) {
    if (
      inventoryTransaction
    ) {
      const {
        error:
          inventoryError,
      } =
        await supabase
          .from(
            "inventory_transactions"
          )
          .update({
            transaction_date:
              updatedPurchase.tanggal,

            ingredient_id:
              updatedPurchase.ingredientId,

            qty:
              updatedPurchase.jumlah,

            unit:
              updatedPurchase.satuan,

            notes:
              `Pembelian bahan baku${
                updatedPurchase.supplierNama
                  ? ` dari ${updatedPurchase.supplierNama}`
                  : ""
              }`,

            updated_by:
              user.id,
          })
          .eq(
            "id",
            inventoryTransaction.id
          );

      if (inventoryError) {
        throw inventoryError;
      }
    } else {
      await createInventoryTransaction({
        tanggal:
          updatedPurchase.tanggal,

        tipe:
          "PURCHASE",

        ingredientId:
          updatedPurchase.ingredientId,

        recipeId: null,

        productionBatchId:
          null,

        purchaseId:
          updatedPurchase.id,

        jumlah:
          updatedPurchase.jumlah,

        satuan:
          updatedPurchase.satuan,

        keterangan:
          `Pembelian bahan baku${
            updatedPurchase.supplierNama
              ? ` dari ${updatedPurchase.supplierNama}`
              : ""
          }`,
      });
    }
  }

  /*
   * ============================
   * MAINTENANCE
   * ============================
   */
  else {
    if (
      inventoryTransaction
    ) {
      const {
        error:
          deleteInventoryError,
      } =
        await supabase
          .from(
            "inventory_transactions"
          )
          .update({
            is_deleted:
              true,

            updated_by:
              user.id,
          })
          .eq(
            "id",
            inventoryTransaction.id
          );

      if (
        deleteInventoryError
      ) {
        throw deleteInventoryError;
      }
    }
  }

  /*
   * Update expense sesuai
   * harga aktual purchasing.
   */
  const {
    error: expenseError,
  } =
    await supabase
      .from("expenses")
      .update({
        tanggal:
          updatedPurchase.tanggal,

        kategori:
          updatedPurchase.purchaseType ===
          "MAINTENANCE"
            ? "Maintenance"
            : "Bahan Baku",

        nominal:
          updatedPurchase.total,

        keterangan:
          `Pembelian ${updatedPurchase.itemNama}${
            updatedPurchase.supplierNama
              ? ` dari ${updatedPurchase.supplierNama}`
              : ""
          }`,

        updated_by:
          user.id,
      })
      .eq(
        "purchase_id",
        purchaseId
      )
      .eq(
        "is_deleted",
        false
      );

  if (expenseError) {
    throw expenseError;
  }

  return updatedPurchase;
}

export async function softDeletePurchase(
  purchaseId
) {
  const user =
    await getCurrentUser();

  /*
   * Soft delete purchase.
   */
  const {
    error:
      purchaseError,
  } =
    await supabase
      .from(TABLE_NAME)
      .update({
        is_deleted:
          true,

        updated_by:
          user.id,
      })
      .eq(
        "id",
        purchaseId
      );

  if (purchaseError) {
    throw purchaseError;
  }

  /*
   * Hapus pengaruh purchase
   * terhadap inventory.
   */
  const {
    error:
      inventoryError,
  } =
    await supabase
      .from(
        "inventory_transactions"
      )
      .update({
        is_deleted:
          true,

        updated_by:
          user.id,
      })
      .eq(
        "purchase_id",
        purchaseId
      )
      .eq(
        "transaction_type",
        "PURCHASE"
      )
      .eq(
        "is_deleted",
        false
      );

  if (inventoryError) {
    throw inventoryError;
  }

  /*
   * Hapus expense terkait.
   */
  const {
    error:
      expenseError,
  } =
    await supabase
      .from("expenses")
      .update({
        is_deleted:
          true,

        updated_by:
          user.id,
      })
      .eq(
        "purchase_id",
        purchaseId
      )
      .eq(
        "is_deleted",
        false
      );

  if (expenseError) {
    throw expenseError;
  }
}