/**
 * Bunbun OS — Owner profitability and growth presentation model.
 *
 * Only SERVER-VALIDATED posted-ledger snapshots may be interpreted as a
 * financial report. Historical Sales, café deposits and purchasing records
 * are never substituted for revenue, COGS or cash. A source-completeness audit
 * is separate from mathematical reconciliation.
 */
import { reportMoneyToCents, validatePostedFinancialSnapshot } from
  "../../supabase/functions/_shared/accountingOwnerMonthlyReport.js";

const MIN_BASE_CENTS = 1n;
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function monthOffset(month, offset) {
  if (!MONTH_PATTERN.test(month) || !Number.isInteger(offset) || Math.abs(offset) > 120) {
    throw new Error("Bulan atau rentang tidak valid.");
  }
  const [year, mon] = month.split("-").map(Number);
  const total = year * 12 + (mon - 1) + offset;
  const newYear = Math.floor(total / 12);
  const newMonth = total % 12 + 1;
  if (newYear < 2000 || newYear > 9999) throw new Error("Tahun di luar rentang.");
  return String(newYear) + "-" + String(newMonth).padStart(2, "0");
}

export function chartMonths(endingMonth, count = 6) {
  if (!Number.isInteger(count) || count < 2 || count > 12) {
    throw new Error("Jumlah bulan tidak valid.");
  }
  return Array.from({ length: count }, (_, i) =>
    monthOffset(endingMonth, i - count + 1));
}

export function parseReportAmount(amount) {
  const cents = reportMoneyToCents(amount);
  if (cents > BigInt(Number.MAX_SAFE_INTEGER) ||
    cents < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Angka laporan melebihi presisi tampilan.");
  }
  return Number(cents) / 100;
}

export function normalizeOwnerMonthlyResponse(data, requestedMonth) {
  if (!data || data.ok !== true ||
    data.status !== "STAGING_POSTED_JOURNALS_ONLY" ||
    data.dataMode !== "PRIVATE_STAGING_LEDGER" ||
    data.mayPost !== false ||
    data.sourceAudited !== false ||
    data.sourceCompletenessVerified !== false ||
    data.readyForBonusDecision !== false ||
    data.readyForExpansionDecision !== false ||
    !data.report) {
    throw new Error("Respons laporan belum memenuhi kontrak keamanan.");
  }
  // Validate all formulas again at the client boundary, not only on server.
  const report = validatePostedFinancialSnapshot({
    ...data.report, openingApproved: true,
  }, requestedMonth);

  const values = {
    revenue: parseReportAmount(report.incomeStatement.netRevenue),
    cogs: parseReportAmount(report.incomeStatement.cogs),
    grossProfit: parseReportAmount(report.incomeStatement.grossProfit),
    expenses: parseReportAmount(report.incomeStatement.operatingExpenses),
    netProfit: parseReportAmount(report.incomeStatement.netProfit),
    cashOpening: parseReportAmount(report.cashFlow.openingCash),
    cashOperating: parseReportAmount(report.cashFlow.operating),
    cashInvesting: parseReportAmount(report.cashFlow.investing),
    cashFinancing: parseReportAmount(report.cashFlow.financing),
    cashNetChange: parseReportAmount(report.cashFlow.netCashChange),
    cashClosing: parseReportAmount(report.cashFlow.closingCash),
    assets: parseReportAmount(report.financialPosition.assets),
    liabilities: parseReportAmount(report.financialPosition.liabilities),
    equity: parseReportAmount(report.financialPosition.totalEquity),
  };
  return {
    month: requestedMonth,
    cutoverDate: report.cutoverDate,
    periodStatus: report.periodStatus,
    values,
    grossMarginPct: values.revenue > 0 ? values.grossProfit / values.revenue * 100 : null,
    netMarginPct: values.revenue > 0 ? values.netProfit / values.revenue * 100 : null,
    sourceAudited: false,
    readyForBonus: false,
    readyForExpansion: false,
    source: "STAGING_POSTED_LEDGER",
  };
}

function fullClosedMonth(item, nowMonth) {
  return Boolean(item && item.periodStatus === "CLOSED" &&
    item.month < nowMonth &&
    item.cutoverDate <= item.month + "-01");
}

