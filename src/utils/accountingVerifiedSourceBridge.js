/**
 * Bunbun OS — verification bridge between existing source rows and accounting.
 *
 * STRICTLY READ-ONLY: source rows are immutable inputs; output contains DRAFT
 * proposals only. The bridge cannot create HPP, post journal entries, or
 * certify bonus/expansion readiness.
 *
 * Source tables are cross-checked by their real IDs (sales, incomes,
 * purchases, expenses); never use simple monthly cashbook arithmetic.
 * A trusted staging backend must independently re-fetch the source IDs,
 * confirm documentary evidence, approve cutover and check stock costs.
 */
import { isValidIsoDate } from "./hppCutoverOpening.js";
import { toJournalCents } from "./accountingPostedReports.js";
import { proposeAccountingEvent } from "./accountingEventProposals.js";

const SOURCE_RULES = Object.freeze({
  sales: { date: "sale_date", amount: "total_amount" },
  incomes: { date: "tanggal", amount: "pemasukan_bunbun" },
  purchases: { date: "tanggal", amount: "total" },
  expenses: { date: "tanggal", amount: "nominal" },
});
const YES = true;

function cents(value, label) {
  const amount = toJournalCents(value, label);
  if (amount <= 0) throw new Error(label + " harus positif dan diverifikasi.");
  return amount;
}
function money(value) {
  const whole = Math.floor(value / 100);
  return String(whole) + "." + String(value % 100).padStart(2, "0");
}
function id(value, label) {
  if ((typeof value !== "number" && typeof value !== "string") ||
    !/^[1-9]\d{0,15}$/.test(String(value))) {
    throw new Error("ID " + label + " tidak valid.");
  }
  return String(value);
}
function reference(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9:/_. -]{5,159}$/.test(value);
}
function verifiedProof(proof, label) {
  if (!proof || proof.reviewed !== YES || !reference(proof.evidenceRef)) {
    throw new Error(label + " memerlukan bukti dan verifikasi Owner.");
  }
}
function buildSourceMap(rows, table, cutoverDate) {
  if (!Array.isArray(rows)) throw new Error("Sumber " + table + " belum dimuat seluruhnya.");
  const rule = SOURCE_RULES[table];
  const map = new Map();
  for (const row of rows) {
    const key = id(row?.id, table);
    if (map.has(key)) throw new Error("Data duplikat pada sumber " + table + ".");
    if (row.is_deleted === true || !isValidIsoDate(row[rule.date])) {
      throw new Error("Sumber " + table + " terhapus atau tidak memiliki tanggal valid.");
    }
    if (row[rule.date] < cutoverDate) {
      throw new Error("Ada sumber " + table + " sebelum tanggal cutover.");
    }
    // Historical receipts with missing values MUST NOT silently become zero.
    cents(row[rule.amount], table + " #" + key);
    map.set(key, row);
  }
  return map;
}
function checkedEvidenceIds(items, label, field) {
  if (!Array.isArray(items)) throw new Error("Daftar verifikasi " + label + " belum lengkap.");
  const seen = new Set();
  for (const item of items) {
    const key = id(item?.[field], label);
    if (seen.has(key)) throw new Error("Bukti " + label + " duplikat untuk ID " + key + ".");
    seen.add(key);
  }
}
function sourceById(map, value, type) {
  const key = id(value, type);
  const row = map.get(key);
  if (!row) throw new Error("ID " + type + " #" + key + " tidak ada dalam sumber lengkap.");
  return row;
}
function issue(code, source, message) {
  return { code, source, message };
}
function proposed(event) {
  const proposal = proposeAccountingEvent(event);
  return { ...proposal, readyToPost: false, writesDatabase: false };
}

/**
 * Supported provisional records:
 *  - Sales: requires Owner-document verification of Bunbun's NET entitlement
 *  - Deposits: sum of explicit allocations must equal original income row
 *  - Purchases: only verified INGREDIENT invoices can become raw stock drafts
 *  - Purchase-linked expense: allocation to same invoice, never period expense
 *
 * Forbidden: direct historical COGS or payroll mapping, automatic 70% division,
 * CAFE_OUT as sold, writing to Supabase, inferring cash/bank balances.
 */
