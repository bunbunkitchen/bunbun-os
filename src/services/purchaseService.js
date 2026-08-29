import { supabase } from "../lib/supabase";

import {
  createInventoryTransaction,
} from "./inventoryService";

import {
  createExpense,
} from "./expenseService";

const TABLE_NAME = "purchases";

/*
 * ============================
 * UNIT HELPERS
 * ============================
 */

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
 * ============================
 * CALCULATE INVENTORY QUANTITY
 * ============================
 *
 * Contoh:
 *
 * 4 sediaan
 * × 250 gram / sediaan
 * = 1000 gram
 *
 * Jika satuan inventory = kg:
 *
 * 1000 gram
 * = 1 kg
 *
 * Fungsi ini digunakan untuk:
 * - Bahan Baku
 * - Maintenance
 *
 * Maintenance tidak membuat
 * inventory transaction, tetapi
 * quantity aktual tetap disimpan
 * pada record purchasing.
 */

function calculateInventoryQuantity({
  jumlahSediaan,
  isiPerSediaan,
  satuanSediaan,
  satuanInventory,
}) {
  const totalIsi =
    Number(jumlahSediaan || 0) *
    Number(isiPerSediaan || 0);

  if (
    totalIsi <= 0 ||
    !satuanSediaan ||
    !satuanInventory
  ) {
    return 0;
  }

  const baseQuantity =
    toBaseQuantity(
      totalIsi,
      satuanSediaan
    );

  return fromBaseQuantity(
    baseQuantity,
    satuanInventory
  );
}

/*
 * ============================
 * MAP PURCHASE
 * ============================
 */

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

    /*
     * BAHAN BAKU
     */

    ingredientId:
      row.ingredient_id,

    ingredientKode:
      row.ingredients?.kode ?? "",

    ingredientNama:
      row.ingredients?.nama ?? "",

    /*
     * MAINTENANCE
     */

    maintenanceItemId:
      row.maintenance_item_id,

    maintenanceItemKode:
      row.maintenance_items
        ?.kode ?? "",

    maintenanceItemNama:
      row.maintenance_items
        ?.nama ?? "",

    /*
     * GENERIC ITEM
     */

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
     * ============================
     * QUANTITY
     * ============================
     *
     * jumlah = quantity aktual
     * dalam satuan inventory/master.
     *
     * Untuk bahan baku:
     * hasil konversi sediaan.
     *
     * Untuk maintenance:
     * hasil konversi sediaan juga.
     */

    jumlah:
      Number(
        row.jumlah || 0
      ),

    satuan:
      row.satuan,

    /*
     * ============================
     * SEDIAAN
     * ============================
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
     * ============================
     * HARGA
     * ============================
     *
     * hargaSatuan = harga per sediaan.
     */

    hargaSatuan:
      Number(
        row.harga_satuan || 0
      ),

    total:
      Number(
        row.total || 0
      ),

    keterangan:
      row.keterangan ?? "",
  };
}

/*
 * ============================
 * CURRENT USER
 * ============================
 */

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

/*
 * ============================
 * GET ALL PURCHASES
 * ============================
 */

export async function getAllPurchases() {
  const {
    data,
    error,
  } =
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

/*
 * ============================
 * CREATE PURCHASE
 * ============================
 */

export async function createPurchase(
  purchase
) {
  const user =
    await getCurrentUser();

  const isMaintenance =
    purchase.purchaseType ===
    "MAINTENANCE";

  const jumlahSediaan =
    Number(
      purchase.jumlahSediaan || 0
    );

  const isiPerSediaan =
    Number(
      purchase.isiPerSediaan || 0
    );

  const hargaSatuan =
    Number(
      purchase.hargaSatuan || 0
    );

  /*
   * ============================
   * VALIDASI UMUM
   * ============================
   */

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
      "Satuan isi wajib diisi."
    );
  }

  if (
    !purchase.satuan
  ) {
    throw new Error(
      "Satuan inventory wajib diisi."
    );
  }

  if (
    hargaSatuan < 0
  ) {
    throw new Error(
      "Harga per sediaan tidak valid."
    );
  }

  /*
   * ============================
   * JUMLAH AKTUAL
   * ============================
   *
   * Contoh:
   *
   * Maintenance:
   *
   * 4 box
   * isi 10 pcs
   *
   * = 40 pcs
   */

  const jumlah =
    calculateInventoryQuantity({
      jumlahSediaan,
      isiPerSediaan,
      satuanSediaan:
        purchase.satuanSediaan,
      satuanInventory:
        purchase.satuan,
    });

  if (
    jumlah <= 0
  ) {
    throw new Error(
      "Jumlah quantity yang dihitung tidak valid."
    );
  }

  /*
   * ============================
   * TOTAL PEMBELIAN
   * ============================
   *
   * Harga per sediaan
   * ×
   * jumlah sediaan
   */

  const total =
    jumlahSediaan *
    hargaSatuan;

  /*
   * ============================
   * PAYLOAD
   * ============================
   */

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
     * Quantity aktual.
     */

    jumlah,

    satuan:
      purchase.satuan,

    /*
     * Harga per sediaan.
     */

    harga_satuan:
      hargaSatuan,

    /*
     * Total pembayaran.
     */

    total,

    /*
     * Detail sediaan.
     *
     * SEKARANG BERLAKU UNTUK
     * BAHAN BAKU DAN MAINTENANCE.
     */

    jumlah_sediaan:
      jumlahSediaan,

    isi_per_sediaan:
      isiPerSediaan,

    satuan_sediaan:
      purchase.satuanSediaan,

    keterangan:
      purchase.keterangan ||
      null,

    created_by:
      user.id,

    updated_by:
      user.id,
  };

  /*
   * ============================
   * INSERT PURCHASE
   * ============================
   */

  const {
    data,
    error,
  } =
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
   * ============================
   * INVENTORY
   * ============================
   *
   * HANYA bahan baku yang
   * masuk inventory bahan baku.
   *
   * Maintenance TIDAK masuk
   * inventory bahan baku.
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

      recipeId:
        null,

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
   * ============================
   * EXPENSE
   * ============================
   *
   * Bahan Baku:
   * kategori Bahan Baku
   *
   * Maintenance:
   * kategori Maintenance
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

