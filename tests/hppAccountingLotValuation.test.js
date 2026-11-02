import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildBatchLotCostDraft, traceLotCostDraft, proposeSoldLotCogsDrafts,
} from "../src/utils/accountingLotValuation.js";

function fixture() {
  return {
    cutoverDate:"2026-11-01",
    batch:{ id:10, kode:"BN-10", status:"Finished",
      inventory_consumed:true, created_at:"2026-11-03T10:00:00Z" },
    materials:[
      { id:1, production_batch_id:10, transaction_type:"PRODUCTION_OUT",
        ingredient_id:4, transaction_date:"2026-11-03", qty:120,unit:"gram",
        unit_value:null },
      { id:2, production_batch_id:10, transaction_type:"PRODUCTION_OUT",
        ingredient_id:5, transaction_date:"2026-11-03", qty:100,unit:"gram",
        unit_value:null },
    ],
    splits:[
      { id:100, production_batch_id:10, product_id:7,
        source_split_id:null, route:"DIRECT", qty:4,baked_good_qty:4 },
      { id:101, production_batch_id:10, product_id:7,
        source_split_id:null, route:"FROZEN", qty:6,baked_good_qty:0 },
      { id:102, production_batch_id:10, product_id:7,
        source_split_id:101, route:"DIRECT", qty:2,baked_good_qty:2 },
      { id:103, production_batch_id:10, product_id:7,
        source_split_id:null, route:"REJECT", qty:1,baked_good_qty:0 },
    ],
    stockMovements:[
      { id:201,batch_split_id:100,product_id:7,movement_type:"FINISHED_IN",
        movement_date:"2026-11-03",qty:4 },
      { id:202,batch_split_id:101,product_id:7,movement_type:"FROZEN_IN",
        movement_date:"2026-11-03",qty:6 },
      { id:203,batch_split_id:101,product_id:7,movement_type:"FROZEN_OUT",
        movement_date:"2026-11-07",qty:2 },
      { id:204,batch_split_id:102,product_id:7,movement_type:"FINISHED_IN",
        movement_date:"2026-11-07",qty:2 },
    ],
    verifiedCosts:{
      materials:[
        {transactionId:1,amount:"5000.00",reviewed:true,evidenceRef:"INV-BATCH-001"},
        {transactionId:2,amount:"3000.00",reviewed:true,evidenceRef:"INV-BATCH-002"},
      ],
      labor:{amount:"1000.00",reviewed:true,evidenceRef:"PAYROLL-BATCH-10"},
      overhead:{amount:"1000.00",reviewed:true,evidenceRef:"OVERHEAD-BATCH-10"},
      rejectLoss:{amount:"1000.00",reviewed:true,evidenceRef:"REJECT-REPORT-BATCH-10"},
      lots:[
        {splitId:100,amount:"3000.00",reviewed:true,evidenceRef:"SPLIT-COST-100"},
        {splitId:101,amount:"6000.00",reviewed:true,evidenceRef:"SPLIT-COST-101"},
      ],
    },
  };
}
const draft = () => buildBatchLotCostDraft(fixture());
const event = (id,type,lotId,qty,date,saleId=null) => ({
  id,type,lotId,qty,date,saleId,
  reviewed:true,evidenceRef:"STOCK-EVIDENCE-"+id,
});

test("batch cost ties every raw material to independently reviewed value, not legacy NULL unit_value", () => {
  const result=draft();
  assert.equal(result.rawMaterialCost,"8000.00");
  assert.equal(result.laborCost,"1000.00");
  assert.equal(result.overheadCost,"1000.00");
  assert.equal(result.totalProductionCost,"10000.00");
  assert.equal(result.rejectLossCost,"1000.00");
  assert.equal(result.releasedLotCost,"9000.00");
  assert.equal(result.lots.length,2);
  assert.equal(result.excludedDerivedSplitCount,1);
  assert.ok(result.lots.every(lot=>lot.productId==="7"));
  assert.equal(result.mayPost,false);
  assert.equal(result.actualCostOfGoodsSoldAvailable,false);
  assert.equal(result.writesDatabase,false);
});

