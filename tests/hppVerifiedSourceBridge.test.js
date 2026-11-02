import { test } from "node:test";
import assert from "node:assert/strict";
import { buildVerifiedAccountingSourceBridge } from "../src/utils/accountingVerifiedSourceBridge.js";

const CUTOVER = "2026-11-01";
const sale = (id, amount = "100000.00") => ({
  id, sale_date: "2026-11-05", sales_channel: "PUBLIC_HUB",
  total_amount: amount, is_deleted: false,
});
const deposit = (id, amount = "60000.00") => ({
  id, tanggal: "2026-11-10", asal_setoran: "PUBLIC_HUB",
  pemasukan_bunbun: amount, is_deleted: false,
});
const purchase = (id, amount = "30000.00") => ({
  id, tanggal: "2026-11-02", total: amount,
  ingredient_id: 5, maintenance_item_id: null, is_deleted: false,
});
const expense = (id, purchaseId, amount = "20000.00") => ({
  id, tanggal: "2026-11-03", nominal: amount,
  purchase_id: purchaseId, is_deleted: false,
});

function fixture() {
  return {
    cutoverDate: CUTOVER,
    sources: {
      sales: [sale(1), sale(2, "120000.00")],
      incomes: [deposit(31), deposit(32, "30000.00")],
      purchases: [purchase(41)],
      expenses: [expense(51, 41)],
    },
    evidence: {
      sales: [
        {
          saleId: 1, reviewed: true, soldVerified: true,
          recordedBasis: "GROSS_CAFE",
          netEntitlement: "70000.00",
          evidenceRef: "CAFE-SETTLEMENT-REPORT-20261105",
        },
        {
          saleId: 2, reviewed: true, soldVerified: true,
          recordedBasis: "NET_BUNBUN",
          netEntitlement: "120000.00",
          evidenceRef: "CAFE-SETTLEMENT-REPORT-20261106",
        },
      ],
      deposits: [
        {
          incomeId: 31, reviewed: true,
          cashAccount: "1020",
          evidenceRef: "BANK-STATEMENT-20261110-1",
          allocations: [{ saleId: 1, amount: "60000.00" }],
        },
        {
          incomeId: 32, reviewed: true,
          cashAccount: "1020",
          evidenceRef: "BANK-STATEMENT-20261110-2",
          allocations: [{ saleId: 1, amount: "10000.00" },
            { saleId: 2, amount: "20000.00" }],
        },
      ],
      purchases: [
        {
          purchaseId: 41, reviewed: true, kind: "INGREDIENT",
          evidenceRef: "INVOICE-MATERIAL-20261102",
        },
      ],
      purchasePayments: [
        {
          expenseId: 51, purchaseId: 41, reviewed: true,
          cashAccount: "1020", evidenceRef: "BANK-RECEIPT-20261103",
        },
      ],
    },
  };
}
const build = overrides => buildVerifiedAccountingSourceBridge({
  ...fixture(), ...overrides,
});

test("verified posted source IDs generate only DRAFT proposals and no DB writes", () => {
  const result = build();
  assert.equal(result.proposals.length, 6);
  assert.deepEqual(result.proposals.map(x => x.sourceKey), [
    "verified-sale:1", "verified-sale:2", "verified-deposit:31",
    "verified-deposit:32", "verified-purchase:41",
    "verified-purchase-payment:51",
  ]);
  assert.ok(result.proposals.every(p => p.status === "DRAFT" &&
    p.readyToPost === false && p.writesDatabase === false &&
    p.approved === false));
  assert.equal(result.readyToPost, false);
  assert.equal(result.actualProfitAvailable, false);
  assert.equal(result.complete, false);
  assert.equal(result.sourceMode, "VERIFIED_SOURCE_PROPOSALS_ONLY");
});

test("sales keep verified NET Bunbun amounts without auto 70:30 deductions", () => {
  const result = build();
  assert.deepEqual(result.proposals[0].lines, [
    { accountCode: "1120", debit: "70000.00", credit: "0.00" },
    { accountCode: "4010", debit: "0.00", credit: "70000.00" },
  ]);
  assert.deepEqual(result.proposals[1].lines, [
    { accountCode: "1120", debit: "120000.00", credit: "0.00" },
    { accountCode: "4010", debit: "0.00", credit: "120000.00" },
  ]);
  assert.equal(result.proposals[0].evidence, "CAFE-SETTLEMENT-REPORT-20261105");
});