export function buildVerifiedAccountingSourceBridge({
  cutoverDate,
  sources,
  evidence,
}) {
  if (!isValidIsoDate(cutoverDate) ||
    !sources || !evidence || typeof evidence !== "object") {
    throw new Error("Cutover dan sumber/verifikasi harus tersedia.");
  }
  const maps = Object.fromEntries(
    Object.keys(SOURCE_RULES).map(key =>
      [key, buildSourceMap(sources[key], key, cutoverDate)]),
  );
  const salesProofs = evidence.sales || [];
  const depositProofs = evidence.deposits || [];
  const purchaseProofs = evidence.purchases || [];
  const paymentProofs = evidence.purchasePayments || [];
  checkedEvidenceIds(salesProofs, "sales", "saleId");
  checkedEvidenceIds(depositProofs, "deposit", "incomeId");
  checkedEvidenceIds(purchaseProofs, "purchase", "purchaseId");
  checkedEvidenceIds(paymentProofs, "pembayaran", "expenseId");

  const proposals = [];
  const blockers = [];
  const approvedSales = new Map();
  const receivablePayments = new Map();
  const approvedPurchases = new Map();
  const payablePayments = new Map();

  for (const proof of salesProofs) {
    const key = id(proof.saleId, "sales");
    const row = sourceById(maps.sales, proof.saleId, "sales");
    verifiedProof(proof, "Penjualan #" + key);
    if (proof.recordedBasis !== "NET_BUNBUN" && proof.recordedBasis !== "GROSS_CAFE") {
      throw new Error("Dasar penjualan belum jelas: NET_BUNBUN atau GROSS_CAFE.");
    }
    if (proof.soldVerified !== true) {
      blockers.push(issue("NOT_CONFIRMED_SOLD", "sales:" + key,
        "Produk baru dikirim atau belum terbukti terjual; pendapatan ditahan."));
      continue;
    }
    const net = cents(proof.netEntitlement, "Hak Bunbun #" + key);
    const recorded = cents(row.total_amount, "Sales #" + key);
    if ((proof.recordedBasis === "NET_BUNBUN" && net !== recorded) ||
      (proof.recordedBasis === "GROSS_CAFE" && net > recorded)) {
      throw new Error("Nominal hak Bunbun tidak cocok dengan dasar pencatatan sales #" + key + ".");
    }
    approvedSales.set(key, net);
    proposals.push(proposed({
      reviewed: true,
      date: row.sale_date,
      sourceKey: "verified-sale:" + key,
      evidence: proof.evidenceRef,
      amount: money(net),
      type: "RECOGNIZE_BUNBUN_SALE",
      revenueBasis: "CONFIRMED_BUNBUN_ENTITLEMENT",
    }));
    blockers.push(issue("SOLD_COGS_REQUIRES_VALUATION", "sales:" + key,
      "HPP unit produk terjual harus ditelusuri melalui valuasi finished/frozen/titipan dan stok sebelum posting."));
  }
  for (const row of maps.sales.values()) {
    if (!salesProofs.some(item => String(item.saleId) === String(row.id))) {
      blockers.push(issue("SALE_NOT_RECONCILED", "sales:" + row.id,
        "Belum ada bukti produk benar-benar terjual dan hak pendapatan Bunbun."));
    }
  }

  for (const proof of depositProofs) {
    const key = id(proof.incomeId, "setoran");
    const row = sourceById(maps.incomes, proof.incomeId, "setoran");
    verifiedProof(proof, "Setoran #" + key);
    if (!Array.isArray(proof.allocations) || proof.allocations.length === 0) {
      throw new Error("Setoran #" + key + " tidak punya rincian piutang yang dilunasi.");
    }
    let allocated = 0;
    const perDeposit = new Set();
    for (const allocation of proof.allocations) {
      const saleId = id(allocation.saleId, "piutang sales");
      if (perDeposit.has(saleId)) throw new Error("Piutang yang sama dialokasikan dua kali dalam setoran.");
      perDeposit.add(saleId);
      if (!approvedSales.has(saleId)) {
        throw new Error("Setoran harus ditautkan ke penjualan hak Bunbun yang terverifikasi.");
      }
      const moneyValue = cents(allocation.amount, "Alokasi setoran");
      allocated += moneyValue;
      const newTotal = (receivablePayments.get(saleId) || 0) + moneyValue;
      if (!Number.isSafeInteger(newTotal) || newTotal > approvedSales.get(saleId)) {
        throw new Error("Setoran melampaui piutang hak Bunbun yang benar-benar terverifikasi.");
      }
      receivablePayments.set(saleId, newTotal);
    }
    if (allocated !== cents(row.pemasukan_bunbun, "Nilai setoran #" + key)) {
      throw new Error("Alokasi harus sama dengan setoran OS yang sesungguhnya.");
    }
    if (!["1010", "1020"].includes(proof.cashAccount)) {
      throw new Error("Tujuan setoran kas/bank wajib diverifikasi.");
    }
    // One receipt document with multiple invoice allocations creates ONE
    // settlement proposal, since the source cash transaction happened once.
    proposals.push(proposed({
      reviewed: true, date: row.tanggal,
      sourceKey: "verified-deposit:" + key,
      evidence: proof.evidenceRef,
      amount: money(allocated),
      type: "RECEIVE_CAFE_SETTLEMENT",
      cashAccount: proof.cashAccount,
      receivableReference: proof.allocations
        .map(x => "sales:" + id(x.saleId, "sales")).join(","),
    }));
  }
  for (const row of maps.incomes.values()) {
    if (!depositProofs.some(item => String(item.incomeId) === String(row.id))) {
      blockers.push(issue("UNMATCHED_DEPOSIT", "incomes:" + row.id,
        "Setoran belum cocok ke piutang; jangan menjadi pendapatan baru."));
    }
  }

  for (const proof of purchaseProofs) {
    const key = id(proof.purchaseId, "pembelian");
    const row = sourceById(maps.purchases, proof.purchaseId, "pembelian");
    verifiedProof(proof, "Pembelian #" + key);
    if (row.ingredient_id == null || row.maintenance_item_id != null ||
      proof.kind !== "INGREDIENT") {
      blockers.push(issue("PURCHASE_CLASSIFICATION_REQUIRED", "purchases:" + key,
        "Hanya pembelian bahan baku yang jelas dapat diajukan sebagai persediaan."));
      continue;
    }
    const total = cents(row.total, "Pembelian #" + key);
    approvedPurchases.set(key, total);
    proposals.push(proposed({
      reviewed: true, date: row.tanggal,
      sourceKey: "verified-purchase:" + key,
      evidence: proof.evidenceRef,
      type: "PURCHASE_RAW_MATERIAL",
      amount: money(total),
    }));
  }
  for (const row of maps.purchases.values()) {
    if (!purchaseProofs.some(item => String(item.purchaseId) === String(row.id))) {
      blockers.push(issue("PURCHASE_NOT_CLASSIFIED", "purchases:" + row.id,
        "Pembelian memerlukan klasifikasi bahan, maintenance, atau aset."));
    }
  }

  for (const proof of paymentProofs) {
    const key = id(proof.expenseId, "pembayaran");
    const row = sourceById(maps.expenses, proof.expenseId, "pengeluaran");
    verifiedProof(proof, "Pembayaran #" + key);
    const invoiceId = id(proof.purchaseId, "pembelian");
    if (row.purchase_id == null || String(row.purchase_id) !== invoiceId ||
      !approvedPurchases.has(invoiceId)) {
      throw new Error("Pembayaran harus cocok dengan purchase_id pembelian bahan terverifikasi.");
    }
    if (!["1010", "1020"].includes(proof.cashAccount)) {
      throw new Error("Sumber kas/bank pembelian wajib diverifikasi.");
    }
    const paid = cents(row.nominal, "Nominal pembayaran #" + key);
    const amount = (payablePayments.get(invoiceId) || 0) + paid;
    if (!Number.isSafeInteger(amount) || amount > approvedPurchases.get(invoiceId)) {
      throw new Error("Pembayaran melebihi utang pembelian yang tercatat.");
    }
    payablePayments.set(invoiceId, amount);
    proposals.push(proposed({
      reviewed: true, date: row.tanggal,
      sourceKey: "verified-purchase-payment:" + key,
      evidence: proof.evidenceRef,
      type: "PAY_PURCHASE_PAYABLE",
      amount: money(paid),
      cashAccount: proof.cashAccount,
    }));
  }
  for (const row of maps.expenses.values()) {
    if (!paymentProofs.some(item => String(item.expenseId) === String(row.id))) {
      blockers.push(issue(
        row.purchase_id != null ? "PURCHASE_PAYMENT_NOT_RECONCILED" : "EXPENSE_CLASSIFICATION_REQUIRED",
        "expenses:" + row.id,
        row.purchase_id != null
          ? "Pengeluaran terkait Purchasing belum direkonsiliasi dengan faktur/utang."
          : "Pengeluaran belum diklasifikasikan sebagai biaya periode/produksi/aset.",
      ));
    }
  }

  // Stock costing is an intentionally independent controlled process.
  // Neither CAFE_OUT nor PRODUCTION_OUT is enough to infer sold COGS.
  blockers.push(issue("STOCK_VALUATION_NOT_CONNECTED", "inventory",
    "Stok bahan, WIP, finished, frozen, titipan kafe dan harga perolehan belum direkonsiliasi."));
  blockers.push(issue("OPENING_AND_POSTING_NOT_APPROVED", "cutover",
    "Saldo awal dan kelengkapan sumber harus disahkan oleh Owner melalui backend terpercaya."));

  return {
    cutoverDate,
    sourceMode: "VERIFIED_SOURCE_PROPOSALS_ONLY",
    sourceCounts: Object.fromEntries(Object.entries(maps)
      .map(([key, value]) => [key, value.size])),
    proposals,
    receivablesBySale: [...approvedSales].map(([key, initial]) => ({
      saleId: key, entitlement: money(initial),
      allocatedDeposits: money(receivablePayments.get(key) || 0),
      outstanding: money(initial - (receivablePayments.get(key) || 0)),
    })),
    payableByPurchase: [...approvedPurchases].map(([key, initial]) => ({
      purchaseId: key, invoice: money(initial),
      paid: money(payablePayments.get(key) || 0),
      remaining: money(initial - (payablePayments.get(key) || 0)),
    })),
    blockers,
    complete: false,
    approved: false,
    readyToPost: false,
    actualProfitAvailable: false,
    writesDatabase: false,
  };
}