test("root frozen lot counts once; a derived baked split is not an extra release", () => {
  const v=draft();
  assert.deepEqual(v.lots.map(l=>[l.splitId,l.qty,l.initialLocation,l.totalCost]),[
    ["100",4,"FINISHED","3000.00"],
    ["101",6,"FROZEN","6000.00"],
  ]);
  assert.deepEqual(v.lots.map(l=>l.sourceMovementId),["201","202"]);
});

test("cost remains in stock on frozen -> finished -> consignment and becomes COGS only at actual sale", () => {
  const lots=draft().lots;
  const events=[
    event("conv-1","FROZEN_TO_FINISHED",lots[1].lotId,2,"2026-11-07"),
    event("ship-1","SHIP_TO_CAFE",lots[0].lotId,2,"2026-11-08"),
    event("ship-2","SHIP_TO_CAFE",lots[1].lotId,1,"2026-11-08"),
    event("sold-1","SOLD_AT_CAFE",lots[0].lotId,1,"2026-11-09",123),
    event("sold-2","SOLD_AT_CAFE",lots[1].lotId,1,"2026-11-09",123),
  ];
  const output=traceLotCostDraft({lots,events});
  assert.equal(output.initialLotCost,"9000.00");
  assert.equal(output.soldCogs,"1750.00");
  assert.equal(output.remainingInventoryValue,"7250.00");
  assert.deepEqual(output.locations,{
    FROZEN:{qty:4,value:"4000.00"},
    FINISHED:{qty:3,value:"2500.00"},
    CAFE:{qty:1,value:"750.00"},
  });
  assert.equal(output.events.filter(e=>e.isCogs).length,2);
  assert.equal(output.events.find(e=>e.type==="SHIP_TO_CAFE").isCogs,false);
  assert.equal(output.sourceCompletelyVerified,false);
  assert.equal(output.readyToPost,false);
});

test("goods shipped to cafe are still assets until confirmed SOLD_AT_CAFE", () => {
  const lots=draft().lots;
  const output=traceLotCostDraft({lots,events:[
    event("ship-1","SHIP_TO_CAFE",lots[0].lotId,3,"2026-11-08"),
  ]});
  assert.equal(output.soldCogs,"0.00");
  assert.equal(output.remainingInventoryValue,"9000.00");
  assert.equal(output.locations.CAFE.value,"2250.00");
});

test("return from cafe to finished keeps original lot cost", () => {
  const lots=draft().lots;
  const result=traceLotCostDraft({lots,events:[
    event("ship-1","SHIP_TO_CAFE",lots[0].lotId,2,"2026-11-05"),
    event("return-1","RETURN_FROM_CAFE",lots[0].lotId,1,"2026-11-06"),
  ]});
  assert.equal(result.locations.CAFE.value,"750.00");
  assert.equal(result.locations.FINISHED.value,"2250.00");
  assert.equal(result.soldCogs,"0.00");
});

test("direct counter sale may consume FINISHED without fabricated cafe shipment", () => {
  const lots=draft().lots;
  const result=traceLotCostDraft({lots,events:[
    event("direct-sale-1","DIRECT_SOLD",lots[0].lotId,1,"2026-11-07",15),
  ]});
  assert.equal(result.soldCogs,"750.00");
  assert.equal(result.locations.FINISHED.qty,3);
});

test("cent rounding is conserved across partial sales", () => {
  const lots=[{
    lotId:"lot:77",productId:1,initialLocation:"FINISHED",
    qty:3,totalCost:"100.00",
  }];
  const result=traceLotCostDraft({lots,events:[
    event("s-1","DIRECT_SOLD","lot:77",1,"2026-11-05",11),
    event("s-2","DIRECT_SOLD","lot:77",1,"2026-11-06",12),
    event("s-3","DIRECT_SOLD","lot:77",1,"2026-11-07",13),
  ]});
  assert.deepEqual(result.events.map(e=>e.value),["33.33","33.33","33.34"]);
  assert.equal(result.soldCogs,"100.00");
  assert.equal(result.remainingInventoryValue,"0.00");
});