test("two partial deposits settle receivables once, not as second revenue", () => {
  const result = build();
  assert.deepEqual(result.receivablesBySale, [
    { saleId: "1", entitlement: "70000.00", allocatedDeposits: "70000.00", outstanding: "0.00" },
    { saleId: "2", entitlement: "120000.00", allocatedDeposits: "20000.00", outstanding: "100000.00" },
  ]);
  assert.deepEqual(result.proposals[2].lines.map(x => x.accountCode), ["1020", "1120"]);
  assert.deepEqual(result.proposals[3].lines.map(x => x.accountCode), ["1020", "1120"]);
  assert.equal(result.proposals.filter(p => p.sourceKey.startsWith("verified-deposit:")).length, 2);
});

test("a purchase linked expense is a payable payment, not second operating expense", () => {
  const result = build();
  assert.deepEqual(result.payableByPurchase, [
    { purchaseId: "41", invoice: "30000.00", paid: "20000.00", remaining: "10000.00" },
  ]);
  assert.deepEqual(result.proposals[4].lines.map(x => x.accountCode), ["1210", "2010"]);
  assert.deepEqual(result.proposals[5].lines.map(x => x.accountCode), ["2010", "1020"]);
  assert.ok(!result.proposals.some(p => p.lines.some(x => x.accountCode === "5010" || x.accountCode === "6060")));
});

test("unverified products are shipped-only: no sale proposal, explicit blocker", () => {
  const f = fixture();
  f.evidence.sales[0].soldVerified = false;
  f.evidence.deposits = [];
  const result = buildVerifiedAccountingSourceBridge(f);
  assert.ok(result.blockers.some(b => b.code === "NOT_CONFIRMED_SOLD"));
  assert.ok(result.blockers.some(b => b.code === "UNMATCHED_DEPOSIT"));
  assert.ok(!result.proposals.some(p => p.sourceKey === "verified-sale:1"));
});

test("missing sales evidence creates blocker and no automatic revenue", () => {
  const f = fixture();
  f.evidence.sales = [];
  f.evidence.deposits = [];
  const result = buildVerifiedAccountingSourceBridge(f);
  assert.equal(result.proposals.filter(p => p.sourceKey.startsWith("verified-sale:")).length, 0);
  assert.equal(result.blockers.filter(b => b.code === "SALE_NOT_RECONCILED").length, 2);
});

test("missing deposit evidence creates blocker and does not add second revenue", () => {
  const f = fixture();
  f.evidence.deposits = [];
  const result = buildVerifiedAccountingSourceBridge(f);
  assert.equal(result.blockers.filter(b => b.code === "UNMATCHED_DEPOSIT").length, 2);
  assert.equal(result.proposals.filter(p => p.sourceKey.startsWith("verified-deposit:")).length, 0);
});

test("gross source sales require independently verified net entitlement, not a fixed share", () => {
  const f = fixture();
  f.evidence.sales[0].netEntitlement = "70001.00";
  const result = buildVerifiedAccountingSourceBridge(f);
  assert.equal(result.proposals[0].lines[0].debit, "70001.00");
  assert.throws(() => {
    const invalid = fixture();
    invalid.evidence.sales[0].netEntitlement = "120000.00";
    buildVerifiedAccountingSourceBridge(invalid);
  }, /tidak cocok/i);
});

test("when OS sales already NET, any different entitlement must be reconciled externally", () => {
  const f = fixture();
  f.evidence.sales[1].netEntitlement = "84000.00";
  assert.throws(() => buildVerifiedAccountingSourceBridge(f), /tidak cocok/i);
});

test("unknown sales recording basis and forged proof cannot be silently accepted", () => {
  for (const change of [
    { recordedBasis: null },
    { reviewed: false },
    { evidenceRef: "x" },
    { netEntitlement: null },
  ]) {
    const f = fixture();
    Object.assign(f.evidence.sales[0], change);
    assert.throws(() => buildVerifiedAccountingSourceBridge(f));
  }
});

test("no settlement may exceed a confirmed receivable across multiple deposits", () => {
  const f = fixture();
  f.evidence.deposits[1].allocations = [
    { saleId: 1, amount: "30000.00" },
  ];
  assert.throws(() => buildVerifiedAccountingSourceBridge(f), /melampaui/i);
});

test("a cash receipt must allocate exactly the value originally recorded in incomes", () => {
  const f = fixture();
  f.evidence.deposits[0].allocations[0].amount = "50000.00";
  assert.throws(() => buildVerifiedAccountingSourceBridge(f), /Alokasi harus sama/i);
});

