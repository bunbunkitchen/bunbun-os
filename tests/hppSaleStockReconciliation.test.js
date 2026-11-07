import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcileSaleStockSourceRows } from "../src/utils/accountingSaleStockReconciliation.js";

function fixture() {
  return {
    month: "2026-10",
    sales: [
      { id: 11, sale_date: "2026-10-15", sales_channel: "PUBLIC_HUB",
        total_amount: "60000.00", is_deleted: false },
      { id: 12, sale_date: "2026-10-16", sales_channel: "PUBLIC_HUB",
        total_amount: "13000.00", is_deleted: false },
    ],
    saleItems: [
      { id: 20, sale_id: 11, product_id: 1, quantity: "2.000", subtotal: "26000.00" },
      { id: 21, sale_id: 11, product_id: 3, quantity: "2.000", subtotal: "34000.00" },
      { id: 22, sale_id: 12, product_id: 1, quantity: "1.000", subtotal: "13000.00" },
    ],
    movements: [
      { id: 30, movement_date: "2026-10-15", movement_type: "CAFE_OUT", product_id: 1,
        sale_id: 11, qty: 2, batch_split_id: null, is_deleted: false },
      { id: 31, movement_date: "2026-10-15", movement_type: "CAFE_OUT", product_id: 3,
        sale_id: 11, qty: 2, batch_split_id: null, is_deleted: false },
      { id: 32, movement_date: "2026-10-16", movement_type: "CAFE_OUT", product_id: 1,
        sale_id: 12, qty: 1, batch_split_id: null, is_deleted: false },
    ],
    orphanMovements: [],
  };
}
const run = changes => reconcileSaleStockSourceRows({
  ...fixture(), ...changes,
});

test("perfect sale/product/quantity links are traceable, NOT confirmed lot or actual COGS", () => {
  const r = run();
  assert.equal(r.summary.saleCount, 2);
  assert.equal(r.summary.itemCount, 3);
  assert.equal(r.summary.linkedMovementCount, 3);
  assert.equal(r.summary.linkedCafeOutWithoutSplitRefCount,3);
  assert.equal(r.summary.linkedCafeOutWithSplitRefCount,0);
  assert.equal(r.summary.itemUnitCount, 5);
  assert.equal(r.summary.sourceLinkedUnitCount, 5);
  assert.equal(r.summary.matchedSaleCount, 2);
  assert.equal(r.summary.needsReviewSaleCount, 0);
  assert.equal(r.allStockLinksMatch, true);
  assert.equal(r.automaticLotAssignmentPermitted, false);
  assert.equal(r.confirmedActualHpp, false);
  assert.equal(r.readyToPost, false);
  assert.equal(r.writesDatabase, false);
  assert.equal(r.summary.confirmedLotUnitCount, 0);
  assert.equal(r.summary.confirmedSoldUnitCount, 0);
  assert.equal(r.sales[0].lotSourceVerified, false);
});

test("one sale can hold repeated product lines and several matching stock moves", () => {
  const f = fixture();
  f.saleItems[0].quantity = "1.000";
  f.saleItems[0].subtotal = "13000.00";
  f.saleItems.push({
    id: 23, sale_id: 11, product_id: 1, quantity: 1, subtotal: "13000.00",
  });
  f.movements[0].qty = 1;
  f.movements.push({
    id: 33, movement_date: "2026-10-15", movement_type: "CAFE_OUT",
    product_id: 1, sale_id: 11, qty: 1,
  });
  const r = reconcileSaleStockSourceRows(f);
  assert.equal(r.summary.matchedSaleCount, 2);
  assert.equal(r.sales[0].products.find(p => p.productId === "1").movementIds.length, 2);
  assert.equal(r.sales[0].products.find(p => p.productId === "1").soldUnits, 2);
});

test("missing CAFE_OUT keeps sale as needs-review, no fake sold count", () => {
  const f = fixture();
  f.movements.pop();
  const r = reconcileSaleStockSourceRows(f);
  assert.equal(r.summary.matchedSaleCount, 1);
  assert.equal(r.summary.needsReviewSaleCount, 1);
  assert.ok(r.sales[1].issues.some(i => i.code === "SALE_STOCK_QTY_MISMATCH"));
  assert.equal(r.summary.confirmedSoldUnitCount, 0);
});

test("extra stock movement for a product absent from sale is flagged", () => {
  const f = fixture();
  f.movements.push({
    id: 40, movement_date: "2026-10-15", sale_id: 11, product_id: 8,
    movement_type: "CAFE_OUT", qty: 1,
  });
  const r = reconcileSaleStockSourceRows(f);
  assert.equal(r.summary.needsReviewSaleCount, 1);
  assert.ok(r.sales[0].issues.some(i => i.code === "STOCK_PRODUCT_NOT_IN_SALE"));
});

test("sale with no line items is NOT treated as zero-quantity sold", () => {
  const f = fixture();
  f.saleItems = f.saleItems.filter(item => item.sale_id !== 12);
  const r = reconcileSaleStockSourceRows(f);
  assert.ok(r.sales[1].issues.some(i => i.code === "SALE_WITHOUT_ITEMS"));
});

test("sale line subtotal mismatch blocks confident link even when quantity matches", () => {
  const f = fixture();
  f.sales[0].total_amount = "60010.00";
  const r = reconcileSaleStockSourceRows(f);
  assert.ok(r.sales[0].issues.some(i => i.code === "SALE_LINE_TOTAL_MISMATCH"));
  assert.equal(r.summary.matchedSaleCount, 1);
});