test("lot allocation must reconcile exact total including reject, not allocate costs twice", () => {
  const f=fixture();
  f.verifiedCosts.lots[1].amount="7000.00";
  assert.throws(()=>buildBatchLotCostDraft(f),/tidak sama/i);
  const g=fixture();
  g.verifiedCosts.rejectLoss.amount="0";
  assert.throws(()=>buildBatchLotCostDraft(g),/REJECT/i);
});

test("cannot value material at zero unless reviewed independently", () => {
  const f=fixture();
  f.verifiedCosts.materials=[];
  assert.throws(()=>buildBatchLotCostDraft(f),/belum diverifikasi/i);
  const g=fixture();
  g.verifiedCosts.materials[0].reviewed=false;
  assert.throws(()=>buildBatchLotCostDraft(g),/belum memiliki bukti/i);
});

test("missing labor/overhead evidence never silently falls back to flat per-piece estimate", () => {
  for(const key of ["labor","overhead"]){
    const f=fixture();delete f.verifiedCosts[key];
    assert.throws(()=>buildBatchLotCostDraft(f),/bukti/i);
  }
  const f=fixture();
  f.verifiedCosts.overhead={ amount:"0",reviewed:true,evidenceRef:"NO-OH-ALLOCATED-10" };
  f.verifiedCosts.lots[1].amount="5000.00";
  assert.equal(buildBatchLotCostDraft(f).overheadCost,"0.00");
});

test("reject/zero-yield and split allocation without a source are rejected", () => {
  const zero=fixture();zero.splits[0].baked_good_qty=0;
  assert.throws(()=>buildBatchLotCostDraft(zero),/Hasil layak/i);
  const extra=fixture();extra.verifiedCosts.lots.push({
    splitId:999,reviewed:true,amount:"100",evidenceRef:"EXTRA-SPLIT-999",
  });
  assert.throws(()=>buildBatchLotCostDraft(extra),/tanpa split/i);
});

test("different product ID or incorrect finished release is rejected", () => {
  const f=fixture();f.stockMovements[0].product_id=9;
  assert.throws(()=>buildBatchLotCostDraft(f),/tidak cocok/i);
  const g=fixture();g.stockMovements[0].qty=3;
  assert.throws(()=>buildBatchLotCostDraft(g),/tidak cocok/i);
});

test("derived split must reference a parent from the same batch", () => {
  const f=fixture();f.splits[2].source_split_id=999;
  assert.throws(()=>buildBatchLotCostDraft(f),/split asal/i);
});

test("unknown root route and mixed release route are rejected", () => {
  const f=fixture();f.splits[0].route="UNKNOWN";
  assert.throws(()=>buildBatchLotCostDraft(f),/route/i);
  const g=fixture();g.stockMovements.push({
    id:208,batch_split_id:100,product_id:7,
    movement_type:"FROZEN_IN",movement_date:"2026-11-03",qty:4,
  });
  assert.throws(()=>buildBatchLotCostDraft(g),/tidak sesuai route/i);
});

test("duplicate material, movement, split and cost proof are refused", () => {
  const cases=[
    f=>f.materials.push({...f.materials[0]}),
    f=>f.stockMovements.push({...f.stockMovements[0]}),
    f=>f.splits.push({...f.splits[0]}),
    f=>f.verifiedCosts.materials.push({...f.verifiedCosts.materials[0]}),
    f=>f.verifiedCosts.lots.push({...f.verifiedCosts.lots[0]}),
  ];
  for(const change of cases){
    const f=fixture();change(f);
    assert.throws(()=>buildBatchLotCostDraft(f),/duplikat|dua kali/i);
  }
});

