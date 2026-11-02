import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAccountingSourceReadiness, validReportMonth, nextReportMonth,
} from "../src/utils/accountingSourceReadiness.js";

function fixture() {
  return {
    month: "2026-10",
    sales: [
      { id: 1, sale_date: "2026-10-10", sales_channel: "PUBLIC_HUB",
        total_amount: "200000.00" },
      { id: 2, sale_date: "2026-10-31", sales_channel: "DIRECT",
        total_amount: 15000 },
    ],
    incomes: [
      { id: 3, tanggal: "2026-10-25", asal_setoran: "Public Hub",
        pemasukan_bunbun: "150000.00" },
    ],
    expenses: [
      { id: 4, tanggal: "2026-10-03", kategori: "Bahan Baku",
        nominal: "95000.00", purchase_id: 10 },
      { id: 5, tanggal: "2026-10-28", kategori: "Gaji",
        nominal: "30000.00", purchase_id: null },
    ],
    purchases: [
      { id: 10, tanggal: "2026-10-03", total: "95000.00",
        ingredient_id: 12, maintenance_item_id: null },
    ],
    productMovements: [
      { id: 20, movement_date: "2026-10-10", movement_type: "CAFE_OUT",
        qty: 10, sale_id: 1 },
      { id: 21, movement_date: "2026-10-12", movement_type: "CAFE_OUT",
        qty: 3, sale_id: null },
      { id: 22, movement_date: "2026-10-15", movement_type: "ADJUSTMENT_OUT",
        qty: 1, sale_id: null },
      { id: 23, movement_date: "2026-10-15", movement_type: "FINISHED_IN",
        qty: 20, sale_id: null },
    ],
    ingredientMovements: [
      { id: 31, transaction_date: "2026-10-08", transaction_type: "PRODUCTION_OUT",
        unit_value: null },
      { id: 32, transaction_date: "2026-10-09", transaction_type: "PRODUCTION_OUT",
        unit_value: "100.00" },
      { id: 33, transaction_date: "2026-10-10", transaction_type: "PURCHASE",
        unit_value: null },
    ],
  };
}

test("month selection uses exact bounds and handles December -> January", () => {
  assert.equal(validReportMonth("2026-10"), true);
  assert.equal(validReportMonth("2026-00"), false);
  assert.equal(validReportMonth("2026-13"), false);
  assert.equal(nextReportMonth("2026-10"), "2026-11");
  assert.equal(nextReportMonth("2026-12"), "2027-01");
  assert.throws(() => nextReportMonth("2026-00"));
  assert.throws(() => nextReportMonth("1999-12"));
});

test("sales, café deposits, purchasing and expenses remain separate recording sources", () => {
  const r = buildAccountingSourceReadiness(fixture());
  assert.equal(r.categories.sales.recordedAmount, "215000.00");
  assert.equal(r.categories.cafeDeposits.recordedAmount, "150000.00");
  assert.equal(r.categories.expenses.recordedAmount, "125000.00");
  assert.equal(r.categories.purchases.recordedAmount, "95000.00");
  assert.equal(r.actualProfitAvailable, false);
  assert.equal(r.approvedForBonusOrExpansion, false);
  assert.equal(r.postedLedgerAvailable, false);
  assert.equal(r.writesDatabase, false);
  assert.equal(r.readyToPost, false);
  assert.equal("profit" in r, false);
});

test("expense linked to purchase is counted for duplicate risk, not counted as extra HPP", () => {
  const r = buildAccountingSourceReadiness(fixture());
  assert.equal(r.categories.expenses.linkedPurchases, 1);
  assert.equal(r.categories.expenses.unlinkedPurchases, 1);
  assert.equal(r.categories.expenses.purchaseReferenceOutsideSelectedMonth, 0);
  assert.equal(r.categories.purchases.ingredientItems, 1);
  assert.ok(r.issues.some(x => x.includes("Purchasing")));
});

test("unlinked CAFE_OUT is a reconciliation gap, not proof of an unpaid sale", () => {
  const r = buildAccountingSourceReadiness(fixture());
  assert.equal(r.categories.productStock.cafeOutRows, 2);
  assert.equal(r.categories.productStock.cafeOutQty, 13);
  assert.equal(r.categories.productStock.cafeOutLinkedToSale, 1);
  assert.equal(r.categories.productStock.cafeOutWithoutSaleId, 1);
  assert.equal(r.categories.productStock.adjustmentRows, 1);
  assert.ok(r.categories.productStock.interpretation.includes("belum membuktikan"));
  assert.equal(r.actualProfitAvailable, false);
});

