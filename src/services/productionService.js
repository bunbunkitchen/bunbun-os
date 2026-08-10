import { supabase } from "../lib/supabase";
import { generateBatchNumber } from "../utils/batchGenerator";
import { invokeFrozenFlowRpc } from "./productStockService";

const ORDER_TABLE = "production_orders";
const BATCH_TABLE = "production_batches";

function mapOrder(row) {
  return {
    id: row.id,
    kode: row.kode,
    tanggal: row.tanggal,
    recipeId: row.recipe_id,
    recipeKode: row.recipes?.kode ?? "",
    recipeNama: row.recipes?.nama ?? "",
    targetProduksi: Number(row.target_produksi),
    satuan: row.satuan,
    estimasiBiaya: Number(row.estimasi_biaya),
    status: row.status,
  };
}

function mapBatch(row) {
  return {
    id: row.id,
    kode: row.kode,
    productionOrderId:
      row.production_order_id,

    productionOrderKode:
      row.production_orders?.kode ?? "",

    tanggal:
      row.production_orders?.tanggal ?? "",

    recipeId:
      row.production_orders?.recipe_id ?? null,

    recipeKode:
      row.production_orders?.recipes?.kode ?? "",

    recipe:
      row.production_orders?.recipes?.nama ?? "",

    recipeYield: Number(
      row.production_orders?.recipes
        ?.yield_qty || 0
    ),

    productId:
      row.production_orders?.recipes
        ?.product_id ?? null,

    target: Number(row.target),
    selesai: Number(row.selesai),
    reject: Number(row.reject),
    status: row.status,
    inventoryConsumed:
        Boolean(row.inventory_consumed),
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

export async function getAllProductionOrders() {
  const { data, error } = await supabase
    .from(ORDER_TABLE)
    .select(`
      *,
      recipes (
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

  return (data ?? []).map(mapOrder);
}

export async function createProductionOrder(order) {
  const user = await getCurrentUser();

  const payload = {
    kode: order.kode,
    tanggal: order.tanggal,
    recipe_id: order.recipeId,
    target_produksi: Number(
      order.targetProduksi
    ),
    satuan: order.satuan,
    estimasi_biaya: Number(
      order.estimasiBiaya
    ),
    status: "Draft",
    created_by: user.id,
    updated_by: user.id,
  };

  const { data, error } = await supabase
    .from(ORDER_TABLE)
    .insert(payload)
    .select(`
      *,
      recipes (
        kode,
        nama
      )
    `)
    .single();

  if (error) {
    throw error;
  }

  return mapOrder(data);
}

export async function generateBatchFromOrder(order) {
  const user = await getCurrentUser();

  if (order.status === "Generated") {
    throw new Error(
      "Batch untuk Production Order ini sudah dibuat."
    );
  }

  if (order.status === "Cancelled") {
    throw new Error(
      "Production Order yang dibatalkan tidak dapat dibuatkan batch."
    );
  }

  // Pastikan order ini belum memiliki batch aktif.
  const {
    count: existingBatchCount,
    error: existingBatchError,
  } = await supabase
    .from(BATCH_TABLE)
    .select("id", {
      count: "exact",
      head: true,
    })
    .eq("production_order_id", order.id)
    .eq("is_deleted", false);

  if (existingBatchError) {
    throw existingBatchError;
  }

  if (Number(existingBatchCount || 0) > 0) {
    throw new Error(
      "Batch untuk Production Order ini sudah pernah dibuat."
    );
  }

  const recipeCode = (
    order.recipeKode || "SB"
  ).replaceAll("-", "");

  const productionDate = String(
    order.tanggal || ""
  ).replaceAll("-", "");

  const batchPrefix =
    `PB-${recipeCode}-${productionDate}-`;

  /*
   * Cari semua kode batch dengan resep dan tanggal
   * yang sama.
   *
   * Tidak memakai filter is_deleted karena kode batch
   * yang sudah di-soft delete tetap ada di database
   * dan tetap terkena unique constraint.
   */
  const {
    data: existingCodes,
    error: codeError,
  } = await supabase
    .from(BATCH_TABLE)
    .select("kode")
    .like("kode", `${batchPrefix}%`);

  if (codeError) {
    throw codeError;
  }

  const highestSequence = (
    existingCodes ?? []
  ).reduce((highest, item) => {
    const code = String(item.kode || "");

    const sequenceText =
      code.slice(batchPrefix.length);

    const sequenceNumber =
      Number.parseInt(sequenceText, 10);

    if (
      Number.isNaN(sequenceNumber)
    ) {
      return highest;
    }

    return Math.max(
      highest,
      sequenceNumber
    );
  }, 0);

  const sequence =
    highestSequence + 1;

  const batchCode =
    generateBatchNumber(
      recipeCode,
      order.tanggal,
      sequence
    );

  const {
    data: batchData,
    error: batchError,
  } = await supabase
    .from(BATCH_TABLE)
    .insert({
      kode: batchCode,
      production_order_id: order.id,
      target: Number(
        order.targetProduksi
      ),
      selesai: 0,
      reject: 0,
      status: "Waiting",
      created_by: user.id,
      updated_by: user.id,
    })
    .select(`
      *,
      production_orders (
        kode,
        tanggal,
        recipe_id,
        recipes (
          kode,
          nama,
          yield_qty,
          product_id
        )
      )
    `)
    .single();

  if (batchError) {
    throw batchError;
  }

  const { error: orderError } =
    await supabase
      .from(ORDER_TABLE)
      .update({
        status: "Generated",
        updated_by: user.id,
      })
      .eq("id", order.id);

  if (orderError) {
    throw orderError;
  }

  return mapBatch(batchData);
}

export async function getAllProductionBatches() {
  const { data, error } = await supabase
    .from(BATCH_TABLE)
    .select(`
      *,
      production_orders (
        kode,
        tanggal,
        recipe_id,
        recipes (
            kode,
            nama,
            yield_qty,
            product_id
        )
      )
    `)
    .eq("is_deleted", false)
    .order("created_at", {
      ascending: false,
    });

  if (error) {
    throw error;
  }

  return (data ?? []).map(mapBatch);
}

export async function updateProductionBatch(
  batchId,
  values
) {
  const user = await getCurrentUser();

  const payload = {
    selesai: Number(values.selesai),
    reject: Number(values.reject),
    status: values.status,
    updated_by: user.id,
  };

  if (
    typeof values.inventoryConsumed ===
    "boolean"
  ) {
    payload.inventory_consumed =
      values.inventoryConsumed;
  }

  const { data, error } = await supabase
    .from(BATCH_TABLE)
    .update(payload)
    .eq("id", batchId)
    .select(`
      *,
      production_orders (
        kode,
        tanggal,
        recipe_id,
        recipes (
          kode,
          nama,
          yield_qty,
          product_id
        )
      )
    `)
    .single();

  if (error) {
    throw error;
  }

  return mapBatch(data);
}

export async function recordShapingSplit({
  productionBatchId,
  productId,
  frozenQty = 0,
  directQty = 0,
  rejectQty = 0,
  frozenLotCode,
  movementDate,
  operationKey,
}) {
  return invokeFrozenFlowRpc(
    "record_shaping_split",
    {
      p_production_batch_id: Number(
        productionBatchId
      ),
      p_product_id: Number(productId),
      p_frozen_qty: Number(frozenQty),
      p_direct_qty: Number(directQty),
      p_reject_qty: Number(rejectQty),
      p_frozen_lot_code:
        Number(frozenQty) > 0
          ? (frozenLotCode || "__AUTO__")
          : null,
      p_movement_date: movementDate,
    },
    operationKey
  );
}

export async function releaseFrozenStockForProofing({
  frozenSplitId,
  qty,
  movementDate,
  operationKey,
}) {
  return invokeFrozenFlowRpc(
    "release_frozen_stock",
    {
      p_frozen_split_id: Number(frozenSplitId),
      p_qty: Number(qty),
      p_movement_date: movementDate,
    },
    operationKey
  );
}

export async function recordBakingResult({
  directSplitId,
  bakedGoodQty,
  bakedRejectQty,
  movementDate,
  operationKey,
}) {
  return invokeFrozenFlowRpc(
    "record_baking_result",
    {
      p_direct_split_id: Number(directSplitId),
      p_baked_good_qty: Number(
        bakedGoodQty
      ),
      p_baked_reject_qty: Number(
        bakedRejectQty
      ),
      p_movement_date: movementDate,
    },
    operationKey
  );
}