test("can't recost historical batches using a later cutover without approved opening", () => {
  const f=fixture();f.cutoverDate="2026-11-04";
  assert.throws(()=>buildBatchLotCostDraft(f),/sebelum cutover/i);
  const g=fixture();g.materials[0].transaction_date="2026-10-31";
  assert.throws(()=>buildBatchLotCostDraft(g),/sebelum cutover/i);
  const h=fixture();h.stockMovements[0].movement_date="2026-10-31";
  assert.throws(()=>buildBatchLotCostDraft(h),/sebelum cutover/i);
});

test("batch must be Finished and inventory consumed",()=>{
  const f=fixture();f.batch.status="Waiting";
  assert.throws(()=>buildBatchLotCostDraft(f),/Finished/i);
  const g=fixture();g.batch.inventory_consumed=false;
  assert.throws(()=>buildBatchLotCostDraft(g),/pemakaian bahan/i);
});

test("unknown lot location, zero-valued lot and duplicate lot ID are rejected",()=>{
  const l=draft().lots;
  assert.throws(()=>traceLotCostDraft({lots:[l[0],l[0]],events:[]}),/duplikat/i);
  assert.throws(()=>traceLotCostDraft({lots:[{...l[0],initialLocation:"WAREHOUSE"}],events:[]}));
  assert.throws(()=>traceLotCostDraft({lots:[{...l[0],totalCost:"0"}],events:[]}),/nol/i);
});

test("duplicate event IDs, insufficient inventory and early sale are blocked",()=>{
  const lots=draft().lots;
  const first=event("ship-1","SHIP_TO_CAFE",lots[0].lotId,2,"2026-11-08");
  assert.throws(()=>traceLotCostDraft({lots,events:[first,first]}),/unik/i);
  assert.throws(()=>traceLotCostDraft({lots,events:[
    event("ship-5","SHIP_TO_CAFE",lots[0].lotId,5,"2026-11-08"),
  ]}),/tidak cukup/i);
  assert.throws(()=>traceLotCostDraft({lots,events:[
    event("sale-1","SOLD_AT_CAFE",lots[0].lotId,1,"2026-11-08",31),
  ]}),/tidak cukup/i);
});

test("stock transfers must not contain sale IDs; confirmed sale must contain one",()=>{
  const lots=draft().lots;
  assert.throws(()=>traceLotCostDraft({lots,events:[
    event("ship-1","SHIP_TO_CAFE",lots[0].lotId,1,"2026-11-05",55),
  ]}),/tidak boleh/i);
  assert.throws(()=>traceLotCostDraft({lots,events:[
    event("sale-1","DIRECT_SOLD",lots[0].lotId,1,"2026-11-05",null),
  ]}),/Sale tidak valid/i);
});

test("invalid source date chronology, missing approval evidence and duplicate sale per lot rejected",()=>{
  const lots=draft().lots;
  const early=event("ship-1","SHIP_TO_CAFE",lots[0].lotId,1,"2026-11-08");
  const late=event("ship-2","SHIP_TO_CAFE",lots[0].lotId,1,"2026-11-07");
  assert.throws(()=>traceLotCostDraft({lots,events:[early,late]}),/tanggal/i);
  const notReviewed=event("ship-3","SHIP_TO_CAFE",lots[0].lotId,1,"2026-11-05");
  notReviewed.reviewed=false;
  assert.throws(()=>traceLotCostDraft({lots,events:[notReviewed]}),/direview/i);
  assert.throws(()=>traceLotCostDraft({lots,events:[
    event("sale-1","DIRECT_SOLD",lots[0].lotId,1,"2026-11-05",55),
    event("sale-2","DIRECT_SOLD",lots[0].lotId,1,"2026-11-06",55),
  ]}),/lebih dari sekali/i);
});