/*
 * ============================
 * UPDATE PURCHASE
 * ============================
 */

export async function updatePurchase(
  purchaseId,
  purchase
) {
  const user =
    await getCurrentUser();

  const isMaintenance =
    purchase.purchaseType ===
    "MAINTENANCE";

  /*
   * ============================
   * INPUT
   * ============================
   */

  const jumlahSediaan =
    Number(
      purchase.jumlahSediaan || 0
    );

  const isiPerSediaan =
    Number(
      purchase.isiPerSediaan || 0
    );

  const hargaSatuan =
    Number(
      purchase.hargaSatuan || 0
    );

  /*
   * ============================
   * VALIDASI
   * ============================
   */

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
      "Satuan isi wajib diisi."
    );
  }

  if (
    !purchase.satuan
  ) {
    throw new Error(
      "Satuan inventory wajib diisi."
    );
  }

  if (
    hargaSatuan < 0
  ) {
    throw new Error(
      "Harga per sediaan tidak valid."
    );
  }

  /*
   * ============================
   * HITUNG QUANTITY
   * ============================
   */

  const jumlah =
    calculateInventoryQuantity({
      jumlahSediaan,
      isiPerSediaan,
      satuanSediaan:
        purchase.satuanSediaan,
      satuanInventory:
        purchase.satuan,
    });

  if (
    jumlah <= 0
  ) {
    throw new Error(
      "Jumlah quantity yang dihitung tidak valid."
    );
  }

  /*
   * ============================
   * HITUNG TOTAL
   * ============================
   */

  const total =
    jumlahSediaan *
    hargaSatuan;

  /*
   * ============================
   * PURCHASE PAYLOAD
   * ============================
   */

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

    /*
     * Quantity aktual.
     */

    jumlah,

    satuan:
      purchase.satuan,

    /*
     * Harga per sediaan.
     */

    harga_satuan:
      hargaSatuan,

    /*
     * Total pembayaran.
     */

    total,

    /*
     * Detail sediaan.
     *
     * Berlaku untuk kedua tipe.
     */

    jumlah_sediaan:
      jumlahSediaan,

    isi_per_sediaan:
      isiPerSediaan,

    satuan_sediaan:
      purchase.satuanSediaan,

    keterangan:
      purchase.keterangan ||
      null,

    updated_by:
      user.id,
  };

  /*
   * ============================
   * UPDATE PURCHASE
   * ============================
   */

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
   * ============================
   * CARI INVENTORY TRANSACTION
   * ============================
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

  if (
    inventoryLookupError
  ) {
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

      if (
        inventoryError
      ) {
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

        recipeId:
          null,

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
   *
   * Maintenance TIDAK boleh
   * mempunyai inventory transaction.
   *
   * Kalau data lama ternyata
   * pernah mempunyai transaction,
   * kita bersihkan.
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
   * ============================
   * UPDATE EXPENSE
   * ============================
   */

  const {
    error:
      expenseError,
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

  if (
    expenseError
  ) {
    throw expenseError;
  }

  return updatedPurchase;
}

/*
 * ============================
 * SOFT DELETE PURCHASE
 * ============================
 */

export async function softDeletePurchase(
  purchaseId
) {
  const user =
    await getCurrentUser();

  /*
   * ============================
   * SOFT DELETE PURCHASE
   * ============================
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

  if (
    purchaseError
  ) {
    throw purchaseError;
  }

  /*
   * ============================
   * SOFT DELETE INVENTORY
   * ============================
   *
   * Hanya bahan baku yang
   * seharusnya punya transaksi
   * inventory.
   *
   * Maintenance kalau ternyata
   * punya transaksi lama juga
   * akan dibersihkan.
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

  if (
    inventoryError
  ) {
    throw inventoryError;
  }

  /*
   * ============================
   * SOFT DELETE EXPENSE
   * ============================
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

  if (
    expenseError
  ) {
    throw expenseError;
  }
}