test("cross-date sale stock link is flagged but loaded rather than silently discarded", () => {
  const f = fixture();
  f.movements[0].movement_date = "2026-11-01";
  const r = reconcileSaleStockSourceRows(f);
  assert.ok(r.sales[0].issues.some(i => i.code === "SALE_MOVEMENT_DATE_MISMATCH"));
});

test("stock type other than CAFE_OUT cannot count as sale-linked stock", () => {
  const f = fixture();
  f.movements[0].movement_type = "FINISHED_IN";
  const r = reconcileSaleStockSourceRows(f);
  assert.ok(r.sales[0].issues.some(i => i.code === "UNSUPPORTED_SALE_STOCK_TYPE"));
  assert.ok(r.sales[0].issues.some(i => i.code === "SALE_STOCK_QTY_MISMATCH"));
});

test("unlinked CAFE_OUT remains an orphan, never attached by product/date guessing", () => {
  const f = fixture();
  f.orphanMovements = [{
    id: 900, movement_date: "2026-10-15", movement_type: "CAFE_OUT",
    sale_id: null, product_id: 1, qty: 6, is_deleted: false,
  }];
  const r = reconcileSaleStockSourceRows(f);
  assert.equal(r.summary.orphanMovementCount, 1);
  assert.equal(r.summary.orphanUnitCount, 6);
  assert.equal(r.summary.matchedSaleCount, 2);
  assert.equal(r.allStockLinksMatch, false);
  assert.ok(r.issues.some(i => i.code === "CAFE_OUT_WITHOUT_SALE_ID"));
});

test("orphan linked sale ID or wrong month is rejected", () => {
  for (const change of [
    { sale_id: 11 },
    { movement_date: "2026-11-01" },
    { movement_type: "FROZEN_OUT" },
  ]) {
    const f = fixture();
    f.orphanMovements = [{
      id: 45, movement_date: "2026-10-15", movement_type: "CAFE_OUT",
      sale_id: null, product_id: 1, qty: 1, ...change,
    }];
    assert.throws(() => reconcileSaleStockSourceRows(f));
  }
});

test("deleted or duplicated source rows fail closed", () => {
  const f = fixture(); f.sales[0].is_deleted = true;
  assert.throws(() => reconcileSaleStockSourceRows(f), /terhapus/);
  const g = fixture(); g.movements.push({ ...g.movements[0] });
  assert.throws(() => reconcileSaleStockSourceRows(g), /duplikat/);
  const h = fixture(); h.saleItems.push({ ...h.saleItems[0] });
  assert.throws(() => reconcileSaleStockSourceRows(h), /duplikat/);
});

test("source item/stock linked to missing sale ID is refused", () => {
  const f = fixture(); f.saleItems[0].sale_id = 999;
  assert.throws(() => reconcileSaleStockSourceRows(f), /tidak dimuat/);
  const g = fixture(); g.movements[0].sale_id = 999;
  assert.throws(() => reconcileSaleStockSourceRows(g), /di luar dataset/);
});

test("missing source arrays fail instead of being replaced with empty transactions", () => {
  const f = fixture(); delete f.saleItems;
  assert.throws(() => reconcileSaleStockSourceRows(f), /belum dimuat/);
  const g = fixture(); delete g.movements;
  assert.throws(() => reconcileSaleStockSourceRows(g), /belum dimuat/);
});

test("fractional or zero sale/stock quantities are invalid for discrete bakery products", () => {
  const f = fixture(); f.saleItems[0].quantity = "2.500";
  assert.throws(() => reconcileSaleStockSourceRows(f), /bulat positif/);
  const g = fixture(); g.movements[0].qty = 0;
  assert.throws(() => reconcileSaleStockSourceRows(g), /bulat positif/);
});

test("invalid/null amounts never quietly become zero and overflow is guarded", () => {
  const f = fixture(); f.saleItems[0].subtotal = null;
  assert.throws(() => reconcileSaleStockSourceRows(f));
  const g = fixture(); g.sales[0].total_amount = "999999999999999999";
  assert.throws(() => reconcileSaleStockSourceRows(g));
});

test("no sales still audits orphan stock and never invents turnover", () => {
  const r = reconcileSaleStockSourceRows({
    month: "2026-10", sales: [], saleItems: [], movements: [],
    orphanMovements: [{
      id: 32, movement_date: "2026-10-15", sale_id: null, product_id: 5,
      movement_type: "CAFE_OUT", qty: 3,
    }],
  });
  assert.equal(r.summary.saleCount, 0);
  assert.equal(r.summary.orphanUnitCount, 3);
  assert.equal(r.confirmedActualHpp, false);
});

test("the audit is a pure function and does not mutate the Supabase rows", () => {
  const f = fixture(), before = JSON.stringify(f);
  const r = reconcileSaleStockSourceRows(f);
  assert.equal(JSON.stringify(f), before);
  assert.equal(r.writesDatabase, false);
});


test("missing orphan stock dataset is not silently interpreted as zero", () => {
  const f=fixture();
  delete f.orphanMovements;
  assert.throws(() => reconcileSaleStockSourceRows(f), /belum dimuat/);
});

test("an explicit split ID is a trace hint, NOT independent proof of sold lot HPP", () => {
  const f=fixture();
  f.movements[0].batch_split_id=101;
  const r=reconcileSaleStockSourceRows(f);
  assert.equal(r.summary.linkedCafeOutWithoutSplitRefCount,2);
  assert.equal(r.summary.linkedCafeOutWithSplitRefCount,1);
  assert.equal(r.sales[0].lotSourceVerified,false);
  assert.equal(r.confirmedActualHpp,false);
});