function meaningfulGrowth(prior, current) {
  const prev = reportMoneyToCents(prior.toFixed(2));
  const next = reportMoneyToCents(current.toFixed(2));
  if (prev < MIN_BASE_CENTS) return null;
  return Number(next - prev) / Number(prev) * 100;
}

export function buildBusinessHealthView({ selectedMonth, nowMonth, records }) {
  if (!MONTH_PATTERN.test(selectedMonth) || !MONTH_PATTERN.test(nowMonth) ||
    !Array.isArray(records)) {
    throw new Error("Data periode dashboard tidak valid.");
  }
  const months = chartMonths(selectedMonth);
  const allowed = new Set(months);
  const byMonth = new Map();
  for (const row of records) {
    if (!row || !allowed.has(row.month) || byMonth.has(row.month)) {
      throw new Error("Data dashboard duplikat atau di luar periode.");
    }
    byMonth.set(row.month, row);
  }
  const selected = byMonth.get(selectedMonth) || null;
  const prevMonth = monthOffset(selectedMonth, -1);
  const previous = byMonth.get(prevMonth) || null;
  const canCompare = fullClosedMonth(selected, nowMonth) &&
    fullClosedMonth(previous, nowMonth) &&
    selected.cutoverDate === previous.cutoverDate &&
    previous.cutoverDate <= prevMonth + "-01";

  const growth = {
    comparable: canCompare,
    revenuePct: canCompare ? meaningfulGrowth(previous.values.revenue, selected.values.revenue) : null,
    profitPct: canCompare && previous.values.netProfit > 0 ?
      meaningfulGrowth(previous.values.netProfit, selected.values.netProfit) : null,
    reason: !selected ? "Bulan dipilih belum memiliki jurnal dan saldo awal lengkap." :
      selected.periodStatus !== "CLOSED" ? "Bulan berjalan belum ditutup." :
      selected.month >= nowMonth ? "Bulan belum berakhir." :
      !previous ? "Belum tersedia bulan sebelumnya yang telah direkonsiliasi." :
      !canCompare ? "Bulan pembanding tidak penuh, belum ditutup atau belum setelah cutover." :
      null,
  };

  return {
    selectedMonth,
    selected,
    growth,
    trend: months.map(month => {
      const report = byMonth.get(month) || null;
      return {
        month,
        revenue: report?.values.revenue ?? null,
        netProfit: report?.values.netProfit ?? null,
        periodStatus: report?.periodStatus || "NOT_AVAILABLE",
      };
    }),
    balanceVerified: Boolean(selected),
    ownerDecisionReady: false,
    explanation: "Angka hanya pratinjau jurnal staging; belum diaudit kelengkapan sumber penjualan, HPP, dan stok.",
  };
}

/**
 * Explicit illustration data, never finance or cashbook data.
 * The UI must keep a visible "SIMULASI" banner whenever these records render.
 */
export function makeIllustrativeBusinessRecords(selectedMonth, nowMonth) {
  const months = chartMonths(selectedMonth);
  const trendAmounts = [
    [8400000, 3700000, 2100000],
    [9600000, 3900000, 2250000],
    [8700000, 3950000, 2300000],
    [11100000, 4600000, 2500000],
    [12200000, 4750000, 2650000],
    [13300000, 5100000, 2850000],
  ];
  const cutoverDate = months[0] + "-01";
  return months.map((month, i) => {
    const [revenue, cogs, expenses] = trendAmounts[i];
    const netProfit = revenue - cogs - expenses;
    const cashOpening = 10000000 + i * 1250000;
    const cashNetChange = netProfit - 450000;
    const cashClosing = cashOpening + cashNetChange;
    const liabilities = 1250000 + i * 45000;
    const assets = cashClosing + 8500000 + i * 250000;
    return {
      month, cutoverDate,
      periodStatus: month >= nowMonth ? "OPEN" : "CLOSED",
      source: "ILLUSTRATION_ONLY",
      sourceAudited: false,
      readyForBonus: false,
      readyForExpansion: false,
      values: {
        revenue, cogs, grossProfit: revenue - cogs, expenses, netProfit,
        cashOpening, cashOperating: cashNetChange,
        cashInvesting: 0, cashFinancing: 0, cashNetChange, cashClosing,
        assets, liabilities, equity: assets - liabilities,
      },
      grossMarginPct: (revenue - cogs) / revenue * 100,
      netMarginPct: netProfit / revenue * 100,
    };
  });
}
