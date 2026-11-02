/**
 * Owner-only planning preview of the opening balance journal.
 *
 * No Supabase client, mutations, posting or legacy backfill.
 * Accounting amounts use integer cents for reconciliation, while formatted
 * Rupiah totals are only a presentation. A balanced journal does not certify
 * the physical counts, valuation documents or ownership.
 */
import { OPENING_FINANCIAL_FIELDS, isValidIsoDate } from "./hppCutoverOpening.js";

export const OPENING_ACCOUNTS = Object.freeze([
  { code: "1010", name: "Kas Tunai", side: "DEBIT", source: "cash" },
  { code: "1020", name: "Bank", side: "DEBIT", source: "bank" },
  { code: "1120", name: "Piutang Usaha", side: "DEBIT", source: "receivables" },
  { code: "1210", name: "Persediaan Bahan Baku", side: "DEBIT", source: "rawInventory" },
  { code: "1215", name: "Produksi Dalam Proses (WIP)", side: "DEBIT", source: "workInProgress" },
  { code: "1220", name: "Persediaan Produk Jadi", side: "DEBIT", source: "finishedGoods" },
  { code: "1230", name: "Persediaan Produk Frozen", side: "DEBIT", source: "frozenGoods" },
  { code: "1240", name: "Produk Titipan di Kafe Belum Terjual", side: "DEBIT", source: "consignmentGoods" },
  { code: "1590", name: "Aset Usaha Lain", side: "DEBIT", source: "otherAssets" },
  { code: "2010", name: "Utang Usaha", side: "CREDIT", source: "payables" },
  { code: "2090", name: "Kewajiban Usaha Lain", side: "CREDIT", source: "otherLiabilities" },
]);
export const OPENING_EQUITY = Object.freeze({
  code: "3000", name: "Ekuitas Awal Penyeimbang — Perlu Verifikasi Modal",
});

function toCents(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(label + ": nilai harus angka nonnegatif yang terverifikasi.");
  }
  const cents = Math.round(value * 100);
  if (!Number.isSafeInteger(cents) || Math.abs(cents / 100 - value) > 0.005001) {
    throw new Error(label + ": nilai di luar batas presisi Rupiah.");
  }
  return cents;
}

function totalsOf(lines) {
  return lines.reduce((totals, line) => {
    totals.debitCents += line.debitCents;
    totals.creditCents += line.creditCents;
    return totals;
  }, { debitCents: 0, creditCents: 0 });
}

/**
 * Input: evaluateCutoverDraft(..) result. Requires completed physical inputs
 * and monetary sources, not necessarily a bookkeeping match to the bad old data.
 * It still cannot create a real accounting journal.
 */
