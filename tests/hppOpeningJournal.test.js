import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildOpeningJournalPreview, buildOpeningFinancialPosition, OPENING_ACCOUNTS,
} from "../src/utils/accountingOpeningJournal.js";
import {
  evaluateCutoverDraft, OPENING_FINANCIAL_FIELDS, buildCutoverIngredientReview,
} from "../src/utils/hppCutoverOpening.js";

function readyDraft(overrides = {}) {
  const review = buildCutoverIngredientReview({
    cutoverDate: "2026-12-01",
    ingredients: [
      { id: 1, nama: "Tepung", satuan: "kg" },
      { id: 2, nama: "Garam", satuan: "gram" },
    ],
    movements: [
      { id: 99, ingredient_id: 1, transaction_date: "2026-11-01",
        transaction_type: "PURCHASE", qty: 9, unit: "kg" },
    ],
  });
  const financial = Object.fromEntries(OPENING_FINANCIAL_FIELDS.map(field => [field.key, "0"]));
  Object.assign(financial, {
    cash: "100000",
    bank: "500000",
    receivables: "40000",
    finishedGoods: "20000",
    frozenGoods: "10000",
    consignmentGoods: "15000",
    otherAssets: "0",
    payables: "90000",
    otherLiabilities: "5000",
  }, overrides);
  return evaluateCutoverDraft({
    review, financial,
    physical: {
      1: { qty: "2", unitCost: "15000", costSource: "Faktur" },
      2: { qty: "0", costSource: "" },
    },
    approvedByOwner: true,
  });
}

test("opening account catalog is unique and distinguishes consignment stock", () => {
  const keys = OPENING_ACCOUNTS.map(a => a.code);
  assert.equal(keys.length, new Set(keys).size);
  assert.ok(OPENING_ACCOUNTS.some(a => a.source === "consignmentGoods"));
  assert.ok(OPENING_ACCOUNTS.some(a => a.source === "rawInventory"));
});

test("builds balanced double-entry opening journal without posting", () => {
  const journal = buildOpeningJournalPreview(readyDraft());
  assert.equal(journal.type, "OPENING_BALANCE_PREVIEW");
  assert.equal(journal.cutoverDate, "2026-12-01");
  assert.equal(journal.totals.balanced, true);
  assert.equal(journal.totals.debit, journal.totals.credit);
  assert.equal(journal.readyToPost, false);
  assert.equal(journal.writesDatabase, false);
});

test("inventories, café consignment, and A/R are distinct asset accounts", () => {
  const journal = buildOpeningJournalPreview(readyDraft());
  const amount = code => journal.lines.find(x => x.accountCode === code)?.debit ?? 0;
  assert.equal(amount("1210"), 30000);
  assert.equal(amount("1220"), 20000);
  assert.equal(amount("1230"), 10000);
  assert.equal(amount("1240"), 15000);
  assert.equal(amount("1120"), 40000);
});

test("liabilities credit with residual equity as opening balancing figure", () => {
  const journal = buildOpeningJournalPreview(readyDraft());
  const position = buildOpeningFinancialPosition(journal);
  assert.equal(position.totals.assets, 715000);
  assert.equal(position.totals.liabilities, 95000);
  assert.equal(position.totals.equity, 620000);
  assert.equal(journal.equity.signedAmount, 620000);
  assert.equal(position.balances, true);
});

test("negative residual equity is debit, not silently converted into profit", () => {
  const draft = readyDraft({ cash: "0", bank: "0", receivables: "0",
    finishedGoods: "0", frozenGoods: "0", consignmentGoods: "0",
    payables: "1000000", otherLiabilities: "0" });
  const journal = buildOpeningJournalPreview(draft);
  const equityLine = journal.lines.find(line => line.accountCode === "3000");
  assert.equal(equityLine.credit, 0);
  assert.equal(equityLine.debit, 970000);
  const position = buildOpeningFinancialPosition(journal);
  assert.equal(position.totals.equity, -970000);
  assert.equal(position.totals.assets, 30000);
  assert.equal(position.totals.liabilities, 1000000);
});

test("opening cash and bank do not automatically become revenue or cash flow", () => {
  const pos = buildOpeningFinancialPosition(buildOpeningJournalPreview(readyDraft()));
  assert.equal(pos.incomeStatementAvailable, false);
  assert.equal(pos.cashFlowStatementAvailable, false);
  assert.equal(pos.provisional, true);
});

test("unfilled accounts block journal even when physical inventory exists", () => {
  const draft = readyDraft();
  draft.financial.bank = null;
  assert.throws(() => buildOpeningJournalPreview(draft), /saldo akun/i);
});

test("incomplete stock count and valuation source are rejected", () => {
  const first = readyDraft();
  first.inventory[0].stockValue = null;
  assert.throws(() => buildOpeningJournalPreview(first));
  const second = readyDraft();
  second.inventory[0].costSource = null;
  assert.throws(() => buildOpeningJournalPreview(second), /dasar valuasi/i);
});

test("duplicated inventory rows are rejected to avoid inflated assets", () => {
  const draft = readyDraft();
  draft.inventory.push({ ...draft.inventory[0] });
  assert.throws(() => buildOpeningJournalPreview(draft), /duplikat/i);
});

test("blocks arbitrary draft not created by validation or already marked posted", () => {
  const draft = readyDraft();
  draft.canActivate = true;
  assert.throws(() => buildOpeningJournalPreview(draft));
});

test("decimal Rupiah amounts reconcile in cents", () => {
  const draft = readyDraft({ cash: "200.25", bank: "100.10", payables: "2.11" });
  const journal = buildOpeningJournalPreview(draft);
  assert.equal(journal.totals.balanced, true);
  assert.equal(buildOpeningFinancialPosition(journal).balances, true);
});

test("source draft is not mutated by preview generation", () => {
  const draft = readyDraft();
  const before = JSON.stringify(draft);
  buildOpeningJournalPreview(draft);
  assert.equal(JSON.stringify(draft), before);
});

test("missing journal or tampered accounting line is not shown as valid position", () => {
  assert.throws(() => buildOpeningFinancialPosition(null));
  const journal = buildOpeningJournalPreview(readyDraft());
  const firstAsset = journal.lines.find(x => x.accountCode === "1010");
  firstAsset.debit += 1;
  assert.throws(() => buildOpeningFinancialPosition(journal), /tidak seimbang/);
});
