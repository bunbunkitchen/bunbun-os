import { test } from "node:test";
import assert from "node:assert/strict";
import {
  monthOffset, chartMonths, parseReportAmount,
  normalizeOwnerMonthlyResponse, buildBusinessHealthView,
  makeIllustrativeBusinessRecords,
} from "../src/utils/accountingBusinessHealth.js";

const MONTH = "2026-10";
const CUTOVER = "2026-01-01";
const testReport = ({
  month = MONTH, status = "CLOSED", cutoverDate = CUTOVER,
  revenue = "150000.00", cogs = "60000.00", expenses = "20000.00",
} = {}) => {
  const r = Number(revenue), c = Number(cogs), e = Number(expenses);
  return {
    ok: true, status: "STAGING_POSTED_JOURNALS_ONLY",
    dataMode: "PRIVATE_STAGING_LEDGER",
    mayPost: false, sourceAudited: false,
    sourceCompletenessVerified: false,
    readyForBonusDecision: false,
    readyForExpansionDecision: false,
    report: {
      month, cutoverDate, periodStatus: status,
      incomeStatement: {
        netRevenue: revenue, cogs, grossProfit: (r - c).toFixed(2),
        operatingExpenses: expenses, netProfit: (r - c - e).toFixed(2),
      },
      cashFlow: {
        openingCash: "100000.00", operating: "10000.00",
        investing: "-3000.00", financing: "0.00",
        netCashChange: "7000.00", closingCash: "107000.00",
      },
      financialPosition: {
        assets: "200000.00", liabilities: "30000.00",
        totalEquity: "170000.00", trialBalanceDifference: "0.00",
      },
    },
  };
};

const normalize = args => normalizeOwnerMonthlyResponse(testReport(args), args?.month || MONTH);

test("chart months rolls over years in correct order", () => {
  assert.deepEqual(chartMonths("2027-02", 4),
    ["2026-11", "2026-12", "2027-01", "2027-02"]);
  assert.equal(monthOffset("2026-01", -1), "2025-12");
  assert.equal(monthOffset("2026-12", 1), "2027-01");
  assert.throws(() => chartMonths("2026-13"));
  assert.throws(() => chartMonths("2026-10", 0));
});

test("posted Owner report maps accurate P&L, cash and net margin", () => {
  const result = normalize();
  assert.equal(result.month, "2026-10");
  assert.equal(result.cutoverDate, CUTOVER);
  assert.equal(result.values.revenue, 150000);
  assert.equal(result.values.cogs, 60000);
  assert.equal(result.values.grossProfit, 90000);
  assert.equal(result.values.expenses, 20000);
  assert.equal(result.values.netProfit, 70000);
  assert.equal(result.values.cashClosing, 107000);
  assert.equal(result.values.assets, 200000);
  assert.equal(result.grossMarginPct, 60);
  assert.ok(Math.abs(result.netMarginPct - 46.6666666667) < 0.0001);
  assert.equal(result.readyForBonus, false);
  assert.equal(result.readyForExpansion, false);
  assert.equal(result.source, "STAGING_POSTED_LEDGER");
});

test("no fake report without correct staging API provenance", () => {
  for (const override of [
    { ok: false },
    { status: "UNTRUSTED" },
    { dataMode: "HISTORIC_CASHBOOK" },
    { sourceAudited: true },
    { sourceCompletenessVerified: true },
    { mayPost: true },
    { readyForBonusDecision: true },
    { readyForExpansionDecision: true },
    { report: null },
  ]) {
    assert.throws(() => normalizeOwnerMonthlyResponse({
      ...testReport(), ...override,
    }, MONTH), /kontrak keamanan/i);
  }
});

test("mismatched dates, incomplete cash and out-of-balance financials are blocked", () => {
  const good = testReport();
  const bad = [
    { ...good, report: { ...good.report, month: "2026-09" } },
    { ...good, report: { ...good.report, cutoverDate: "2026-11-01" } },
    { ...good, report: {
      ...good.report, cashFlow: { ...good.report.cashFlow, closingCash: "99999.00" },
    } },
    { ...good, report: {
      ...good.report, financialPosition: {
        ...good.report.financialPosition, assets: "150000.00",
      },
    } },
    { ...good, report: {
      ...good.report, incomeStatement: {
        ...good.report.incomeStatement, netProfit: "99999.00",
      },
    } },
  ];
  for (const snapshot of bad) {
    assert.throws(() => normalizeOwnerMonthlyResponse(snapshot, MONTH));
  }
});

test("money conversion preserves negative and decimal-cent amounts", () => {
  assert.equal(parseReportAmount("1234.56"), 1234.56);
  assert.equal(parseReportAmount("-100.25"), -100.25);
  assert.throws(() => parseReportAmount("2.999"));
  assert.throws(() => parseReportAmount("999999999999999.99"), /nilai laporan|presisi/i);
});

