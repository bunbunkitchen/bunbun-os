import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toJournalCents, buildPostedFinancialReports, comparePostedMonthlyPerformance,
  ACCOUNT_CATALOG,
} from "../src/utils/accountingPostedReports.js";

const entry = (code, debit = "0", credit = "0") => ({
  accountCode: code, debit, credit,
});
function journal(id, date, lines, category = null, sourceType = "NORMAL") {
  return {
    id, operationKey: "operation:" + id, date, status: "POSTED",
    cashFlowCategory: category, sourceType, lines,
  };
}
const opening = journal("opening", "2026-11-01", [
  entry("1020", "1000000"), entry("1210", "400000"),
  entry("3000", "0", "1400000"),
], null, "OPENING");
const purchaseOnCredit = journal("purchase", "2026-11-02", [
  entry("1210", "100000"), entry("2010", "0", "100000"),
]);
const consumeMaterials = journal("consume", "2026-11-03", [
  entry("1215", "120000"), entry("1210", "0", "120000"),
]);
const finish = journal("finish", "2026-11-04", [
  entry("1220", "120000"), entry("1215", "0", "120000"),
]);
const shipToCafe = journal("ship", "2026-11-05", [
  entry("1240", "120000"), entry("1220", "0", "120000"),
]);
const recognizeSale = journal("sale", "2026-11-10", [
  entry("1120", "200000"), entry("4010", "0", "200000"),
]);
const soldCost = journal("cogs", "2026-11-10", [
  entry("5010", "80000"), entry("1240", "0", "80000"),
]);
const receiveDeposit = journal("deposit", "2026-11-11", [
  entry("1020", "200000"), entry("1120", "0", "200000"),
], "OPERATING");
const salary = journal("salary", "2026-11-20", [
  entry("6010", "40000"), entry("1020", "0", "40000"),
], "OPERATING");
const buyOven = journal("oven", "2026-11-21", [
  entry("1590", "150000"), entry("1020", "0", "150000"),
], "INVESTING");
const ownerFunds = journal("capital", "2026-11-22", [
  entry("1020", "50000"), entry("3100", "0", "50000"),
], "FINANCING");
const bankToCash = journal("transfer", "2026-11-23", [
  entry("1010", "20000"), entry("1020", "0", "20000"),
], "TRANSFER");
const decemberSale = journal("dec-sale", "2026-12-02", [
  entry("1120", "100000"), entry("4010", "0", "100000"),
]);
const decemberCost = journal("dec-cogs", "2026-12-02", [
  entry("5010", "40000"), entry("1240", "0", "40000"),
]);

const novemberJournals = [opening, purchaseOnCredit, consumeMaterials,
  finish, shipToCafe, recognizeSale, soldCost, receiveDeposit,
  salary, buyOven, ownerFunds, bankToCash];
const base = {cutoverDate: "2026-11-01", month: "2026-11", journals: novemberJournals};
const build = (overrides = {}) => buildPostedFinancialReports({...base, ...overrides});

test("account catalog has no duplicate codes and distinguishes all asset classes", () => {
  assert.equal(new Set(ACCOUNT_CATALOG.map(a => a.code)).size, ACCOUNT_CATALOG.length);
  assert.ok(ACCOUNT_CATALOG.some(a => a.code === "1215"));
  assert.ok(ACCOUNT_CATALOG.some(a => a.code === "1240"));
});

test("journal money is strict decimal and preserves cents", () => {
  assert.equal(toJournalCents("1200.09"), 120009);
  assert.equal(toJournalCents("0"), 0);
  assert.equal(toJournalCents("1.5"), 150);
  assert.throws(() => toJournalCents("1.234"));
  assert.throws(() => toJournalCents("1,234"));
  assert.throws(() => toJournalCents(-1));
  assert.throws(() => toJournalCents(Number.POSITIVE_INFINITY));
  assert.throws(() => toJournalCents("99999999999999999999999"));
});

test("P&L recognizes sales only once; café deposit is settlement not new revenue", () => {
  const report = build();
  assert.deepEqual([
    report.incomeStatement.revenue, report.incomeStatement.cogs,
    report.incomeStatement.grossProfit, report.incomeStatement.operatingExpenses,
    report.incomeStatement.netProfit,
  ], [200000, 80000, 120000, 40000, 80000]);
  assert.equal(report.incomeStatement.grossMarginPercent, 60);
  assert.equal(report.incomeStatement.netMarginPercent, 40);
  assert.equal(report.dataQuality.historicalCashbookUsed, false);
});

test("cash flows classify operating, investing and financing and reconcile", () => {
  const report = build();
  assert.deepEqual(report.cashFlow, {
    operating: 160000, investing: -150000, financing: 50000,
    netChange: 60000, openingCash: 1000000,
    closingCash: 1060000, reconciles: true,
  });
  assert.equal(report.noAutomaticBonusRecommendation, true);
});

test("balance sheet reconciles through unclosed current profit", () => {
  const report = build();
  assert.deepEqual(report.financialPosition, {
    assets: 1630000,
    liabilities: 100000,
    equityBeforeCurrentEarnings: 1450000,
    cumulativeProfitSinceCutover: 80000,
    totalEquity: 1530000,
    balanced: true,
  });
});

