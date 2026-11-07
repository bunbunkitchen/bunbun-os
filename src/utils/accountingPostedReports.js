/**
 * Bunbun OS — financial reports from VERIFIED, POSTED double-entry journals.
 *
 * This module is pure, writes nothing, does not read legacy cashbook records,
 * and will refuse to calculate a "profit" if the opening journal is missing.
 *
 * Only an approved accounting posting backend may supply POSTED journals.
 * Passing synthetic records to this function does not make them audited.
 */
import { isValidIsoDate } from "./hppCutoverOpening.js";

export const ACCOUNT_CATALOG = Object.freeze([
  { code: "1010", name: "Kas Tunai", type: "ASSET", cash: true },
  { code: "1020", name: "Bank", type: "ASSET", cash: true },
  { code: "1120", name: "Piutang Usaha", type: "ASSET" },
  { code: "1210", name: "Persediaan Bahan Baku", type: "ASSET" },
  { code: "1215", name: "Produksi Dalam Proses (WIP)", type: "ASSET" },
  { code: "1220", name: "Persediaan Produk Jadi", type: "ASSET" },
  { code: "1230", name: "Persediaan Produk Frozen", type: "ASSET" },
  { code: "1240", name: "Produk Titipan Kafe (Belum Terjual)", type: "ASSET" },
  { code: "1590", name: "Aset Usaha Lain", type: "ASSET" },
  { code: "2010", name: "Utang Usaha", type: "LIABILITY" },
  { code: "2090", name: "Kewajiban Usaha Lain", type: "LIABILITY" },
  { code: "3000", name: "Ekuitas Awal Penyeimbang", type: "EQUITY" },
  { code: "3100", name: "Setoran Modal Owner", type: "EQUITY" },
  { code: "3200", name: "Prive Owner", type: "CONTRA_EQUITY" },
  { code: "4010", name: "Pendapatan Penjualan Hak Bunbun", type: "REVENUE" },
  { code: "4020", name: "Pendapatan Wholesale", type: "REVENUE" },
  { code: "4090", name: "Retur / Potongan Pendapatan", type: "CONTRA_REVENUE" },
  { code: "5010", name: "HPP Produk Terjual", type: "COGS" },
  { code: "6010", name: "Beban Gaji Nonproduksi", type: "EXPENSE" },
  { code: "6020", name: "Beban Utilitas Nonproduksi", type: "EXPENSE" },
  { code: "6030", name: "Beban Maintenance Periode", type: "EXPENSE" },
  { code: "6040", name: "Beban Penyusutan Periode", type: "EXPENSE" },
  { code: "6050", name: "Beban Sewa Periode", type: "EXPENSE" },
  { code: "6060", name: "Beban Operasional Lain", type: "EXPENSE" },
  { code: "6070", name: "Kerugian Stok Abnormal", type: "EXPENSE" },
]);

const BY_CODE = new Map(ACCOUNT_CATALOG.map(a => [a.code, a]));
const CASH_CATEGORIES = new Set(["OPERATING", "INVESTING", "FINANCING"]);
const money = cents => cents / 100;
const add = values => values.reduce((sum, value) => {
  const result = sum + value;
  if (!Number.isSafeInteger(result)) throw new Error("Jumlah melebihi batas presisi.");
  return result;
}, 0);

export function toJournalCents(input, label = "Nilai") {
  let value = input;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) throw new Error(label + " tidak valid.");
    value = value.toFixed(2);
    if (Math.abs(Number(value) - input) > 0.000001) {
      throw new Error(label + " memiliki lebih dari dua angka desimal.");
    }
  }
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(value)) {
    throw new Error(label + ": wajib angka Rupiah, tanpa pemisah ribuan.");
  }
  const parts = value.split(".");
  const whole = Number(parts[0]);
  const fraction = Number((parts[1] || "").padEnd(2, "0"));
  const cents = whole * 100 + fraction;
  if (!Number.isSafeInteger(cents)) throw new Error(label + " terlalu besar.");
  return cents;
}