test("deposit allocations cannot refer to missing or unverified sales", () => {
  for (const saleId of [99, 2]) {
    const f = fixture();
    if (saleId === 2) f.evidence.sales[1].soldVerified = false;
    f.evidence.deposits[0].allocations = [{ saleId, amount: "60000.00" }];
    assert.throws(() => buildVerifiedAccountingSourceBridge(f), /terverifikasi/i);
  }
});

test("a single receipt cannot list the same sale twice", () => {
  const f = fixture();
  f.evidence.deposits[0].allocations = [
    { saleId: 1, amount: "30000.00" },
    { saleId: 1, amount: "30000.00" },
  ];
  assert.throws(() => buildVerifiedAccountingSourceBridge(f), /dua kali/i);
});

test("payments require an actual purchase-linked expense, no overpay or false purchase id", () => {
  const wrong = fixture();
  wrong.evidence.purchasePayments[0].purchaseId = 999;
  assert.throws(() => buildVerifiedAccountingSourceBridge(wrong), /cocok/i);
  const more = fixture();
  more.sources.expenses[0].nominal = "40000.00";
  assert.throws(() => buildVerifiedAccountingSourceBridge(more), /melebihi/i);
});

test("maintenance purchase cannot automatically enter raw stock inventory", () => {
  const f = fixture();
  f.sources.purchases[0].ingredient_id = null;
  f.sources.purchases[0].maintenance_item_id = 8;
  f.evidence.purchasePayments = [];
  const result = buildVerifiedAccountingSourceBridge(f);
  assert.ok(result.blockers.some(b => b.code === "PURCHASE_CLASSIFICATION_REQUIRED"));
  assert.ok(!result.proposals.some(p => p.sourceKey === "verified-purchase:41"));
});

test("not-attested expenses are explicitly classified as blockers, not P&L", () => {
  const f = fixture();
  f.sources.expenses.push({
    id: 52, tanggal: "2026-11-04", nominal: "4200000.00", purchase_id: null,
  });
  const result = buildVerifiedAccountingSourceBridge(f);
  assert.ok(result.blockers.some(b => b.code === "EXPENSE_CLASSIFICATION_REQUIRED"));
});

test("unapproved purchase and nonmatches remain blocked, not fabricated payables", () => {
  const f = fixture();
  f.evidence.purchases = [];
  f.evidence.purchasePayments = [];
  const result = buildVerifiedAccountingSourceBridge(f);
  assert.ok(result.blockers.some(b => b.code === "PURCHASE_NOT_CLASSIFIED"));
  assert.ok(result.blockers.some(b => b.code === "PURCHASE_PAYMENT_NOT_RECONCILED"));
});

test("missing, deleted, pre-cutover, duplicated, or invalid source rows fail closed", () => {
  const variants = [
    f => { delete f.sources.incomes; },
    f => { f.sources.sales[0].is_deleted = true; },
    f => { f.sources.sales[0].sale_date = "2026-10-31"; },
    f => { f.sources.sales[0].sale_date = "2026-11-31"; },
    f => { f.sources.sales.push({ ...f.sources.sales[0] }); },
    f => { f.sources.expenses[0].nominal = "0"; },
    f => { f.sources.purchases[0].total = null; },
  ];
  for (const modify of variants) {
    const f = fixture(); modify(f);
    assert.throws(() => buildVerifiedAccountingSourceBridge(f));
  }
});

test("duplicate signed proof references for the same source ID are rejected", () => {
  const variants = [
    f => f.evidence.sales.push({ ...f.evidence.sales[0] }),
    f => f.evidence.deposits.push({ ...f.evidence.deposits[0] }),
    f => f.evidence.purchases.push({ ...f.evidence.purchases[0] }),
    f => f.evidence.purchasePayments.push({ ...f.evidence.purchasePayments[0] }),
  ];
  for (const modify of variants) {
    const f = fixture(); modify(f);
    assert.throws(() => buildVerifiedAccountingSourceBridge(f), /duplikat/i);
  }
});

test("cannot create recognized COGS from missing unit_value or CAFE_OUT alone", () => {
  const result = build();
  assert.equal(result.proposals.filter(p => p.lines.some(x => x.accountCode === "5010")).length, 0);
  assert.ok(result.blockers.some(b => b.code === "SOLD_COGS_REQUIRES_VALUATION"));
  assert.ok(result.blockers.some(b => b.code === "STOCK_VALUATION_NOT_CONNECTED"));
  assert.ok(result.blockers.some(b => b.code === "OPENING_AND_POSTING_NOT_APPROVED"));
  assert.equal(result.actualProfitAvailable, false);
  assert.equal(result.readyToPost, false);
});
