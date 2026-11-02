import { test } from "node:test";
import assert from "node:assert/strict";
import { proposeAccountingEvent } from "../src/utils/accountingEventProposals.js";

const base = {
  reviewed: true, date: "2026-11-10", sourceKey: "sales:101",
  evidence: "Rekonsiliasi Owner berdasarkan transaksi dan dokumen kafe",
  amount: "70000.00",
};
const propose = (type, extra = {}) =>
  proposeAccountingEvent({ ...base, type, ...extra });

test("Bunbun sale uses already-confirmed net entitlement, never repeats 70 percent math", () => {
  const p = propose("RECOGNIZE_BUNBUN_SALE", {
    revenueBasis: "CONFIRMED_BUNBUN_ENTITLEMENT",
    grossCafeSales: "100000.00",
  });
  assert.deepEqual(p.lines, [
    { accountCode: "1120", debit: "70000.00", credit: "0.00" },
    { accountCode: "4010", debit: "0.00", credit: "70000.00" },
  ]);
  assert.equal(p.status, "DRAFT");
  assert.equal(p.readyToPost, false);
  assert.equal(p.writesDatabase, false);
});

test("raw gross café sales cannot be silently recognized as Bunbun net revenue", () => {
  assert.throws(() => propose("RECOGNIZE_BUNBUN_SALE"), /hak Bunbun/i);
  assert.throws(() => propose("RECOGNIZE_BUNBUN_SALE", {
    revenueBasis: "GROSS_CAFE_SALES",
  }), /hak Bunbun/i);
});

test("café deposit settles receivable rather than generating second revenue", () => {
  const p = propose("RECEIVE_CAFE_SETTLEMENT", {
    sourceKey: "deposit:201", receivableReference: "invoice:101",
    cashAccount: "1020",
  });
  assert.deepEqual(p.lines.map(x => x.accountCode), ["1020", "1120"]);
  assert.equal(p.cashFlowCategory, "OPERATING");
  assert.equal(p.requiresBalanceCheck, true);
  assert.ok(!p.lines.some(x => x.accountCode === "4010"));
});

test("café deposit without matched receivable is blocked", () => {
  assert.throws(() => propose("RECEIVE_CAFE_SETTLEMENT", {
    cashAccount: "1020",
  }), /piutang/i);
});

test("purchase is raw inventory against payable, not direct COGS/period expense", () => {
  const p = propose("PURCHASE_RAW_MATERIAL", { sourceKey: "purchase:10" });
  assert.deepEqual(p.lines.map(x => x.accountCode), ["1210", "2010"]);
  assert.equal(p.cashFlowCategory, null);
  const payment = propose("PAY_PURCHASE_PAYABLE", {
    sourceKey: "payment:10", cashAccount: "1020",
  });
  assert.deepEqual(payment.lines.map(x => x.accountCode), ["2010", "1020"]);
  assert.equal(payment.cashFlowCategory, "OPERATING");
});

test("purchase-linked expenses cannot be classified as independent period expense", () => {
  assert.throws(() => propose("PERIOD_EXPENSE_PAYMENT", {
    linkedPurchaseId: 10, expenseAccount: "6010", cashAccount: "1020",
  }), /Purchasing/i);
});

test("production materials/WIP/finished and cafe delivery do not generate revenue", () => {
  const m = propose("MATERIALS_TO_WIP");
  const f = propose("WIP_TO_FINISHED", {
    targetInventoryAccount: "1220",
  });
  const s = propose("TRANSFER_SELLABLE_STOCK", {
    sourceInventoryAccount: "1220", targetInventoryAccount: "1240",
  });
  assert.deepEqual([m.lines.map(x => x.accountCode),
    f.lines.map(x => x.accountCode),
    s.lines.map(x => x.accountCode)], [
      ["1215", "1210"], ["1220", "1215"], ["1240", "1220"],
    ]);
  assert.ok([m, f, s].every(x => x.cashFlowCategory === null && x.requiresStockCheck));
});

test("stock transfer refuses same source and destination and unrelated accounts", () => {
  assert.throws(() => propose("TRANSFER_SELLABLE_STOCK", {
    sourceInventoryAccount: "1220", targetInventoryAccount: "1220",
  }), /berbeda/i);
  assert.throws(() => propose("TRANSFER_SELLABLE_STOCK", {
    sourceInventoryAccount: "1210", targetInventoryAccount: "1240",
  }), /asal stock/i);
});

test("sold COGS and abnormal inventory loss require explicit valued stock source", () => {
  const cogs = propose("RECOGNIZE_SOLD_COGS", { inventoryAccount: "1240" });
  assert.deepEqual(cogs.lines.map(x => x.accountCode), ["5010", "1240"]);
  assert.equal(cogs.requiresStockCheck, true);
  const waste = propose("ABNORMAL_STOCK_LOSS", { inventoryAccount: "1210" });
  assert.deepEqual(waste.lines.map(x => x.accountCode), ["6070", "1210"]);
  assert.equal(waste.requiresStockCheck, true);
});

test("all cash activities distinguish operations, capital investments, funding and drawings", () => {
  const expense = propose("PERIOD_EXPENSE_PAYMENT", {
    expenseAccount: "6010", cashAccount: "1020",
  });
  const capex = propose("CAPITAL_EXPENDITURE", { cashAccount: "1020" });
  const capital = propose("OWNER_CAPITAL_IN", { cashAccount: "1010" });
  const drawing = propose("OWNER_DRAWING", { cashAccount: "1010" });
  assert.deepEqual([expense.cashFlowCategory, capex.cashFlowCategory,
    capital.cashFlowCategory, drawing.cashFlowCategory],
    ["OPERATING", "INVESTING", "FINANCING", "FINANCING"]);
  assert.deepEqual(capex.lines.map(x => x.accountCode), ["1590", "1020"]);
  assert.deepEqual(capital.lines.map(x => x.accountCode), ["1010", "3100"]);
  assert.deepEqual(drawing.lines.map(x => x.accountCode), ["3200", "1010"]);
});

test("a proposal always requires review, evidence, source key, date and positive amount", () => {
  assert.throws(() => propose("PURCHASE_RAW_MATERIAL", { reviewed: false }), /direview/i);
  assert.throws(() => propose("PURCHASE_RAW_MATERIAL", { evidence: " " }), /bukti/i);
  assert.throws(() => propose("PURCHASE_RAW_MATERIAL", { sourceKey: "" }), /sumber unik/i);
  assert.throws(() => propose("PURCHASE_RAW_MATERIAL", { date: "2026-02-30" }), /tanggal/i);
  assert.throws(() => propose("PURCHASE_RAW_MATERIAL", { amount: "0" }), /positif/i);
  assert.throws(() => propose("PURCHASE_RAW_MATERIAL", { amount: "12.345" }), /desimal/i);
});

test("unknown event types and cash accounts must not be auto-mapped", () => {
  assert.throws(() => propose("LEGACY_CASHBOOK_DUMP"), /belum punya aturan/i);
  assert.throws(() => propose("OWNER_CAPITAL_IN"), /kas\/bank/i);
  assert.throws(() => propose("OWNER_CAPITAL_IN", { cashAccount: "1210" }), /kas\/bank/i);
});

test("wholesale sale posts to separate revenue account", () => {
  const p = propose("RECOGNIZE_WHOLESALE_SALE");
  assert.deepEqual(p.lines.map(x => x.accountCode), ["1120", "4020"]);
});