function normalizeJournal(row, cutoverDate) {
  if (!row || row.status !== "POSTED" || !row.id ||
      !row.operationKey || !isValidIsoDate(row.date) || row.date < cutoverDate) {
    throw new Error("Jurnal belum POSTED, tanggal salah, atau referensi kosong.");
  }
  const kind = row.sourceType;
  if (!["OPENING", "NORMAL", "REVERSAL"].includes(kind) ||
      !Array.isArray(row.lines) || row.lines.length < 2) {
    throw new Error("Jenis jurnal atau jumlah baris tidak valid.");
  }
  if (kind === "OPENING" && row.date !== cutoverDate) {
    throw new Error("Jurnal pembukaan harus bertanggal cutover.");
  }
  const lines = row.lines.map(line => {
    const account = BY_CODE.get(String(line.accountCode));
    if (!account) throw new Error("Akun jurnal tidak dikenali: " + line.accountCode);
    const debit = toJournalCents(line.debit ?? "0", "Debit");
    const credit = toJournalCents(line.credit ?? "0", "Kredit");
    if (Boolean(debit) === Boolean(credit)) {
      throw new Error("Setiap baris harus satu sisi debit atau kredit positif.");
    }
    if (kind === "OPENING" && ["REVENUE", "CONTRA_REVENUE", "COGS", "EXPENSE"].includes(account.type)) {
      throw new Error("Saldo awal tidak boleh memuat pendapatan atau beban periode.");
    }
    return { account, debit, credit };
  });
  const dr = add(lines.map(x => x.debit));
  const cr = add(lines.map(x => x.credit));
  if (dr !== cr) throw new Error("Jurnal debit dan kredit tidak seimbang.");

  const cashLines = lines.filter(line => line.account.cash);
  const cashDebit = add(cashLines.map(line => line.debit));
  const cashCredit = add(cashLines.map(line => line.credit));
  const cashDelta = cashDebit - cashCredit;
  const category = row.cashFlowCategory ?? null;
  if (kind === "OPENING") {
    if (category !== null) throw new Error("Saldo awal bukan arus kas berjalan.");
  } else if (cashLines.length === 0) {
    if (category !== null) throw new Error("Jurnal nonkas tidak boleh diberi arus kas.");
  } else if (cashDelta !== 0) {
    if (!CASH_CATEGORIES.has(category) || (cashDebit && cashCredit)) {
      throw new Error("Arus kas harus diklasifikasikan dan tidak mencampur beberapa pembayaran.");
    }
  } else {
    const onlyCash = lines.every(line => line.account.cash);
    if (!onlyCash || category !== "TRANSFER" || !cashDebit || !cashCredit) {
      throw new Error("Mutasi kas/bank bersaldo nol hanya boleh transfer internal murni.");
    }
  }

  return {
    id: String(row.id), operationKey: String(row.operationKey),
    date: row.date, sourceType: kind, cashFlowCategory: category,
    lines, cashDelta,
  };
}

function previousMonth(month) {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? String(y - 1) + "-12" : String(y) + "-" + String(m - 1).padStart(2, "0");
}

/**
 * Requires 1 posted opening plus a complete ledger through the end of month.
 * The caller (future backend) must guarantee that this ledger is not paginated,
 * that there are no missing journals and that cutover has been Owner-approved.
 */