test("goods sent to café do NOT produce revenue or COGS until sale is posted", () => {
  const report = build({journals: [opening, purchaseOnCredit, consumeMaterials, finish, shipToCafe]});
  assert.equal(report.incomeStatement.revenue, 0);
  assert.equal(report.incomeStatement.cogs, 0);
  assert.equal(report.incomeStatement.netProfit, 0);
  assert.equal(report.financialPosition.assets, 1400000);
  assert.equal(report.financialPosition.liabilities, 100000);
  assert.equal(report.financialPosition.totalEquity, 1400000);
});

test("purchase on credit raises inventory and payables, not immediate cash expense", () => {
  const report = build({journals: [opening, purchaseOnCredit]});
  assert.equal(report.cashFlow.netChange, 0);
  assert.equal(report.incomeStatement.cogs, 0);
  assert.equal(report.financialPosition.liabilities, 100000);
});

test("only a single posted opening journal can establish a report", () => {
  assert.throws(() => build({journals: [recognizeSale]}), /tepat satu/i);
  assert.throws(() => build({journals: [opening, {...opening, id: "opening-2", operationKey: "op:2"}]}), /tepat satu/i);
  assert.throws(() => build({journals: [{...opening, status: "DRAFT"}]}), /POSTED/i);
});

test("a journal must balance and every line must be debit XOR credit", () => {
  assert.throws(() => build({journals: [opening, journal("bad", "2026-11-02",
    [entry("1120", "100"), entry("4010", "0", "90")])]}), /seimbang/i);
  assert.throws(() => build({journals: [opening, journal("both", "2026-11-02",
    [entry("1120", "100", "100"), entry("4010", "0", "100")])]}), /satu sisi/i);
});

test("duplicate journal IDs and operation keys are rejected", () => {
  assert.throws(() => build({journals: [opening, recognizeSale, recognizeSale]}), /duplikat/i);
  assert.throws(() => build({journals: [opening, recognizeSale,
    {...soldCost, operationKey: recognizeSale.operationKey}]}), /duplikat/i);
});

test("cash payments require classification; purely noncash journals must not claim cash flow", () => {
  assert.throws(() => build({journals: [opening, {...receiveDeposit, cashFlowCategory: null}]}), /arus kas/i);
  assert.throws(() => build({journals: [opening, {...recognizeSale, cashFlowCategory: "OPERATING"}]}), /nonkas/i);
});

test("transfers between bank and cash have zero net cash flow", () => {
  const report = build({journals: [opening, bankToCash]});
  assert.equal(report.cashFlow.closingCash, 1000000);
  assert.equal(report.cashFlow.operating, 0);
  assert.equal(report.cashFlow.netChange, 0);
  assert.throws(() => build({journals: [opening, {...bankToCash, cashFlowCategory: "OPERATING"}]}), /transfer/i);
});

test("mixed cash debit and credit in non-transfer journal is rejected", () => {
  const mixed = journal("mix", "2026-11-02",
    [entry("1020", "100"), entry("1010", "0", "80"), entry("4010", "0", "20")], "OPERATING");
  assert.throws(() => build({journals: [opening, mixed]}), /mencampur/i);
});

test("opening journal excludes period income/expense accounts", () => {
  const fakeOpening = journal("op", "2026-11-01", [
    entry("1020", "100"), entry("4010", "0", "100"),
  ], null, "OPENING");
  assert.throws(() => build({journals: [fakeOpening]}), /pendapatan atau beban/i);
});

test("bad report dates and journal accounts cannot create fake profit", () => {
  assert.throws(() => build({month: "2026-10"}), /periode/i);
  assert.throws(() => build({month: "2026-13"}), /periode/i);
  assert.throws(() => build({journals: [opening, journal("unknown", "2026-11-02",
    [entry("9999", "100"), entry("4010", "0", "100")])]}), /akun/i);
});

test("negative revenue adjustments are recognized via separate contra revenue account", () => {
  const refund = journal("return", "2026-11-24", [
    entry("4090", "10000"), entry("1120", "0", "10000"),
  ]);
  const report = build({journals: [...novemberJournals, refund]});
  assert.equal(report.incomeStatement.revenue, 190000);
  assert.equal(report.incomeStatement.netProfit, 70000);
});

test("monthly comparison requires consecutive full periods and positive denominator", () => {
  const previous = build();
  const current = build({
    month: "2026-12",
    journals: [...novemberJournals, decemberSale, decemberCost],
  });
  const comparison = comparePostedMonthlyPerformance(previous, current);
  assert.equal(comparison.comparable, true);
  assert.equal(comparison.revenueGrowthPercent, -50);
  assert.equal(comparison.profitGrowthPercent, -25);
  assert.equal(comparePostedMonthlyPerformance(null, current).comparable, false);
  const partial = build({
    cutoverDate: "2026-11-10",
    journals: [
      {...opening, date: "2026-11-10"},
      {...recognizeSale, date: "2026-11-10"},
      {...soldCost, date: "2026-11-10"},
    ],
  });
  assert.equal(comparePostedMonthlyPerformance(partial, current).comparable, false);
});

test("income margin is unknown when sales are zero, not falsely 0%", () => {
  const report = build({journals: [opening]});
  assert.equal(report.incomeStatement.revenue, 0);
  assert.equal(report.incomeStatement.netMarginPercent, null);
});
