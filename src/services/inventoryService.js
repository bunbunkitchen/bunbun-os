import { supabase } from "../lib/supabase";

import {
  fromBaseUnit,
  getBaseUnit,
  toBaseUnit,
  roundQuantity,
} from "../utils/unitConverter";

const TABLE_NAME =
  "inventory_transactions";

const INCOMING_TYPES = [
  "PURCHASE",
  "PRODUCTION_IN",
  "ADJUSTMENT_IN",
  "ADJUSTMENT",
];

const OUTGOING_TYPES = [
  "PRODUCTION_OUT",
  "SALE",
  "ADJUSTMENT_OUT",
];

function mapTransaction(row) {
  return {
    id: row.id,
    tanggal: row.transaction_date,
    tipe: row.transaction_type,

    ingredientId: row.ingredient_id,
    ingredientKode:
      row.ingredients?.kode ?? "",
    ingredientNama:
      row.ingredients?.nama ?? "",

    recipeId: row.recipe_id,
    recipeKode:
      row.recipes?.kode ?? "",
    recipeNama:
      row.recipes?.nama ?? "",

    productionBatchId:
      row.production_batch_id,
    productionBatchKode:
      row.production_batches?.kode ?? "",

    purchaseId: row.purchase_id,

    sumberStok: row.stock_source ?? "",
    nilaiSatuan: Number(row.unit_value || 0),

    jumlah: Number(row.qty || 0),
    satuan: row.unit,
    keterangan: row.notes ?? "",
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
    throw new Error(
      "Pengguna belum login."
    );
  }

  return user;
}

export async function getAllInventoryTransactions() {
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select(`
      *,
      ingredients (
        kode,
        nama
      ),
      recipes (
        kode,
        nama
      ),
      production_batches (
        kode
      )
    `)
    .eq("is_deleted", false)
    .order("transaction_date", {
      ascending: false,
    })
    .order("created_at", {
      ascending: false,
    });

  if (error) {
    throw error;
  }

  return (data ?? []).map(
    mapTransaction
  );
}

export async function createInventoryTransaction(
  transaction
) {
  const user = await getCurrentUser();

  const payload = {
    transaction_date:
      transaction.tanggal,

    transaction_type:
      transaction.tipe,

    ingredient_id:
      transaction.ingredientId || null,

    recipe_id:
      transaction.recipeId || null,

    production_batch_id:
      transaction.productionBatchId ||
      null,

    purchase_id:
      transaction.purchaseId || null,

    qty: Number(
      transaction.jumlah || 0
    ),

    unit: transaction.satuan,

    notes:
      transaction.keterangan || null,

    created_by: user.id,
    updated_by: user.id,
  };

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .insert(payload)
    .select(`
      *,
      ingredients (
        kode,
        nama
      ),
      recipes (
        kode,
        nama
      ),
      production_batches (
        kode
      )
    `)
    .single();

  if (error) {
    throw error;
  }

  return mapTransaction(data);
}

export async function createProductionInventoryMovements({
  tanggal,
  productionBatchId,
  recipeId,
  finishedQty,
  ingredients = [],
}) {
  const user = await getCurrentUser();

  const rows = ingredients.map(
    (item) => ({
      transaction_date: tanggal,

      transaction_type:
        "PRODUCTION_OUT",

      ingredient_id:
        item.ingredientId,

      recipe_id: recipeId,

      production_batch_id:
        productionBatchId,

      purchase_id: null,

      qty: Number(
        item.kebutuhan || 0
      ),

      unit: item.satuan,

      notes:
        "Pemakaian bahan untuk produksi",

      created_by: user.id,
      updated_by: user.id,
    })
  );

  rows.push({
    transaction_date: tanggal,

    transaction_type:
      "PRODUCTION_IN",

    ingredient_id: null,

    recipe_id: recipeId,

    production_batch_id:
      productionBatchId,

    purchase_id: null,

    qty: Number(finishedQty || 0),

    unit: "pcs",

    notes:
      "Hasil produksi selesai",

    created_by: user.id,
    updated_by: user.id,
  });

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .insert(rows)
    .select(`
      *,
      ingredients (
        kode,
        nama
      ),
      recipes (
        kode,
        nama
      ),
      production_batches (
        kode
      )
    `);

  if (error) {
    throw error;
  }

  return (data ?? []).map(
    mapTransaction
  );
}

export async function hasProductionMovements(
  productionBatchId
) {
  const { count, error } = await supabase
    .from(TABLE_NAME)
    .select("id", {
      count: "exact",
      head: true,
    })
    .eq(
      "production_batch_id",
      productionBatchId
    )
    .in("transaction_type", [
      "PRODUCTION_OUT",
      "PRODUCTION_IN",
    ])
    .eq("is_deleted", false);

  if (error) {
    throw error;
  }

  return Number(count || 0) > 0;
}

/**
 * Menghitung stok bahan dalam satuan dasar:
 *
 * kg dan gram  -> gram
 * liter dan ml -> ml
 * pcs          -> pcs
 */
