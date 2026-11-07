/**
 * Bunbun OS — READ-ONLY historical source reconciliation.
 *
 * Purpose: show what the existing Sales, Income, Expense, Purchasing, Product
 * Stock and Ingredient Stock tables actually contain in a selected month.
 * Never infer recognized revenue, paid invoices, actual HPP, or cash balance.
 *
 * Each source is scoped independently by its own transaction date. For example,
 * a café deposit in October might pay a September sale, while a stock dispatch
 * tagged with a sale ID is not independent proof that cash was collected.
 */
import { isValidIsoDate } from "./hppCutoverOpening.js";

const TABLES = Object.freeze([
  "sales", "incomes", "expenses", "purchases",
  "productMovements", "ingredientMovements",
]);

export function validReportMonth(month) {
  return typeof month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
}

export function nextReportMonth(month) {
  if (!validReportMonth(month)) throw new Error("Bulan audit tidak valid.");
  const [year, number] = month.split("-").map(Number);
  if (year < 2000 || year > 9998) throw new Error("Tahun audit di luar cakupan.");
  return number === 12 ? (year + 1) + "-01" :
    year + "-" + String(number + 1).padStart(2, "0");
}

function readMoneyCents(value) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    value = String(value);
  }
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, decimal = ""] = value.split(".");
  const amount = BigInt(whole) * 100n + BigInt(decimal.padEnd(2, "0") || "0");
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return amount;
}

function formatCents(cents) {
  return (cents / 100n).toString() + "." + (cents % 100n).toString().padStart(2, "0");
}

function auditRows(name, input, month, dateField) {
  if (!Array.isArray(input)) throw new Error("Data " + name + " tidak lengkap.");
  const ids = new Set();
  for (const row of input) {
    if (row === null || typeof row !== "object" ||
      row.id === undefined || row.id === null) {
      throw new Error("Ada data " + name + " tanpa identitas.");
    }
    if (ids.has(String(row.id))) throw new Error("ID " + name + " duplikat.");
    ids.add(String(row.id));
    if (row.is_deleted === true) {
      throw new Error("Data " + name + " terhapus tidak boleh dimasukkan.");
    }
    if (!isValidIsoDate(row[dateField]) ||
      row[dateField].slice(0, 7) !== month) {
      throw new Error("Ada tanggal " + name + " di luar bulan audit.");
    }
  }
  return input;
}

function recordedMoney(rows, key) {
  let total = 0n;
  let invalidCount = 0;
  for (const row of rows) {
    const amount = readMoneyCents(row[key]);
    if (amount === null) {
      invalidCount++;
    } else {
      total += amount;
    }
  }
  return {
    recordedAmount: invalidCount === 0 ? formatCents(total) : null,
    amountCount: rows.length,
    missingOrInvalidAmountCount: invalidCount,
    // A missing amount makes the monthly sum UNKNOWN, not artificially zero.
  };
}

function byField(rows, key) {
  const counter = new Map();
  for (const row of rows) {
    const value = String(row[key] ?? "TIDAK DIISI").trim() || "TIDAK DIISI";
    counter.set(value, (counter.get(value) || 0) + 1);
  }
  return [...counter].map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "id"));
}

/**
 * A consistent audit always remains NOT READY for accounting: successful reads
 * do not certify actual sales, cash settlement, inventory costing or opening
 * balances. This is a preparatory diagnostic, NOT a profitability calculation.
 */