export function buildPostedFinancialReports({ cutoverDate, month, journals }) {
  if (!isValidIsoDate(cutoverDate) ||
    typeof month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ||
    !Array.isArray(journals) || month < cutoverDate.slice(0, 7)) {
    throw new Error("Periode laporan atau daftar jurnal tidak valid.");
  }
  const end = month + "-31"; // ISO date strings; upper bound for all calendar days.
  const start = month + "-01";
  const normalized = journals.map(j => normalizeJournal(j, cutoverDate));
  const byId = new Set();
  const byOperation = new Set();
  let openings = 0;
  for (const journal of normalized) {
    if (byId.has(journal.id) || byOperation.has(journal.operationKey)) {
      throw new Error("Jurnal duplikat: id atau operation key terulang.");
    }
    byId.add(journal.id);
    byOperation.add(journal.operationKey);
    if (journal.sourceType === "OPENING") openings++;
  }
  if (openings !== 1) {
    throw new Error("Harus ada tepat satu jurnal saldo awal yang disahkan.");
  }

  const included = normalized.filter(j => j.date <= end);
  const period = included.filter(j => j.sourceType !== "OPENING" && j.date >= start);
  const opening = included.find(j => j.sourceType === "OPENING");
  if (!opening) throw new Error("Saldo awal belum masuk periode laporan.");

  const accountBalanceCents = new Map(ACCOUNT_CATALOG.map(a => [a.code, 0]));
  const periodCents = new Map(ACCOUNT_CATALOG.map(a => [a.code, 0]));
  const cashFlowsCents = { OPERATING: 0, INVESTING: 0, FINANCING: 0 };

  for (const j of included) {
    for (const line of j.lines) {
      const code = line.account.code;
      accountBalanceCents.set(code, add([accountBalanceCents.get(code), line.debit - line.credit]));
      if (j.date >= start && j.sourceType !== "OPENING") {
        periodCents.set(code, add([periodCents.get(code), line.debit - line.credit]));
      }
    }
    if (j.date >= start && j.sourceType !== "OPENING" && CASH_CATEGORIES.has(j.cashFlowCategory)) {
      cashFlowsCents[j.cashFlowCategory] = add([
        cashFlowsCents[j.cashFlowCategory], j.cashDelta,
      ]);
    }
  }
  const assetCodes = ACCOUNT_CATALOG.filter(a => a.type === "ASSET");
  const liabilityCodes = ACCOUNT_CATALOG.filter(a => a.type === "LIABILITY");
  const equityCodes = ACCOUNT_CATALOG.filter(a => a.type === "EQUITY");
  const contraEquityCodes = ACCOUNT_CATALOG.filter(a => a.type === "CONTRA_EQUITY");
  const naturalBalance = (code, type, balances) =>
    ["ASSET", "CONTRA_EQUITY", "COGS", "EXPENSE", "CONTRA_REVENUE"].includes(type)
      ? balances.get(code) : -balances.get(code);

  const assetsCents = add(assetCodes.map(a => naturalBalance(a.code, a.type, accountBalanceCents)));
  const liabilitiesCents = add(liabilityCodes.map(a => naturalBalance(a.code, a.type, accountBalanceCents)));
  const baseEquityCents = add(equityCodes.map(a => naturalBalance(a.code, a.type, accountBalanceCents))) -
    add(contraEquityCodes.map(a => naturalBalance(a.code, a.type, accountBalanceCents)));

  const getCategory = (types, balances) => add(
    ACCOUNT_CATALOG.filter(a => types.includes(a.type)).map(a =>
      naturalBalance(a.code, a.type, balances)),
  );
  const cumulativeRevenueCents = getCategory(["REVENUE"], accountBalanceCents) -
    getCategory(["CONTRA_REVENUE"], accountBalanceCents);
  const cumulativeCostsCents = getCategory(["COGS", "EXPENSE"], accountBalanceCents);
  const retainedCurrentProfitCents = cumulativeRevenueCents - cumulativeCostsCents;

  const revenueCents = getCategory(["REVENUE"], periodCents) -
    getCategory(["CONTRA_REVENUE"], periodCents);
  const cogsCents = getCategory(["COGS"], periodCents);
  const expenseCents = getCategory(["EXPENSE"], periodCents);
  const grossProfitCents = revenueCents - cogsCents;
  const netProfitCents = grossProfitCents - expenseCents;
  const totalEquityCents = baseEquityCents + retainedCurrentProfitCents;
  const balanced = assetsCents === liabilitiesCents + totalEquityCents;
  if (!balanced) throw new Error("Posisi keuangan tidak seimbang setelah jurnal.");

  const cashAccountBalance = (code, records) => add(records.flatMap(j => j.lines
    .filter(line => line.account.code === code)
    .map(line => line.debit - line.credit)));
  const cashOpeningCents = add(["1010", "1020"].map(code => cashAccountBalance(code, [opening])));
  const priorMovementCents = add(normalized
    .filter(j => j.sourceType !== "OPENING" && j.date < start)
    .map(j => j.cashDelta));
  const cashStartCents = cashOpeningCents + priorMovementCents;
  const cashOperatingCents = cashFlowsCents.OPERATING;
  const cashInvestingCents = cashFlowsCents.INVESTING;
  const cashFinancingCents = cashFlowsCents.FINANCING;
  const netChangeCents = cashOperatingCents + cashInvestingCents + cashFinancingCents;
  const cashClosingCents = add(["1010", "1020"].map(code =>
    accountBalanceCents.get(code)));
  if (cashStartCents + netChangeCents !== cashClosingCents) {
    throw new Error("Rekonsiliasi kas dan arus kas tidak sesuai.");
  }

  return {
    month, cutoverDate, journalCount: included.length, periodJournalCount: period.length,
    incomeStatement: {
      revenue: money(revenueCents),
      cogs: money(cogsCents),
      grossProfit: money(grossProfitCents),
      operatingExpenses: money(expenseCents),
      netProfit: money(netProfitCents),
      grossMarginPercent: revenueCents > 0 ? grossProfitCents / revenueCents * 100 : null,
      netMarginPercent: revenueCents > 0 ? netProfitCents / revenueCents * 100 : null,
    },
    cashFlow: {
      operating: money(cashOperatingCents),
      investing: money(cashInvestingCents),
      financing: money(cashFinancingCents),
      netChange: money(netChangeCents),
      openingCash: money(cashStartCents),
      closingCash: money(cashClosingCents),
      reconciles: true,
    },
    financialPosition: {
      assets: money(assetsCents),
      liabilities: money(liabilitiesCents),
      equityBeforeCurrentEarnings: money(baseEquityCents),
      cumulativeProfitSinceCutover: money(retainedCurrentProfitCents),
      totalEquity: money(totalEquityCents),
      balanced: true,
    },
    dataQuality: {
      source: "POSTED_ACCOUNTING_JOURNALS_ONLY",
      historicalCashbookUsed: false,
      accountingProofReviewed: false,
      allPostingSourcesComplete: false,
      // Mathematical reconciliation is not the same as an external audit.
    },
    noAutomaticBonusRecommendation: true,
  };
}

/**
 * Growth is meaningful only for adjacent full months after cutover.
 * Null means "not comparable", not 0% growth.
 */
export function comparePostedMonthlyPerformance(previous, current) {
  if (!previous || !current ||
    previous.cutoverDate !== current.cutoverDate ||
    previous.month !== previousMonth(current.month) ||
    previous.month + "-01" < previous.cutoverDate) {
    return {
      comparable: false, revenueGrowthPercent: null, profitGrowthPercent: null,
    };
  }
  const change = (prior, value) => prior > 0 ? (value - prior) / prior * 100 : null;
  return {
    comparable: true,
    revenueGrowthPercent: change(previous.incomeStatement.revenue, current.incomeStatement.revenue),
    profitGrowthPercent: change(previous.incomeStatement.netProfit, current.incomeStatement.netProfit),
    currentNetMarginPercent: current.incomeStatement.netMarginPercent,
  };
}
