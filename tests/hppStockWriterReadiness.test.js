import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STOCK_WRITER_COVERAGE, inspectStockWriterReadiness } from "../src/utils/accountingStockWriterReadiness.js";

const sqlSources=[
  readFileSync("database/016_frozen_product_flow.sql","utf8"),
  readFileSync("database/029_sales_auto_product_stock.sql","utf8"),
  readFileSync("supabase/migrations/20260920130000_018_product_stock_adjustment.sql","utf8"),
  readFileSync("database/031_multi_product_stock_release.sql","utf8"),
];

test("every stock writer tracked in migration SQL is explicitly listed",()=>{
  const names=[
    "record_shaping_split","release_frozen_stock","record_baking_result",
    "record_cafe_deposit","record_multi_product_release",
    "record_sale_transaction","update_sale_transaction","delete_sale_transaction",
    "record_product_stock_adjustment",
  ];
  assert.deepEqual(STOCK_WRITER_COVERAGE.map(x=>x.rpc),names);
  for(const name of names) {
    assert.ok(sqlSources.some(src=>new RegExp(
      "create or replace function public\\."+name+"\\s*\\(","i").test(src)),name);
  }
});

test("the readiness snapshot cannot certify cutover or production readiness",()=>{
  const snapshot=inspectStockWriterReadiness();
  assert.equal(snapshot.totalWriters,9);
  assert.equal(snapshot.prototypeWriters,7);
  assert.equal(snapshot.liveIntegratedWriters,0);
  assert.equal(snapshot.cutoverMayBeActivated,false);
  assert.equal(snapshot.writesDatabase,false);
  assert.ok(snapshot.blockers.length>=3);
  assert.ok(snapshot.writers.every(x=>x.liveIntegrated===false));
});

test("both sides of adjustment and sale edits remain explicitly tracked",()=>{
  const byRpc=Object.fromEntries(STOCK_WRITER_COVERAGE.map(x=>[x.rpc,x.movementTypes]));
  assert.deepEqual(byRpc.record_product_stock_adjustment,["ADJUSTMENT_IN","ADJUSTMENT_OUT"]);
  assert.deepEqual(byRpc.update_sale_transaction,["CAFE_IN","CAFE_OUT"]);
  assert.deepEqual(byRpc.release_frozen_stock,["FROZEN_OUT"]);
});

test("opening report cannot change registered original writer coverage",()=>{
  const before=JSON.stringify(STOCK_WRITER_COVERAGE);
  const snapshot=inspectStockWriterReadiness();
  snapshot.writers[0].movementTypes.pop();
  snapshot.writers[0].status="DEPLOYED";
  assert.equal(JSON.stringify(STOCK_WRITER_COVERAGE),before);
  assert.equal(inspectStockWriterReadiness().cutoverMayBeActivated,false);
});


test("shaping, frozen conversion, baking and multi-product release are CI prototypes, never live",()=>{
  const result=inspectStockWriterReadiness();
  const prototypes=result.writers.filter(x=>x.status==="PROTOTYPE_ONLY");
  assert.deepEqual(prototypes.map(x=>x.rpc),[
    "record_shaping_split","release_frozen_stock",
    "record_baking_result","record_multi_product_release",
    "record_sale_transaction","update_sale_transaction","delete_sale_transaction",
  ]);
  assert.ok(prototypes.every(x=>x.liveIntegrated===false));
  assert.equal(result.cutoverMayBeActivated,false);
  assert.equal(result.liveIntegratedWriters,0);
});


test("sales stock writers have isolated reversals but are never marked live",()=>{
  const result=inspectStockWriterReadiness();
  const sales=result.writers.filter(x=>[
    "record_sale_transaction","update_sale_transaction","delete_sale_transaction",
  ].includes(x.rpc));
  assert.equal(sales.length,3);
  assert.ok(sales.every(x=>x.status==="PROTOTYPE_ONLY" && x.liveIntegrated===false));
  assert.equal(result.cutoverMayBeActivated,false);
});
