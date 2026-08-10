import { supabase } from "../lib/supabase";

import {
  fromBaseUnit,
  toBaseUnit,
} from "../utils/unitConverter";

const INCOMING_TRANSACTION_TYPES = [
  "PURCHASE",
  "PRODUCTION_IN",
  "ADJUSTMENT_IN",
];

const OUTGOING_TRANSACTION_TYPES = [
  "PRODUCTION_OUT",
  "SALE",
  "ADJUSTMENT_OUT",
];

function getLocalDateString(
  date = new Date()
) {
  const year = date.getFullYear();

  const month = String(
    date.getMonth() + 1
  ).padStart(2, "0");

  const day = String(
    date.getDate()
  ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getCurrentMonthRange() {
  const now = new Date();

  const year = now.getFullYear();
  const monthIndex = now.getMonth();

  const monthStart =
    getLocalDateString(
      new Date(
        year,
        monthIndex,
        1
      )
    );

  const monthEnd =
    getLocalDateString(
      new Date(
        year,
        monthIndex + 1,
        0
      )
    );

  return {
    monthStart,
    monthEnd,
  };
}

function sumBy(rows, field) {
  return (rows ?? []).reduce(
    (total, row) =>
      total +
      Number(row[field] || 0),
    0
  );
}

function validateResults(results) {
  const failedResult = results.find(
    (result) => result.error
  );

  if (failedResult?.error) {
    throw failedResult.error;
  }
}

async function getCurrentRole() {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    throw userError;
  }

  if (!user) {
    throw new Error(
      "Pengguna belum login."
    );
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (error) {
    throw error;
  }

  return String(data.role || "")
    .trim()
    .toLowerCase();
}

export async function getDashboardSummary() {
  const today = getLocalDateString();

  const role = await getCurrentRole();

  const isOwner =
    role === "owner";

  const isBaker =
    role === "baker";

  const canSeePurchase =
    isOwner || isBaker;

  const [
    orderResult,
    batchResult,
    inventoryResult,
  ] = await Promise.all([
    supabase
      .from("production_orders")
      .select("id, status")
      .eq("tanggal", today)
      .eq("is_deleted", false),

    supabase
      .from("production_batches")
      .select(`
        id,
        kode,
        status,
        target,
        selesai,
        reject,
        production_orders (
          tanggal,
          recipes (
            kode,
            nama
          )
        )
      `)
      .eq("is_deleted", false),

    supabase
      .from("inventory_transactions")
      .select("id")
      .eq("transaction_date", today)
      .eq("is_deleted", false),
  ]);

  validateResults([
    orderResult,
    batchResult,
    inventoryResult,
  ]);

  let income = 0;
  let expense = 0;
  let purchaseToday = 0;

  if (isOwner) {
    const [
      incomeResult,
      expenseResult,
    ] = await Promise.all([
      supabase
        .from("incomes")
        .select("pemasukan_bunbun")
        .eq("tanggal", today)
        .eq("is_deleted", false),

      supabase
        .from("expenses")
        .select("nominal")
        .eq("tanggal", today)
        .eq("is_deleted", false),
    ]);

    validateResults([
      incomeResult,
      expenseResult,
    ]);

    income = sumBy(
      incomeResult.data,
      "pemasukan_bunbun"
    );

    expense = sumBy(
      expenseResult.data,
      "nominal"
    );
  }

  if (canSeePurchase) {
    const purchaseResult =
      await supabase
        .from("purchases")
        .select("total")
        .eq("tanggal", today)
        .eq("is_deleted", false);

    if (purchaseResult.error) {
      throw purchaseResult.error;
    }

    purchaseToday = sumBy(
      purchaseResult.data,
      "total"
    );
  }

  const orders =
    orderResult.data ?? [];

  const todayBatches = (
    batchResult.data ?? []
  ).filter(
    (batch) =>
      batch.production_orders?.tanggal ===
      today
  );

  const draftOrders =
    orders.filter(
      (order) =>
        order.status === "Draft"
    ).length;

  const generatedOrders =
    orders.filter(
      (order) =>
        order.status === "Generated"
    ).length;

  const activeBatches =
    todayBatches.filter(
      (batch) =>
        batch.status !== "Finished" &&
        batch.status !== "Cancelled"
    );

  const finishedBatches =
    todayBatches.filter(
      (batch) =>
        batch.status === "Finished"
    );

  const finishedQty =
    finishedBatches.reduce(
      (total, batch) =>
        total +
        Number(batch.selesai || 0),
      0
    );

  const rejectedQty =
    todayBatches.reduce(
      (total, batch) =>
        total +
        Number(batch.reject || 0),
      0
    );

  return {
    income,
    expense,
    profit: income - expense,
    purchaseToday,

    productionOrders:
      orders.length,

    draftOrders,
    generatedOrders,

    activeBatch:
      activeBatches.length,

    finishedBatch:
      finishedBatches.length,

    finishedQty,
    rejectedQty,

    inventoryTransactions:
      inventoryResult.data?.length ?? 0,

    activeBatchItems:
      activeBatches.map((batch) => ({
        id: batch.id,
        kode: batch.kode,

        recipeKode:
          batch.production_orders
            ?.recipes?.kode ?? "",

        recipeNama:
          batch.production_orders
            ?.recipes?.nama ?? "",

        target: Number(
          batch.target || 0
        ),

        selesai: Number(
          batch.selesai || 0
        ),

        reject: Number(
          batch.reject || 0
        ),

        status: batch.status,
      })),
  };
}

export async function getBusinessIntelligence() {
  const today =
    getLocalDateString();

  const role =
    await getCurrentRole();

  const isOwner =
    role === "owner";

  const {
    monthStart,
    monthEnd,
  } = getCurrentMonthRange();

  const [
    batchResult,
    ingredientResult,
    inventoryResult,
  ] = await Promise.all([
    supabase
      .from("production_batches")
      .select(`
        id,
        kode,
        status,
        target,
        selesai,
        reject,
        production_orders (
          tanggal,
          recipes (
            kode,
            nama
          )
        )
      `)
      .eq("is_deleted", false),

    supabase
      .from("ingredients")
      .select(`
        id,
        kode,
        nama,
        satuan,
        minimum_stok
      `)
      .eq("is_deleted", false)
      .eq("is_active", true),

    supabase
      .from("inventory_transactions")
      .select(`
        ingredient_id,
        transaction_type,
        qty,
        unit
      `)
      .not(
        "ingredient_id",
        "is",
        null
      )
      .eq("is_deleted", false),
  ]);

  validateResults([
    batchResult,
    ingredientResult,
    inventoryResult,
  ]);

  let monthlyIncome = 0;
  let monthlyExpense = 0;

  if (isOwner) {
    const [
      incomeResult,
      expenseResult,
    ] = await Promise.all([
      supabase
        .from("incomes")
        .select(
          "tanggal, pemasukan_bunbun"
        )
        .gte(
          "tanggal",
          monthStart
        )
        .lte(
          "tanggal",
          monthEnd
        )
        .eq("is_deleted", false),

      supabase
        .from("expenses")
        .select(
          "tanggal, nominal"
        )
        .gte(
          "tanggal",
          monthStart
        )
        .lte(
          "tanggal",
          monthEnd
        )
        .eq("is_deleted", false),
    ]);

    validateResults([
      incomeResult,
      expenseResult,
    ]);

    monthlyIncome = sumBy(
      incomeResult.data,
      "pemasukan_bunbun"
    );

    monthlyExpense = sumBy(
      expenseResult.data,
      "nominal"
    );
  }

  const monthBatches = (
    batchResult.data ?? []
  ).filter((batch) => {
    const productionDate =
      batch.production_orders
        ?.tanggal;

    return (
      productionDate &&
      productionDate >=
        monthStart &&
      productionDate <=
        monthEnd
    );
  });

  const todayBatches =
    monthBatches.filter(
      (batch) =>
        batch.production_orders
          ?.tanggal === today
    );

  const todayFinished =
    todayBatches.reduce(
      (total, batch) =>
        total +
        Number(batch.selesai || 0),
      0
    );

  const todayReject =
    todayBatches.reduce(
      (total, batch) =>
        total +
        Number(batch.reject || 0),
      0
    );

  const rejectBase =
    todayFinished + todayReject;

  const rejectRate =
    rejectBase > 0
      ? (todayReject /
          rejectBase) *
        100
      : 0;

  const productionByRecipeMap =
    new Map();

  monthBatches.forEach((batch) => {
    const recipe =
      batch.production_orders
        ?.recipes;

    const recipeCode =
      recipe?.kode ||
      "TANPA-KODE";

    const current =
      productionByRecipeMap.get(
        recipeCode
      ) || {
        kode: recipeCode,

        nama:
          recipe?.nama ||
          "Recipe tidak diketahui",

        selesai: 0,
        reject: 0,
      };

    current.selesai += Number(
      batch.selesai || 0
    );

    current.reject += Number(
      batch.reject || 0
    );

    productionByRecipeMap.set(
      recipeCode,
      current
    );
  });

  const productionByRecipe =
    Array.from(
      productionByRecipeMap.values()
    ).sort(
      (first, second) =>
        second.selesai -
        first.selesai
    );

  const stockBaseMap =
    new Map();

  (
    inventoryResult.data ?? []
  ).forEach((transaction) => {
    const ingredientId =
      transaction.ingredient_id;

    if (!ingredientId) {
      return;
    }

    const currentStockBase =
      stockBaseMap.get(
        ingredientId
      ) || 0;

    const quantityBase =
      toBaseUnit(
        transaction.qty,
        transaction.unit
      );

    if (
      INCOMING_TRANSACTION_TYPES.includes(
        transaction.transaction_type
      )
    ) {
      stockBaseMap.set(
        ingredientId,
        currentStockBase +
          quantityBase
      );

      return;
    }

    if (
      OUTGOING_TRANSACTION_TYPES.includes(
        transaction.transaction_type
      )
    ) {
      stockBaseMap.set(
        ingredientId,
        currentStockBase -
          quantityBase
      );
    }
  });

  const stockItems = (
    ingredientResult.data ?? []
  ).map((ingredient) => {
    const stockBase =
      stockBaseMap.get(
        ingredient.id
      ) || 0;

    const minimumStock =
      Number(
        ingredient.minimum_stok ||
          0
      );

    const minimumStockBase =
      toBaseUnit(
        minimumStock,
        ingredient.satuan
      );

    const displayStock =
      fromBaseUnit(
        stockBase,
        ingredient.satuan
      );

    return {
      id: ingredient.id,
      kode: ingredient.kode,
      nama: ingredient.nama,
      satuan:
        ingredient.satuan,

      stok: displayStock,
      stokBase: stockBase,

      minimumStok:
        minimumStock,

      minimumStokBase:
        minimumStockBase,

      isLowStock:
        stockBase <=
        minimumStockBase,
    };
  });

  const lowStockItems =
    stockItems
      .filter(
        (ingredient) =>
          ingredient.isLowStock
      )
      .sort(
        (first, second) =>
          first.stokBase -
          second.stokBase
      );

  const monthlyFinished =
    monthBatches.reduce(
      (total, batch) =>
        total +
        Number(batch.selesai || 0),
      0
    );

  const monthlyReject =
    monthBatches.reduce(
      (total, batch) =>
        total +
        Number(batch.reject || 0),
      0
    );

  return {
    monthlyIncome,
    monthlyExpense,

    monthlyProfit:
      monthlyIncome -
      monthlyExpense,

    todayFinished,
    todayReject,
    rejectRate,

    monthlyFinished,
    monthlyReject,

    productionByRecipe,

    lowStockItems,

    lowStockCount:
      lowStockItems.length,

    activeBatchItems: (
      batchResult.data ?? []
    )
      .filter(
        (batch) =>
          batch.status !==
            "Finished" &&
          batch.status !==
            "Cancelled"
      )
      .map((batch) => ({
        id: batch.id,
        kode: batch.kode,

        tanggal:
          batch.production_orders
            ?.tanggal ?? "",

        recipeKode:
          batch.production_orders
            ?.recipes?.kode ?? "",

        recipeNama:
          batch.production_orders
            ?.recipes?.nama ?? "",

        target: Number(
          batch.target || 0
        ),

        selesai: Number(
          batch.selesai || 0
        ),

        reject: Number(
          batch.reject || 0
        ),

        status: batch.status,
      }))
      .sort(
        (first, second) =>
          String(
            second.tanggal
          ).localeCompare(
            String(first.tanggal)
          )
      ),
  };
}