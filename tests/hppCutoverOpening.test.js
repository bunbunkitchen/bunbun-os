import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isValidIsoDate, parseOptionalNonnegative, buildCutoverIngredientReview,
  evaluateCutoverDraft, OPENING_FINANCIAL_FIELDS,
} from "../src/utils/hppCutoverOpening.js";

const ingredients = [
  { id: 1, nama: "Tepung", satuan: "kg" },
  { id: 2, nama: "Ragi", satuan: "gr" },
];
const book = [
  { id: 1, ingredient_id: 1, transaction_date: "2026-10-01",
    transaction_type: "PURCHASE", qty: "2", unit: "kg" },
  { id: 2, ingredient_id: 1, transaction_date: "2026-10-02",
    transaction_type: "PRODUCTION_OUT", qty: "400", unit: "gram" },
  { id: 3, ingredient_id: 2, transaction_date: "2026-10-01",
    transaction_type: "ADJUSTMENT_IN", qty: "100", unit: "gr" },
];

const baselineReview = () => buildCutoverIngredientReview({
  cutoverDate: "2026-11-01", ingredients, movements: book,
});
const zeroFinancial = () => Object.fromEntries(
  OPENING_FINANCIAL_FIELDS.map(x => [x.key, "0"])
);

test("cutover date is strict ISO and rejects impossible days", () => {
  assert.equal(isValidIsoDate("2026-11-01"), true);
  assert.equal(isValidIsoDate("2026-02-30"), false);
  assert.equal(isValidIsoDate("01-11-2026"), false);
});
test("blank financial inputs remain unknown, explicit zero is allowed", () => {
  assert.equal(parseOptionalNonnegative(""), null);
  assert.equal(parseOptionalNonnegative("0"), 0);
  assert.equal(parseOptionalNonnegative("4000.50"), 4000.50);
  assert.throws(() => parseOptionalNonnegative("-1"));
  assert.throws(() => parseOptionalNonnegative("1.000,00"));
});
test("ledger sums compatible mass units without changing source transactions", () => {
  const result = baselineReview();
  assert.equal(result.rows.find(x => x.ingredientId === 1).bookQty, 1.6);
  assert.equal(result.rows.find(x => x.ingredientId === 2).bookQty, 100);
  assert.equal(result.reliableRowCount, 2);
  assert.equal(result.readyToActivate, false);
});
test("cutover starts at day D: entries dated D are excluded", () => {
  const result = buildCutoverIngredientReview({
    cutoverDate: "2026-10-02", ingredients, movements: book,
  });
  assert.equal(result.rows.find(x => x.ingredientId === 1).bookQty, 2);
});
test("soft deleted movements must be excluded", () => {
  const result = buildCutoverIngredientReview({
    cutoverDate: "2026-11-01", ingredients,
    movements: [...book, { ...book[1], id: 44, qty: 100, is_deleted: true }],
  });
  assert.equal(result.rows.find(x => x.ingredientId === 1).bookQty, 1.6);
});
test("incompatible unit remains a warning and blocks book quantity", () => {
  const result = buildCutoverIngredientReview({
    cutoverDate: "2026-11-01",
    ingredients: [{ id: 29, nama: "Biskuit", satuan: "pc" }],
    movements: [{
      id: 251, ingredient_id: 29, transaction_date: "2026-08-02",
      transaction_type: "PURCHASE", qty: 90, unit: "gr",
    }],
  });
  assert.equal(result.rows[0].bookQty, null);
  assert.equal(result.rows[0].issues[0].code, "INVALID_UNIT_OR_QUANTITY");
});
test("negative book stocks are not normalized to zero", () => {
  const result = buildCutoverIngredientReview({
    cutoverDate: "2026-11-01", ingredients,
    movements: [{ ...book[1], qty: 5000 }],
  });
  const row = result.rows.find(x => x.ingredientId === 1);
  assert.equal(row.isReliable, false);
  assert.equal(row.bookQty, null);
  assert.ok(row.issues.some(x => x.code === "NEGATIVE_BOOK_STOCK"));
});
test("orphan records and unknown movement types cannot be silently accepted", () => {
  const result = buildCutoverIngredientReview({
    cutoverDate: "2026-11-01", ingredients,
    movements: [{
      id: 1, ingredient_id: 999, transaction_date: "2026-10-01",
      transaction_type: "PURCHASE", qty: 5, unit: "kg",
    }, {
      id: 2, ingredient_id: 2, transaction_date: "2026-10-01",
      transaction_type: "UNKNOWN", qty: 5, unit: "gr",
    }],
  });
  assert.deepEqual(result.unmatchedMovementIds, [1]);
  assert.equal(result.rows.find(x => x.ingredientId === 2).bookQty, null);
});
test("blank account balances and physical counts do not create a fake zero balance", () => {
  const draft = evaluateCutoverDraft({ review: baselineReview() });
  assert.equal(draft.balance, null);
  assert.equal(draft.financial.cash, null);
  assert.equal(draft.status, "DRAFT_INCOMPLETE");
  assert.equal(draft.canActivate, false);
});
test("complete physical count makes a DRAFT provisional balance, never auto-posts", () => {
  const review = baselineReview();
  const draft = evaluateCutoverDraft({
    review, financial: { ...zeroFinancial(), cash: "100000", bank: "200000" },
    physical: {
      1: { qty: "1.6", unitCost: "15000", costSource: "Faktur 01" },
      2: { qty: "100", unitCost: "200", costSource: "Faktur 02" },
    },
    approvedByOwner: true,
  });
  assert.equal(draft.issues.length, 0);
  assert.equal(draft.balance.rawInventoryValue, 44000);
  assert.equal(draft.balance.openingAssets, 344000);
  assert.equal(draft.balance.openingEquityByDifference, 344000);
  assert.equal(draft.status, "DRAFT_REVIEW_COMPLETE");
  assert.equal(draft.canActivate, false);
  assert.equal(draft.writesDatabase, false);
});
test("negative or missing physical values must not be auto-assumed", () => {
  assert.throws(() => evaluateCutoverDraft({
    review: baselineReview(), physical: { 1: { qty: -2 } },
  }));
  const missing = evaluateCutoverDraft({
    review: baselineReview(),
    financial: zeroFinancial(),
    physical: { 1: { qty: "1.6", unitCost: "", costSource: "" } },
  });
  assert.equal(missing.balance, null);
  assert.ok(missing.issues.some(x => x.includes("Tepung")));
});
test("stock mismatch requires note without changing old inventory", () => {
  const draft = evaluateCutoverDraft({
    review: baselineReview(), financial: zeroFinancial(),
    physical: {
      1: { qty: "3", unitCost: "10000", costSource: "Stok opname" },
      2: { qty: "100", unitCost: "200", costSource: "Faktur" },
    },
  });
  assert.equal(draft.inventory.find(x => x.ingredientId === 1).difference, 1.4);
  assert.ok(draft.issues.some(x => x.includes("selisih stok fisik")));
  assert.equal(draft.canActivate, false);
});
test("zero physical stock is not assigned a made-up unit cost", () => {
  const draft = evaluateCutoverDraft({
    review: baselineReview(), financial: zeroFinancial(),
    physical: {
      1: { qty: "0", varianceNote: "Opname kosong" },
      2: { qty: "0", varianceNote: "Opname kosong" },
    },
  });
  assert.equal(draft.balance.rawInventoryValue, 0);
  assert.equal(draft.canActivate, false);
});