export function buildAccountingSourceReadiness(sources) {
  const {
    month, sales, incomes, expenses, purchases,
    productMovements, ingredientMovements,
  } = sources ?? {};
  if (!validReportMonth(month)) throw new Error("Pilih bulan audit yang valid.");
  for (const table of TABLES) {
    if (!Array.isArray(sources?.[table])) {
      throw new Error("Sumber " + table + " belum dimuat seluruhnya.");
    }
  }
  auditRows("penjualan", sales, month, "sale_date");
  auditRows("setoran", incomes, month, "tanggal");
  auditRows("pengeluaran", expenses, month, "tanggal");
  auditRows("pembelian", purchases, month, "tanggal");
  auditRows("stok produk", productMovements, month, "movement_date");
  auditRows("stok bahan", ingredientMovements, month, "transaction_date");

  const salesMoney = recordedMoney(sales, "total_amount");
  const incomeMoney = recordedMoney(incomes, "pemasukan_bunbun");
  const expenseMoney = recordedMoney(expenses, "nominal");
  const purchaseMoney = recordedMoney(purchases, "total");
  const productOut = productMovements.filter(row => row.movement_type === "CAFE_OUT");
  const unlinkedProductOut = productOut.filter(row => row.sale_id === null || row.sale_id === undefined);
  const linkedProductOut = productOut.filter(row => row.sale_id !== null && row.sale_id !== undefined);
  const purchaseIds = new Set(purchases.map(x => String(x.id)));
  const expenseLinked = expenses.filter(x => x.purchase_id !== null && x.purchase_id !== undefined);
  const expenseUnlinked = expenses.filter(x => x.purchase_id === null || x.purchase_id === undefined);
  const expensePurchaseOutsidePeriod = expenseLinked.filter(x => !purchaseIds.has(String(x.purchase_id)));
  const saleIds = new Set(sales.map(x => String(x.id)));
  const stockSaleOutsidePeriod = linkedProductOut.filter(x => !saleIds.has(String(x.sale_id)));
  const ingredientUse = ingredientMovements.filter(x => x.transaction_type === "PRODUCTION_OUT");
  const materialMissingValue = ingredientUse.filter(x => {
    const numberValue = readMoneyCents(x.unit_value);
    return numberValue === null || numberValue <= 0n;
  });
  const stockAdjustments = productMovements.filter(x => [
    "ADJUSTMENT_IN", "ADJUSTMENT_OUT", "OPENING_BALANCE",
  ].includes(x.movement_type));
  const ingredientAdjustments = ingredientMovements.filter(x =>
    typeof x.transaction_type === "string" && x.transaction_type.startsWith("ADJUSTMENT"));

  const issues = [];
  if (salesMoney.missingOrInvalidAmountCount) {
    issues.push("Ada catatan penjualan tanpa nominal valid; total bulanan tidak bisa dipercaya.");
  }
  if (incomeMoney.missingOrInvalidAmountCount) {
    issues.push("Ada setoran tanpa nominal valid; total setoran bulanan tidak bisa dipercaya.");
  }
  if (expenseMoney.missingOrInvalidAmountCount || purchaseMoney.missingOrInvalidAmountCount) {
    issues.push("Ada pengeluaran/pembelian tanpa nominal valid; tidak boleh diasumsikan nol.");
  }
  if (materialMissingValue.length) {
    issues.push(materialMissingValue.length +
      " mutasi pemakaian bahan produksi tidak memiliki nilai HPP per unit terverifikasi.");
  }
  if (expenseLinked.length) {
    issues.push(expenseLinked.length +
      " pengeluaran tertaut Purchasing: jangan hitung pembelian dan pembayarannya sebagai beban ganda.");
  }
  if (unlinkedProductOut.length) {
    issues.push(unlinkedProductOut.length +
      " mutasi CAFE_OUT tidak tertaut ID penjualan; belum ada bukti pelunasan atau penjualan.");
  }
  if (expensePurchaseOutsidePeriod.length || stockSaleOutsidePeriod.length) {
    issues.push("Ada referensi pembelian/penjualan di luar bulan audit atau belum terbaca; cocokkan lintas periode.");
  }
  if (stockAdjustments.length || ingredientAdjustments.length) {
    issues.push("Penyesuaian stok perlu bukti opname dan klasifikasi selisih, bukan langsung kas/HPP.");
  }

  return {
    month,
    status: "HISTORICAL_DIAGNOSTIC_ONLY",
    cutoverApproved: false,
    postedLedgerAvailable: false,
    actualProfitAvailable: false,
    approvedForBonusOrExpansion: false,
    categories: {
      sales: {
        count: sales.length, ...salesMoney,
        byChannel: byField(sales, "sales_channel"),
        interpretation: "Nilai SALES menurut OS, bukan otomatis hak pendapatan Bunbun.",
      },
      cafeDeposits: {
        count: incomes.length, ...incomeMoney,
        bySource: byField(incomes, "asal_setoran"),
        interpretation: "Setoran tercatat, bukan otomatis omzet baru atau saldo bank terverifikasi.",
      },
      expenses: {
        count: expenses.length, ...expenseMoney,
        linkedPurchases: expenseLinked.length,
        unlinkedPurchases: expenseUnlinked.length,
        purchaseReferenceOutsideSelectedMonth: expensePurchaseOutsidePeriod.length,
        byCategory: byField(expenses, "kategori"),
        interpretation: "Pengeluaran kas menurut OS, bukan seluruhnya biaya laba rugi.",
      },
      purchases: {
        count: purchases.length, ...purchaseMoney,
        ingredientItems: purchases.filter(x => x.ingredient_id != null).length,
        maintenanceItems: purchases.filter(x => x.maintenance_item_id != null).length,
        interpretation: "Pembelian perlu dipisahkan dari pembayaran dan pemakaian bahan.",
      },
      productStock: {
        movementCount: productMovements.length,
        cafeOutRows: productOut.length,
        cafeOutQty: productOut.every(x => Number.isInteger(Number(x.qty)) &&
          Number(x.qty) >= 0)
          ? productOut.reduce((sum, x) => sum + Number(x.qty), 0) : null,
        cafeOutLinkedToSale: linkedProductOut.length,
        cafeOutWithoutSaleId: unlinkedProductOut.length,
        saleIdOutsideSelectedMonth: stockSaleOutsidePeriod.length,
        adjustmentRows: stockAdjustments.length,
        interpretation: "CAFE_OUT adalah mutasi stok, belum membuktikan kas masuk atau laba.",
      },
      ingredientStock: {
        movementCount: ingredientMovements.length,
        productionUseRows: ingredientUse.length,
        productionUseWithoutVerifiedUnitValue: materialMissingValue.length,
        adjustmentRows: ingredientAdjustments.length,
        interpretation: "Nilai bahan yang dipakai produksi belum otomatis menjadi HPP penjualan.",
      },
    },
    issues,
    requiredVerifications: [
      "Tetapkan tanggal cutover dan nilai saldo awal dari stok opname fisik dan bukti kas/bank.",
      "Buktikan penjualan yang benar-benar terjadi dan berapa hak Bunbun; jangan potong bagian kafe dua kali.",
      "Rekonsiliasi setoran terhadap faktur/piutang lintas bulan, termasuk setoran sebagian.",
      "Cocokkan pembelian dengan pembayaran tertaut tanpa membebankan bahan dua kali.",
      "Validasi valuasi bahan, WIP, finished, frozen, titipan kafe dan retur/reject.",
      "Buka laporan laba rugi hanya dari jurnal akuntansi POSTED yang lengkap dan sudah direkonsiliasi.",
    ],
    writesDatabase: false,
    readyToPost: false,
  };
}
