import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcileSaleStockSourceRows } from "../src/utils/accountingSaleStockReconciliation.js";
import { traceLotCostDraft } from "../src/utils/accountingLotValuation.js";
import { previewSaleToLotCogs } from "../src/utils/accountingSaleLotAllocation.js";

const evidence = "REVIEWED-LOT-ALLOCATION-20261015";
const saleSources = () => ({
  month:"2026-10",
  sales:[
    {id:11,sale_date:"2026-10-15",sales_channel:"PUBLIC_HUB",total_amount:"60000.00"},
    {id:12,sale_date:"2026-10-16",sales_channel:"PUBLIC_HUB",total_amount:"13000.00"},
  ],
  saleItems:[
    {id:21,sale_id:11,product_id:1,quantity:"2.000",subtotal:"26000.00"},
    {id:22,sale_id:11,product_id:3,quantity:"2.000",subtotal:"34000.00"},
    {id:23,sale_id:12,product_id:1,quantity:"1.000",subtotal:"13000.00"},
  ],
  movements:[
    {id:30,movement_date:"2026-10-15",sale_id:11,product_id:1,movement_type:"CAFE_OUT",
      qty:2,batch_split_id:null},
    {id:31,movement_date:"2026-10-15",sale_id:11,product_id:3,movement_type:"CAFE_OUT",
      qty:2,batch_split_id:null},
    {id:32,movement_date:"2026-10-16",sale_id:12,product_id:1,movement_type:"CAFE_OUT",
      qty:1,batch_split_id:null},
  ],
  orphanMovements:[],
});
const lots = () => [
  {lotId:"lot:original",productId:1,initialLocation:"FINISHED",qty:3,
    totalCost:"3000.00",releaseDate:"2026-10-10"},
  {lotId:"lot:cheese",productId:3,initialLocation:"FINISHED",qty:2,
    totalCost:"4000.00",releaseDate:"2026-10-10"},
];
const move = (id,type,lotId,qty,date,saleId = null) => ({
  id,type,lotId,qty,date,saleId,reviewed:true,evidenceRef:"MOVEMENT-REVIEW-"+id,
});
const trace = () => traceLotCostDraft({
  lots:lots(),
  events:[
    move("ship-original","SHIP_TO_CAFE","lot:original",3,"2026-10-14"),
    move("ship-cheese","SHIP_TO_CAFE","lot:cheese",2,"2026-10-14"),
    move("sold-original-11","SOLD_AT_CAFE","lot:original",2,"2026-10-15",11),
    move("sold-cheese-11","SOLD_AT_CAFE","lot:cheese",2,"2026-10-15",11),
    move("sold-original-12","SOLD_AT_CAFE","lot:original",1,"2026-10-16",12),
  ],
});
const assignment = (movementId,lotEventId) => ({
  movementId,lotEventId,reviewed:true,evidenceRef:evidence,
});
function fixture() {
  const s=saleSources();
  return {
    saleAudit:reconcileSaleStockSourceRows(s),
    movements:s.movements,
    lots:lots(),
    lotTrace:trace(),
    assignments:[
      assignment(30,"sold-original-11"),
      assignment(31,"sold-cheese-11"),
      assignment(32,"sold-original-12"),
    ],
  };
}

test("explicit lot IDs can account for every sale-linked stock movement exactly", () => {
  const r=previewSaleToLotCogs(fixture());
  assert.equal(r.status,"UNVERIFIED_SALE_TO_LOT_COGS_DRAFT");
  assert.equal(r.matchedStockMovements,3);
  assert.equal(r.allocationCount,3);
  assert.equal(r.allocatedStockMovementCount,3);
  assert.equal(r.draftCogs,"7000.00");
  assert.equal(r.issues.length,0);
  assert.deepEqual(r.cogsProposals.map(p=>p.sourceKey),[
    "verified-cogs:11:sold-original-11",
    "verified-cogs:11:sold-cheese-11",
    "verified-cogs:12:sold-original-12",
  ]);
  assert.ok(r.cogsProposals.every(p=>p.status==="DRAFT" &&
    p.readyToPost===false));
  assert.equal(r.actualHppAvailable,false);
  assert.equal(r.writesDatabase,false);
  assert.equal(r.soldGoodsIndependentlyVerified,false);
});