test("closed full adjacent months calculate revenue and profit MoM growth", () => {
  const prev = normalize({ month: "2026-09",
    revenue: "100000.00", cogs: "60000.00", expenses: "20000.00" });
  const curr = normalize({ month: "2026-10",
    revenue: "150000.00", cogs: "60000.00", expenses: "20000.00" });
  const result = buildBusinessHealthView({
    selectedMonth: "2026-10", nowMonth: "2026-11", records: [prev, curr],
  });
  assert.equal(result.growth.comparable, true);
  assert.equal(result.growth.revenuePct, 50);
  assert.equal(result.growth.profitPct, 250);
  assert.equal(result.selected.values.netProfit, 70000);
  assert.equal(result.ownerDecisionReady, false);
});

test("open/current month never compares its partial results to a full prior month", () => {
  const prev = normalize({ month: "2026-09" });
  const curr = normalize({ month: "2026-10", status: "OPEN" });
  for (const nowMonth of ["2026-10", "2026-11"]) {
    const report = buildBusinessHealthView({
      selectedMonth: "2026-10", nowMonth, records: [prev, curr],
    });
    assert.equal(report.growth.comparable, false);
    assert.equal(report.growth.revenuePct, null);
    assert.ok(report.growth.reason);
  }
  const closedCurrent = normalize({ month: "2026-10" });
  assert.equal(buildBusinessHealthView({
    selectedMonth: "2026-10", nowMonth: "2026-10",
    records: [prev, closedCurrent],
  }).growth.comparable, false);
});

test("first partial cutover month is not a valid comparison base", () => {
  const prev = normalize({
    month: "2026-09", cutoverDate: "2026-09-15",
  });
  const curr = normalize({
    month: "2026-10", cutoverDate: "2026-09-15",
  });
  const report = buildBusinessHealthView({
    selectedMonth: "2026-10", nowMonth: "2026-11",
    records: [prev, curr],
  });
  assert.equal(report.growth.comparable, false);
  assert.equal(report.growth.revenuePct, null);
});

test("cutover inconsistency between periods blocks growth", () => {
  const prev = normalize({ month: "2026-09" });
  const curr = normalize({ month: "2026-10", cutoverDate: "2026-09-01" });
  const result = buildBusinessHealthView({
    selectedMonth: "2026-10", nowMonth: "2026-11",
    records: [prev, curr],
  });
  assert.equal(result.growth.comparable, false);
});

test("missing previous month must remain a chart gap, not zero or 100% growth", () => {
  const result = buildBusinessHealthView({
    selectedMonth: "2026-10", nowMonth: "2026-11",
    records: [normalize({ month: "2026-10" })],
  });
  assert.equal(result.growth.revenuePct, null);
  assert.equal(result.trend.length, 6);
  assert.equal(result.trend[4].revenue, null);
  assert.equal(result.trend[5].revenue, 150000);
});

test("zero prior revenue and nonpositive prior profit do not yield misleading percentages", () => {
  const zero = normalize({ month: "2026-09", revenue: "0.00", cogs: "0.00", expenses: "0.00" });
  const current = normalize({ month: "2026-10" });
  const result = buildBusinessHealthView({
    selectedMonth: "2026-10", nowMonth: "2026-11",
    records: [zero, current],
  });
  assert.equal(result.growth.comparable, true);
  assert.equal(result.growth.revenuePct, null);
  assert.equal(result.growth.profitPct, null);
  const losing = normalize({ month: "2026-09", revenue: "10000.00", cogs: "9000.00", expenses: "5000.00" });
  const result2 = buildBusinessHealthView({
    selectedMonth: "2026-10", nowMonth: "2026-11",
    records: [losing, current],
  });
  assert.equal(result2.growth.profitPct, null);
});

test("duplicate and out-of-period reports are refused", () => {
  const report = normalize();
  assert.throws(() => buildBusinessHealthView({
    selectedMonth: "2026-10", nowMonth: "2026-11",
    records: [report, report],
  }), /duplikat/i);
  assert.throws(() => buildBusinessHealthView({
    selectedMonth: "2026-10", nowMonth: "2026-11",
    records: [normalize({ month: "2025-01", cutoverDate: "2025-01-01" })],
  }), /di luar periode/i);
});

test("explicit illustration has valid formulas and cannot be called actual profit", () => {
  const rows = makeIllustrativeBusinessRecords("2026-10", "2026-11");
  assert.equal(rows.length, 6);
  assert.ok(rows.every(r => r.source === "ILLUSTRATION_ONLY"));
  assert.ok(rows.every(r => r.readyForBonus === false && r.readyForExpansion === false));
  for (const row of rows) {
    const v = row.values;
    assert.equal(v.revenue - v.cogs - v.expenses, v.netProfit);
    assert.equal(v.cashOpening + v.cashNetChange, v.cashClosing);
    assert.equal(v.assets, v.liabilities + v.equity);
  }
  const dash = buildBusinessHealthView({
    selectedMonth: "2026-10", nowMonth: "2026-11", records: rows,
  });
  assert.equal(dash.growth.comparable, true);
  assert.ok(dash.growth.revenuePct > 0);
  assert.equal(dash.ownerDecisionReady, false);
});