test("all source objects untouched: pure draft and no actual posting",()=>{
  const f=fixture();
  const before=JSON.stringify(f);
  const v=buildBatchLotCostDraft(f);
  assert.equal(JSON.stringify(f),before);
  const events=[
    event("ship-1","SHIP_TO_CAFE",v.lots[0].lotId,2,"2026-11-08"),
  ];
  const sourceEvents=JSON.stringify(events);
  const traced=traceLotCostDraft({lots:v.lots,events});
  assert.equal(JSON.stringify(events),sourceEvents);
  assert.equal(traced.readyToPost,false);
  assert.equal(traced.writesDatabase,false);
});


test("pre-release sales and transfers are rejected even if quantity is available",()=>{
  const lots=draft().lots;
  assert.equal(lots[0].releaseDate,"2026-11-03");
  assert.throws(()=>traceLotCostDraft({lots,events:[
    event("early-sale","DIRECT_SOLD",lots[0].lotId,1,"2026-11-02",9),
  ]}),/tanggal|urutan/i);
  assert.throws(()=>traceLotCostDraft({lots,events:[
    event("early-convert","FROZEN_TO_FINISHED",lots[1].lotId,1,"2026-11-02"),
  ]}),/tanggal|urutan/i);
});


test("only confirmed sold lots generate cost-of-goods-sold draft journals",()=>{
  const lots=draft().lots;
  const events=[
    event("freeze-1","FROZEN_TO_FINISHED",lots[1].lotId,2,"2026-11-07"),
    event("ship-1","SHIP_TO_CAFE",lots[0].lotId,2,"2026-11-08"),
    event("sold-1","SOLD_AT_CAFE",lots[0].lotId,1,"2026-11-09",123),
    event("direct-1","DIRECT_SOLD",lots[1].lotId,1,"2026-11-09",124),
  ];
  const traced=traceLotCostDraft({lots,events});
  const cogs=proposeSoldLotCogsDrafts(traced);
  assert.equal(cogs.proposals.length,2);
  assert.deepEqual(cogs.proposals[0].lines,[
    {accountCode:"5010",debit:"750.00",credit:"0.00"},
    {accountCode:"1240",debit:"0.00",credit:"750.00"},
  ]);
  assert.deepEqual(cogs.proposals[1].lines,[
    {accountCode:"5010",debit:"1000.00",credit:"0.00"},
    {accountCode:"1220",debit:"0.00",credit:"1000.00"},
  ]);
  assert.deepEqual(cogs.proposals.map(p=>p.sourceKey),[
    "verified-cogs:123:sold-1","verified-cogs:124:direct-1",
  ]);
  assert.equal(cogs.totalDraftCogs,"1750.00");
  assert.ok(cogs.proposals.every(p=>p.status==="DRAFT" &&
    p.requiresVerifiedLotToSaleAllocation &&
    p.evidenceFromClientNotAuthorized && p.requiresStockCheck &&
    p.readyToPost===false && p.writesDatabase===false));
});

test("goods only consigned, frozen or returned cannot generate any COGS proposal",()=>{
  const lots=draft().lots;
  const traced=traceLotCostDraft({lots,events:[
    event("freeze-1","FROZEN_TO_FINISHED",lots[1].lotId,2,"2026-11-07"),
    event("ship-1","SHIP_TO_CAFE",lots[0].lotId,2,"2026-11-08"),
    event("return-1","RETURN_FROM_CAFE",lots[0].lotId,1,"2026-11-09"),
  ]});
  const result=proposeSoldLotCogsDrafts(traced);
  assert.equal(result.proposals.length,0);
  assert.equal(result.totalDraftCogs,"0.00");
  assert.equal(result.actualHppApproved,false);
});

test("COGS draft generation refuses a fake posted ledger or incomplete trace",()=>{
  assert.throws(()=>proposeSoldLotCogsDrafts({events:[],readyToPost:true,writesDatabase:false,
    sourceCompletelyVerified:false}),/belum diposting/i);
  assert.throws(()=>proposeSoldLotCogsDrafts(null),/belum diposting/i);
});