test("missing material unit valuation is a blocker, not zero HPP", () => {
  const r = buildAccountingSourceReadiness(fixture());
  assert.equal(r.categories.ingredientStock.productionUseRows, 2);
  assert.equal(r.categories.ingredientStock.productionUseWithoutVerifiedUnitValue, 1);
  assert.ok(r.issues.some(x => x.includes("nilai HPP")));
});

test("completely missing monetary value renders unknown, not a fake zero total", () => {
  const input = fixture();
  input.sales[0].total_amount = null;
  const r = buildAccountingSourceReadiness(input);
  assert.equal(r.categories.sales.recordedAmount, null);
  assert.equal(r.categories.sales.missingOrInvalidAmountCount, 1);
  assert.ok(r.issues.some(x => x.includes("nominal valid")));
});

test("zero transaction records stay diagnostic; zero revenue is not proven", () => {
  const input = fixture();
  for (const key of ["sales", "incomes", "expenses", "purchases",
    "productMovements", "ingredientMovements"]) input[key] = [];
  const r = buildAccountingSourceReadiness(input);
  assert.equal(r.categories.sales.count, 0);
  assert.equal(r.categories.sales.recordedAmount, "0.00");
  assert.equal(r.actualProfitAvailable, false);
  assert.equal(r.requiredVerifications.length, 6);
});

test("missing source array does not create a misleading partial audit", () => {
  const input = fixture();
  delete input.purchases;
  assert.throws(() => buildAccountingSourceReadiness(input), /belum dimuat/);
});

test("any row belonging to a different month is rejected", () => {
  const input = fixture();
  input.incomes[0].tanggal = "2026-11-01";
  assert.throws(() => buildAccountingSourceReadiness(input), /di luar bulan/);
});

test("deleted rows and duplicate transaction identities must not enter audit", () => {
  const input = fixture();
  input.sales[0].is_deleted = true;
  assert.throws(() => buildAccountingSourceReadiness(input), /terhapus/);
  const duplicate = fixture();
  duplicate.sales.push({ ...duplicate.sales[0] });
  assert.throws(() => buildAccountingSourceReadiness(duplicate), /duplikat/);
});

test("a purchase or sale link missing in this month is not automatically an orphan", () => {
  const input = fixture();
  input.expenses[0].purchase_id = 100;
  input.productMovements[0].sale_id = 100;
  const r = buildAccountingSourceReadiness(input);
  assert.equal(r.categories.expenses.purchaseReferenceOutsideSelectedMonth, 1);
  assert.equal(r.categories.productStock.saleIdOutsideSelectedMonth, 1);
  assert.ok(r.issues.some(x => x.includes("lintas periode")));
});

test("recorded amounts support decimal string and whole Rupiah values", () => {
  const input = fixture();
  input.sales[1].total_amount = "15000.25";
  input.incomes[0].pemasukan_bunbun = 90000.5;
  const r = buildAccountingSourceReadiness(input);
  assert.equal(r.categories.sales.recordedAmount, "215000.25");
  assert.equal(r.categories.cafeDeposits.recordedAmount, "90000.50");
});

test("non-money or bad money cannot quietly enter aggregate", () => {
  const input = fixture();
  input.expenses[0].nominal = "-10";
  input.purchases[0].total = "12,000";
  const r = buildAccountingSourceReadiness(input);
  assert.equal(r.categories.expenses.recordedAmount, null);
  assert.equal(r.categories.purchases.recordedAmount, null);
  assert.equal(r.categories.expenses.missingOrInvalidAmountCount, 1);
  assert.equal(r.categories.purchases.missingOrInvalidAmountCount, 1);
});

test("adjustment types and unknown cash sources are retained for manual inspection", () => {
  const input = fixture();
  input.ingredientMovements.push({
    id: 34, transaction_date: "2026-10-12", transaction_type: "ADJUSTMENT_IN",
    unit_value: null,
  });
  input.incomes[0].asal_setoran = null;
  const r = buildAccountingSourceReadiness(input);
  assert.equal(r.categories.ingredientStock.adjustmentRows, 1);
  assert.equal(r.categories.cafeDeposits.bySource[0].name, "TIDAK DIISI");
  assert.ok(r.issues.some(x => x.includes("Penyesuaian stok")));
});

test("income and sale dates need not match: audit does not infer accrual from cash", () => {
  const input = fixture();
  input.incomes[0].tanggal = "2026-10-01";
  const r = buildAccountingSourceReadiness(input);
  assert.equal(r.categories.cafeDeposits.recordedAmount, "150000.00");
  assert.equal(r.categories.sales.recordedAmount, "215000.00");
  assert.equal(r.status, "HISTORICAL_DIAGNOSTIC_ONLY");
});