test("absence of allocations leaves all matched CAFE_OUT as unresolved, never HPP zero", () => {
  const f=fixture();f.assignments=[];
  const r=previewSaleToLotCogs(f);
  assert.equal(r.draftCogs,"0.00");
  assert.equal(r.issues.filter(i=>i.code==="SALE_LOT_ALLOCATION_MISSING").length,3);
  assert.equal(r.issues.some(i=>i.code==="SOLD_LOT_EVENT_NOT_LINKED_TO_SALE_STOCK"),true);
  assert.equal(r.actualHppAvailable,false);
});

test("partial allocations are explicit blockers; never impute another lot's cost", () => {
  const f=fixture();f.assignments=f.assignments.slice(0,2);
  const r=previewSaleToLotCogs(f);
  assert.equal(r.draftCogs,"6000.00");
  assert.ok(r.issues.some(i=>i.movementId==="32"));
  assert.equal(r.actualHppAvailable,false);
});

test("duplicate sold-lot cost event across two stock rows is refused", () => {
  const f=fixture();
  f.assignments[2].lotEventId="sold-original-11";
  assert.throws(()=>previewSaleToLotCogs(f),/dua kali/i);
});

test("cross-product lot allocations cannot be inferred from similar sale date", () => {
  const f=fixture();
  f.assignments[0].lotEventId="sold-cheese-11";
  assert.throws(()=>previewSaleToLotCogs(f),/produk lot tidak cocok/i);
});

test("wrong sale ID, movement date and quantity are refused", () => {
  const f=fixture();
  f.movements[0].sale_id=12;
  assert.throws(()=>previewSaleToLotCogs(f),/tanggal|sales/i);
  const g=fixture();g.movements[0].movement_date="2026-10-17";
  assert.throws(()=>previewSaleToLotCogs(g),/tanggal/i);
  const h=fixture();h.movements[0].qty=1;
  assert.throws(()=>previewSaleToLotCogs(h),/melebihi/i);
});

test("unmatched sale stock quantities are denied until source discrepancies resolved", () => {
  const s=saleSources();s.movements[0].qty=1;
  const f=fixture();f.saleAudit=reconcileSaleStockSourceRows(s);
  assert.throws(()=>previewSaleToLotCogs(f),/jumlah belum cocok/i);
});

test("only SOLD_AT_CAFE events can settle CAFE_OUT, not frozen or shipment", () => {
  const f=fixture();
  f.assignments[0].lotEventId="ship-original";
  assert.throws(()=>previewSaleToLotCogs(f),/bukan barang terjual/i);
});

test("all sources stay unmodified and lack of real evidence never becomes approval", () => {
  const f=fixture(), before=JSON.stringify(f);
  const r=previewSaleToLotCogs(f);
  assert.equal(JSON.stringify(f),before);
  assert.equal(r.evidenceFromCallerUnverified,true);
  assert.equal(r.inventorySourceVerified,false);
  assert.equal(r.readyToPost,false);
  assert.equal(r.actualHppAvailable,false);
});

test("repeated or unreviewed evidence cannot allocate costs", () => {
  const f=fixture();f.assignments[0].reviewed=false;
  assert.throws(()=>previewSaleToLotCogs(f),/bukti/i);
  const g=fixture();g.assignments[0].evidenceRef="";
  assert.throws(()=>previewSaleToLotCogs(g),/bukti/i);
});

test("unallocated direct sold event is left as separate unmatched source", () => {
  const f=fixture();
  f.lotTrace=traceLotCostDraft({
    lots:[...lots(),{lotId:"lot:direct",productId:9,initialLocation:"FINISHED",
      qty:1,totalCost:"3000.00",releaseDate:"2026-10-10"}],
    events:[
      ...[
        move("ship-original","SHIP_TO_CAFE","lot:original",3,"2026-10-14"),
        move("ship-cheese","SHIP_TO_CAFE","lot:cheese",2,"2026-10-14"),
        move("sold-original-11","SOLD_AT_CAFE","lot:original",2,"2026-10-15",11),
        move("sold-cheese-11","SOLD_AT_CAFE","lot:cheese",2,"2026-10-15",11),
        move("sold-original-12","SOLD_AT_CAFE","lot:original",1,"2026-10-16",12),
        move("direct-9","DIRECT_SOLD","lot:direct",1,"2026-10-18",99),
      ],
    ],
  });
  const r=previewSaleToLotCogs(f);
  assert.equal(r.cogsProposals.length,3);
  assert.ok(r.issues.some(i=>i.code==="SOLD_LOT_EVENT_NOT_LINKED_TO_SALE_STOCK"));
});