export function buildOpeningJournalPreview(draft) {
  if (!draft || !isValidIsoDate(draft.cutoverDate) ||
    !Array.isArray(draft.inventory) || !draft.balance ||
    !Array.isArray(draft.issues) || draft.issues.length > 0 ||
    !draft.financial || draft.canActivate !== false ||
    draft.writesDatabase !== false) {
    throw new Error("Draft saldo awal belum lengkap untuk ditampilkan sebagai jurnal.");
  }
  const allowedAccounts = new Set(OPENING_FINANCIAL_FIELDS.map(x => x.key));
  for (const field of OPENING_FINANCIAL_FIELDS) {
    if (!allowedAccounts.has(field.key) ||
      draft.financial[field.key] === null ||
      draft.financial[field.key] === undefined) {
      throw new Error("Semua saldo akun wajib diperiksa, termasuk saldo nol.");
    }
  }
  if (!draft.inventory.length) {
    throw new Error("Belum ada rincian stok bahan baku untuk diverifikasi.");
  }

  const seen = new Set();
  let rawInventoryCents = 0;
  for (const item of draft.inventory) {
    if (item.ingredientId == null || seen.has(String(item.ingredientId))) {
      throw new Error("Ada bahan baku duplikat atau tanpa identitas.");
    }
    seen.add(String(item.ingredientId));
    if (item.physicalQty === null || !Number.isFinite(item.physicalQty) ||
      item.physicalQty < 0 || item.stockValue === null ||
      item.stockValue === undefined || !Number.isFinite(item.stockValue)) {
      throw new Error("Jumlah stok fisik atau nilai barang belum sah.");
    }
    if (item.physicalQty > 0 && (!item.costSource || item.unitCost == null)) {
      throw new Error("Dasar valuasi bahan baku belum dilengkapi.");
    }
    rawInventoryCents += toCents(item.stockValue, "Nilai " + (item.nama || "bahan"));
    if (!Number.isSafeInteger(rawInventoryCents)) {
      throw new Error("Akumulasi persediaan terlalu besar.");
    }
  }

  const values = { ...draft.financial, rawInventory: rawInventoryCents / 100 };
  const lines = [];
  for (const account of OPENING_ACCOUNTS) {
    const cents = account.source === "rawInventory"
      ? rawInventoryCents
      : toCents(values[account.source], account.name);
    if (!cents) continue;
    lines.push({
      accountCode: account.code,
      accountName: account.name,
      debitCents: account.side === "DEBIT" ? cents : 0,
      creditCents: account.side === "CREDIT" ? cents : 0,
      origin: "OWNER_VERIFIED_OPENING_DRAFT",
    });
  }
  const beforeEquity = totalsOf(lines);
  const equitySignedCents = beforeEquity.debitCents - beforeEquity.creditCents;
  if (equitySignedCents !== 0) {
    lines.push({
      accountCode: OPENING_EQUITY.code,
      accountName: OPENING_EQUITY.name,
      debitCents: equitySignedCents < 0 ? -equitySignedCents : 0,
      creditCents: equitySignedCents > 0 ? equitySignedCents : 0,
      origin: "OPENING_EQUITY_BALANCING_PREVIEW_NOT_CAPITAL_CONTRIBUTION",
    });
  }
  const totals = totalsOf(lines);
  if (!Number.isSafeInteger(totals.debitCents) ||
    !Number.isSafeInteger(totals.creditCents) ||
    totals.debitCents !== totals.creditCents) {
    throw new Error("Jurnal saldo awal tidak seimbang; proses dihentikan.");
  }
  return {
    type: "OPENING_BALANCE_PREVIEW",
    cutoverDate: draft.cutoverDate,
    lines: lines.map(line => ({
      ...line,
      debit: line.debitCents / 100,
      credit: line.creditCents / 100,
    })),
    totals: {
      debit: totals.debitCents / 100,
      credit: totals.creditCents / 100,
      balanced: true,
    },
    equity: {
      accountCode: OPENING_EQUITY.code,
      signedAmount: equitySignedCents / 100,
      description: "Selisih aset dikurangi liabilitas, bukan otomatis modal disetor atau laba.",
    },
    notices: [
      "Saldo ini hanya simulasi berdasarkan hasil opname dan nilai yang diinput.",
      "Jurnal seimbang secara matematika tidak berarti dokumen telah diverifikasi.",
      "Kas, bank, stok titipan, WIP, dan aset perlu pemeriksaan bukti dan batas kepemilikan.",
      "Tidak ada pencatatan jurnal, perubahan stok, atau perubahan laporan lama.",
    ],
    approved: false,
    readyToPost: false,
    writesDatabase: false,
  };
}

/** Balance sheet preview derived from double-entry opening lines only. */
export function buildOpeningFinancialPosition(journal) {
  if (!journal?.totals?.balanced || journal.type !== "OPENING_BALANCE_PREVIEW" ||
    !Array.isArray(journal.lines) || journal.writesDatabase !== false) {
    throw new Error("Jurnal preview tidak valid.");
  }
  const byAccount = new Map(journal.lines.map(line => [line.accountCode, line]));
  const read = (code, naturalSide) => {
    const line = byAccount.get(code);
    if (!line) return 0;
    if (!Number.isFinite(line.debit) || !Number.isFinite(line.credit)) {
      throw new Error("Ada nilai jurnal bukan angka.");
    }
    return naturalSide === "DEBIT" ? line.debit - line.credit : line.credit - line.debit;
  };
  const assets = OPENING_ACCOUNTS.filter(a => a.side === "DEBIT")
    .map(a => ({ code: a.code, name: a.name, amount: read(a.code, a.side) }));
  const liabilities = OPENING_ACCOUNTS.filter(a => a.side === "CREDIT")
    .map(a => ({ code: a.code, name: a.name, amount: read(a.code, a.side) }));
  const equity = read(OPENING_EQUITY.code, "CREDIT");
  const assetTotal = assets.reduce((n, a) => n + a.amount, 0);
  const liabilityTotal = liabilities.reduce((n, a) => n + a.amount, 0);
  const balances = Math.abs(assetTotal - liabilityTotal - equity) < 0.009;
  if (!balances) throw new Error("Posisi keuangan tidak seimbang.");
  return {
    cutoverDate: journal.cutoverDate,
    assets, liabilities, equity,
    totals: { assets: assetTotal, liabilities: liabilityTotal, equity },
    balances,
    provisional: true,
    incomeStatementAvailable: false,
    cashFlowStatementAvailable: false,
    // No fake P&L, no cash flow generated from a balance sheet.
  };
}