export async function getIngredientCurrentStock(
  ingredientId
) {
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select(`
      transaction_type,
      qty,
      unit
    `)
    .eq(
      "ingredient_id",
      ingredientId
    )
    .eq("is_deleted", false);

  if (error) {
    throw error;
  }

  return (data ?? []).reduce(
    (stock, item) => {
      const quantityBase =
        toBaseUnit(
          item.qty,
          item.unit
        );

      if (
        INCOMING_TYPES.includes(
          item.transaction_type
        )
      ) {
        return stock + quantityBase;
      }

      if (
        OUTGOING_TYPES.includes(
          item.transaction_type
        )
      ) {
        return stock - quantityBase;
      }

      return stock;
    },
    0
  );
}

export async function createProductionOutMovements({
  tanggal,
  productionBatchId,
  recipeId,
  ingredients = [],
}) {
  const user = await getCurrentUser();

  if (!ingredients.length) {
    throw new Error(
      "Komposisi bahan produksi belum tersedia."
    );
  }

  const {
    count,
    error: existingError,
  } = await supabase
    .from(TABLE_NAME)
    .select("id", {
      count: "exact",
      head: true,
    })
    .eq(
      "production_batch_id",
      productionBatchId
    )
    .eq(
      "transaction_type",
      "PRODUCTION_OUT"
    )
    .eq("is_deleted", false);

  if (existingError) {
    throw existingError;
  }

  if (Number(count || 0) > 0) {
    throw new Error(
      "Pemakaian bahan untuk batch ini sudah pernah dicatat."
    );
  }

  /*
   * Validasi stok.
   *
   * Stok dan kebutuhan harus dibandingkan
   * dalam satuan dasar yang sama.
   */
  for (const item of ingredients) {
    const stockBase =
      await getIngredientCurrentStock(
        item.ingredientId
      );

    const kebutuhanBase =
      toBaseUnit(
        item.kebutuhan,
        item.satuan
      );

    if (stockBase < kebutuhanBase) {
      const displayUnit =
        item.satuan ||
        getBaseUnit(item.satuan);

      const stockDisplay =
  roundQuantity(
    fromBaseUnit(
      stockBase,
      displayUnit
    )
  );

const kebutuhanDisplay =
  roundQuantity(
    fromBaseUnit(
      kebutuhanBase,
      displayUnit
    )
  );

      throw new Error(
        `Stok ${
          item.ingredientNama
        } tidak cukup. Tersedia ${stockDisplay.toLocaleString(
          "id-ID"
        )} ${displayUnit}, kebutuhan ${kebutuhanDisplay.toLocaleString(
          "id-ID"
        )} ${displayUnit}.`
      );
    }
  }

  const rows = ingredients.map(
    (item) => ({
      transaction_date: tanggal,

      transaction_type:
        "PRODUCTION_OUT",

      ingredient_id:
        item.ingredientId,

      recipe_id: recipeId,

      production_batch_id:
        productionBatchId,

      purchase_id: null,

      qty: Number(
        item.kebutuhan || 0
      ),

      unit: item.satuan,

      notes:
        "Pemakaian bahan saat produksi dimulai",

      created_by: user.id,
      updated_by: user.id,
    })
  );

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .insert(rows)
    .select(`
      *,
      ingredients (
        kode,
        nama
      ),
      recipes (
        kode,
        nama
      ),
      production_batches (
        kode
      )
    `);

  if (error) {
    throw error;
  }

  return (data ?? []).map(
    mapTransaction
  );
}

export async function createProductionInMovement({
  tanggal,
  productionBatchId,
  recipeId,
  finishedQty,
}) {
  const user = await getCurrentUser();

  const {
    count,
    error: countError,
  } = await supabase
    .from(TABLE_NAME)
    .select("id", {
      count: "exact",
      head: true,
    })
    .eq(
      "production_batch_id",
      productionBatchId
    )
    .eq(
      "transaction_type",
      "PRODUCTION_IN"
    )
    .eq("is_deleted", false);

  if (countError) {
    throw countError;
  }

  if (Number(count || 0) > 0) {
    return null;
  }

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .insert({
      transaction_date: tanggal,

      transaction_type:
        "PRODUCTION_IN",

      ingredient_id: null,

      recipe_id: recipeId,

      production_batch_id:
        productionBatchId,

      purchase_id: null,

      qty: Number(finishedQty || 0),

      unit: "pcs",

      notes:
        "Hasil produksi selesai",

      created_by: user.id,
      updated_by: user.id,
    })
    .select(`
      *,
      ingredients (
        kode,
        nama
      ),
      recipes (
        kode,
        nama
      ),
      production_batches (
        kode
      )
    `)
    .single();

  if (error) {
    throw error;
  }

  return mapTransaction(data);
}

export async function createNonPurchaseStockAddition(addition) {
  const { data, error } = await supabase.rpc(
    "record_non_purchase_stock",
    {
      p_transaction_date: addition.tanggal,
      p_ingredient_id: addition.ingredientId,
      p_qty: addition.jumlah,
      p_unit: addition.satuan,
      p_unit_value: addition.nilaiSatuan,
      p_stock_source: addition.sumber,
      p_notes: addition.keterangan || null,
      p_operation_key: addition.operationKey,
    }
  );

  if (error) {
    if (error.message?.includes("record_non_purchase_stock")) {
      throw new Error("Fitur penambahan stok belum dipasang ke database.");
    }
    throw error;
  }

  return data;
}
