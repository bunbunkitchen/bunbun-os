import { test } from "node:test";
import assert from "node:assert/strict";
import { reconstructIngredientMWA, convertToBaseQuantity } from "../src/utils/hppHistoricalValuation.js";

const flour = { id: 1, nama: "Tepung", satuan: "kg" };
const opening = { approved: true, asOfDate: "2026-07-01",
  quantity: 10, unit: "kg", value: 100000 };
const purchased = { id: 12, ingredient_id: 1, jumlah: "10", satuan: "kg",
  total: "120000", is_deleted: false };
const buy = { id: 15, ingredient_id: 1, transaction_date: "2026-07-17",
  transaction_type: "PURCHASE", purchase_id: 12, qty: "10", unit: "kg" };
const use = { id: 16, ingredient_id: 1, transaction_date: "2026-07-18",
  transaction_type: "PRODUCTION_OUT", qty: "5000", unit: "gram",
  production_batch_id: 3 };

test("normalize known compatible units and reject unmatched unit family", () => {
  assert.deepEqual(convertToBaseQuantity(2, "kg"), { qty: 2000, family: "mass" });
  assert.deepEqual(convertToBaseQuantity(1.5, "L"), { qty: 1500, family: "volume" });
  assert.equal(convertToBaseQuantity(0, "kg"), null);
  assert.equal(convertToBaseQuantity(1, "unknown"), null);
});

test("purchase TOTAL drives MWA, not master recipe price", () => {
  const result = reconstructIngredientMWA({
    ingredient: { ...flour, harga: 77777 }, opening,
    purchases: [purchased], movements: [buy, use],
  });
  assert.equal(result.valuationCompletelyReconciled, true);
  assert.equal(result.ledger[1].cost, 55000);
  assert.equal(result.endingQty, 15000);
  assert.equal(result.endingValue, 165000);
  assert.equal(result.readyForFinalPosting, false);
});

test("missing opening does NOT assume zero or invent a historical HPP", () => {
  const result = reconstructIngredientMWA({
    ingredient: flour, purchases: [purchased], movements: [buy, use],
  });
  assert.equal(result.openingVerified, false);
  assert.equal(result.endingValue, null);
  assert.equal(result.ledger[1].cost, null);
  assert.ok(result.blockers.some(x => x.code === "OPENING_BALANCE_UNVERIFIED"));
});

test("production before first purchase is explicitly flagged", () => {
  const result = reconstructIngredientMWA({
    ingredient: flour, purchases: [purchased],
    movements: [{ ...use, id: 1, transaction_date: "2026-07-08" }, buy],
  });
  assert.ok(result.blockers.some(x => x.code === "USE_BEFORE_FIRST_PURCHASE"));
});

test("zero-amount purchasing is a blocker, never a free inventory assumption", () => {
  const result = reconstructIngredientMWA({
    ingredient: flour, opening, purchases: [{ ...purchased, total: "0.00" }],
    movements: [buy],
  });
  assert.ok(result.blockers.some(x => x.code === "PURCHASE_COST_UNCONFIRMED"));
  assert.equal(result.endingValue, null);
});

test("missing or mismatched purchasing linkage cannot be valued", () => {
  const missing = reconstructIngredientMWA({ ingredient: flour, opening, purchases: [], movements: [buy] });
  assert.ok(missing.blockers.some(x => x.code === "PURCHASE_LINK_INVALID"));
  const wrongQuantity = reconstructIngredientMWA({
    ingredient: flour, opening, purchases: [{ ...purchased, jumlah: 1 }], movements: [buy],
  });
  assert.ok(wrongQuantity.blockers.some(x => x.code === "PURCHASE_QUANTITY_MISMATCH"));
});

test("non-purchase stock unit_value interpreted per transaction unit", () => {
  const result = reconstructIngredientMWA({
    ingredient: flour, opening,
    movements: [{ id: 18, ingredient_id: 1, transaction_type: "ADJUSTMENT",
      transaction_date: "2026-07-11", qty: 2, unit: "kg", unit_value: 14000 }],
  });
  assert.equal(result.ledger[0].cost, 28000);
  assert.equal(result.endingValue, 128000);
  assert.equal(result.endingQty, 12000);
});

test("inventory correction without validated acquisition value stops money computation", () => {
  const correction = { id: 20, ingredient_id: 1, transaction_type: "ADJUSTMENT_IN",
    transaction_date: "2026-07-10", qty: 1, unit: "kg", unit_value: null };
  const result = reconstructIngredientMWA({
    ingredient: flour, opening, movements: [correction, use],
  });
  assert.ok(result.blockers.some(x => x.code === "INBOUND_VALUE_UNCONFIRMED"));
  assert.equal(result.ledger[1].cost, null);
});

test("sub-recipe production-in needs documented transfer value", () => {
  const result = reconstructIngredientMWA({
    ingredient: flour, opening, movements: [{
      id: 20, ingredient_id: 1, transaction_type: "PRODUCTION_IN",
      transaction_date: "2026-07-10", qty: 2, unit: "kg",
    }],
  });
  assert.ok(result.blockers.some(x => x.code === "INBOUND_VALUE_UNCONFIRMED"));
});

test("different mass/count units are blocked, never silently normalized", () => {
  const cookie = { id: 29, nama: "Biskuit", satuan: "pc" };
  const result = reconstructIngredientMWA({
    ingredient: cookie, opening: { ...opening, quantity: 0, value: 0, unit: "pc" },
    movements: [{ id: 251, ingredient_id: 29, transaction_type: "PURCHASE",
      transaction_date: "2026-08-02", qty: 90, unit: "gr" }],
  });
  assert.ok(result.blockers.some(x => x.code === "UNIT_OR_QUANTITY_INVALID"));
});

test("same-day purchase/use must be reviewed even if ID order appears obvious", () => {
  const result = reconstructIngredientMWA({
    ingredient: flour, opening, purchases: [purchased],
    movements: [buy, { ...use, transaction_date: buy.transaction_date }],
  });
  assert.ok(result.blockers.some(x => x.code === "SAME_DAY_ORDER_UNVERIFIED"));
  assert.equal(result.valuationCompletelyReconciled, false);
});

test("negative balances are blocked, never normalized to zero", () => {
  const result = reconstructIngredientMWA({
    ingredient: flour, opening, movements: [{ ...use, qty: 12000 }],
  });
  assert.ok(result.blockers.some(x => x.code === "NEGATIVE_BALANCE"));
  assert.equal(result.endingQty, null);
});

test("soft-deleted rows do not enter the valuation ledger", () => {
  const result = reconstructIngredientMWA({
    ingredient: flour, opening, movements: [{ ...buy, is_deleted: true }],
  });
  assert.equal(result.transactionCount, 0);
  assert.equal(result.endingValue, 100000);
});
