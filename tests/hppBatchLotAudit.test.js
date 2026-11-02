import { test } from "node:test";
import assert from "node:assert/strict";
import { assessBatchLotSources } from "../src/utils/accountingBatchLotAudit.js";

function fixture() {
  return {
    batch:{id:10,status:"Finished",inventory_consumed:true},
    materials:[
      {id:1,unit_value:null},
      {id:2,unit_value:"150.00"},
    ],
    splits:[
      {id:100,product_id:7,route:"DIRECT",source_split_id:null,qty:4,baked_good_qty:4},
      {id:101,product_id:7,route:"FROZEN",source_split_id:null,qty:6,baked_good_qty:0},
      {id:102,product_id:7,route:"DIRECT",source_split_id:101,qty:2,baked_good_qty:2},
    ],
    stockMovements:[
      {id:201,batch_split_id:100,product_id:7,movement_type:"FINISHED_IN",qty:4},
      {id:202,batch_split_id:101,product_id:7,movement_type:"FROZEN_IN",qty:6},
      {id:203,batch_split_id:101,product_id:7,movement_type:"FROZEN_OUT",qty:2},
      {id:204,batch_split_id:102,product_id:7,movement_type:"FINISHED_IN",qty:2},
    ],
  };
}
test("root frozen and direct releases are inspected without double-counting baked derivative",()=>{
  const result=assessBatchLotSources(fixture());
  assert.equal(result.rootSplitCount,2);
  assert.equal(result.derivedSplitCount,1);
  assert.equal(result.directReleaseCount,1);
  assert.equal(result.frozenReleaseCount,1);
  assert.equal(result.otherStockMovementCount,1);
  assert.equal(result.releaseRows.length,2);
  assert.ok(result.releaseRows.every(x=>x.sourceQtyConfirmed));
  assert.equal(result.actualHppKnown,false);
  assert.equal(result.readyToPost,false);
  assert.equal(result.writesDatabase,false);
});
test("missing historical unit values never become zero HPP",()=>{
  const result=assessBatchLotSources(fixture());
  assert.equal(result.materialCostUnverifiedCount,1);
  assert.ok(result.issues.some(i=>i.includes("unit_value")));
  assert.ok(result.issues.some(i=>i.includes("overhead")));
});
test("missing release quantities and product mismatch are flagged",()=>{
  const f=fixture();
  f.stockMovements[0].qty=3;
  f.stockMovements[1].product_id=8;
  const result=assessBatchLotSources(f);
  assert.equal(result.releaseRows[0].sourceQtyConfirmed,false);
  assert.equal(result.releaseRows[1].sourceQtyConfirmed,false);
  assert.ok(result.issues.some(i=>i.includes("split") || i.includes("Split")));
});
test("missing frozen parent and unexpected root route are flagged",()=>{
  const f=fixture();
  f.splits[2].source_split_id=999;
  f.splits[0].route="OTHER";
  const result=assessBatchLotSources(f);
  assert.ok(result.issues.some(i=>i.includes("turunan")));
  assert.ok(result.issues.some(i=>i.includes("tipe")));
});
test("duplicate stock IDs and deleted mutations are flagged",()=>{
  const f=fixture();
  f.stockMovements[0].is_deleted=true;
  f.stockMovements.push({...f.stockMovements[1]});
  const result=assessBatchLotSources(f);
  assert.ok(result.issues.some(i=>i.includes("duplikat")));
  assert.ok(result.issues.some(i=>i.includes("terhapus")));
});
test("no batch, splits or materials makes source audit fail or show blockers",()=>{
  assert.throws(()=>assessBatchLotSources({
    batch:null,materials:[],splits:[],stockMovements:[],
  }),/tidak lengkap/i);
  const f=fixture();f.materials=[];f.splits=[];f.stockMovements=[];
  const result=assessBatchLotSources(f);
  assert.equal(result.actualHppKnown,false);
  assert.ok(result.issues.some(i=>i.includes("bahan")));
  assert.ok(result.issues.some(i=>i.includes("split asal")));
});
