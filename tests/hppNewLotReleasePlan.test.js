import { test } from "node:test";
import assert from "node:assert/strict";
import { previewNewLotRelease } from "../src/utils/accountingNewLotReleasePlan.js";

const KEY = "b221ffff-1111-4111-8111-111111111111";
function lot(lotId, productId, availableQty, overrides={}) {
  return {
    lotId, productId, availableQty, releasedOn: "2026-11-03",
    location:"FINISHED", sourceType:"PRODUCTION_DIRECT",
    evidenceRef:"PHYSICAL-LOT-REVIEW-20261107",
    ...overrides,
  };
}
function fixture() {
  return {
    cutoverDate:"2026-11-01",
    releaseDate:"2026-11-07",
    destination:"The Public Coffee",
    destinationType:"CAFE_CONSIGNMENT",
    operationKey: KEY,
    releaseEvidenceRef:"DELIVERY-NOTE-20261107",
    lots:[
      lot("split:100",1,6),
      lot("split:101",1,4,{sourceType:"PRODUCTION_FROZEN_CONVERTED"}),
      lot("split:102",2,7),
    ],
    entries:[
      { productId:1,qty:8,allocations:[
        {lotId:"split:100",qty:5},{lotId:"split:101",qty:3},
      ] },
      { productId:2,qty:4,allocations:[{lotId:"split:102",qty:4}] },
    ],
  };
}
const preview = input => previewNewLotRelease(input || fixture());

test("multi-lot per product and multi-product release produces balanced draft only", () => {
  const result=preview();
  assert.equal(result.status,"NEW_LOT_RELEASE_PLAN_ONLY");
  assert.deepEqual(result.productRows,[
    {productId:"1",quantity:8,assignedQty:8},
    {productId:"2",quantity:4,assignedQty:4},
  ]);
  assert.deepEqual(result.allocationRows.map(a=>[a.lotId,a.qty,a.productId]),[
    ["split:100",5,"1"],["split:101",3,"1"],["split:102",4,"2"],
  ]);
  assert.deepEqual(result.projectedLotBalances.map(l=>l.projectedQty),[1,1,3]);
  assert.ok(result.allocationRows.every(a=>
    a.operationKey===KEY && a.stockMovementId===null &&
    a.sourceLocation==="FINISHED" &&
    a.destinationType==="CAFE_CONSIGNMENT"));
  assert.equal(result.createsSale,false);
  assert.equal(result.createsCashTransaction,false);
  assert.equal(result.createsCogs,false);
  assert.equal(result.sourceBalanceVerified,false);
  assert.equal(result.ownerApprovalVerified,false);
  assert.equal(result.requiresAtomicReleaseWithStockMovement,true);
  assert.equal(result.readyToPost,false);
  assert.equal(result.writesDatabase,false);
});

test("a manual shipment to a cafe remains consignment, never an auto sale", () => {
  const r=preview();
  assert.equal(r.destination,"The Public Coffee");
  assert.equal(r.destinationType,"CAFE_CONSIGNMENT");
  assert.equal(r.createsSale,false);
  assert.equal(r.createsCogs,false);
});

test("event, direct order and complimentary release also cannot fabricate COGS", () => {
  for (const destinationType of ["EVENT_RELEASE","DIRECT_ORDER_RELEASE","SAMPLE_RELEASE","OTHER_RELEASE"]) {
    const f=fixture();
    f.destinationType=destinationType;
    const r=preview(f);
    assert.equal(r.createsSale,false);
    assert.equal(r.createsCogs,false);
    assert.ok(r.allocationRows.every(a=>a.destinationType===destinationType));
  }
});

test("allocation count must equal release qty for every product, no partial auto fill", () => {
  const f=fixture();
  f.entries[0].allocations[0].qty=4;
  assert.throws(()=>preview(f),/tidak sama/i);
});

test("released qty may not overdraw any lot", () => {
  const f=fixture();
  f.entries[0].allocations[0].qty=7;
  f.entries[0].qty=10;
  assert.throws(()=>preview(f),/melebihi jumlah tersedia/i);
});

test("same product cannot repeat in different rows to bypass stock limit", () => {
  const f=fixture();
  f.entries.push({productId:1,qty:1,allocations:[{lotId:"split:100",qty:1}]});
  assert.throws(()=>preview(f),/produk yang sama/i);
});

test("same root split cannot be added twice inside one row", () => {
  const f=fixture();
  f.entries[0].allocations.push({lotId:"split:100",qty:1});
  assert.throws(()=>preview(f),/dipilih dua kali/i);
});

test("source duplicate lot identities fail before any allocation", () => {
  const f=fixture();
  f.lots.push({...f.lots[0]});
  assert.throws(()=>preview(f),/lot asal duplikat/i);
});

test("root split is not inferred from product match alone", () => {
  const f=fixture();
  f.entries[0].allocations[0].lotId="split:102";
  assert.throws(()=>preview(f),/tidak sesuai produk/i);
});

test("lot source missing or rejected cannot be auto-filled using any other lot", () => {
  const f=fixture();
  f.entries[0].allocations[1].lotId="split:999";
  assert.throws(()=>preview(f),/tidak sesuai produk/i);
});

test("one lot already exhausted cannot be used for a new release", () => {
  const f=fixture();
  f.lots[0].availableQty=0;
  assert.throws(()=>preview(f),/melebihi jumlah tersedia/i);
});

test("fresh batch lots and frozen-derived lots must be physically in FINISHED", () => {
  for(const location of ["FROZEN","CAFE","UNKNOWN"]){
    const f=fixture();f.lots[1].location=location;
    assert.throws(()=>preview(f),/stok produk jadi/i);
  }
});

test("release before lot was made or before cutover is forbidden", () => {
  const f=fixture();f.lots[0].releasedOn="2026-11-08";
  assert.throws(()=>preview(f),/lot belum berada/i);
  const g=fixture();g.releaseDate="2026-10-31";
  assert.throws(()=>preview(g),/sebelum cutover/i);
  const h=fixture();h.releaseDate="2026-02-30";
  assert.throws(()=>preview(h),/sebelum cutover/i);
});

test("opening physical lot can be explicitly chosen after cutover, but not called approved", () => {
  const f=fixture();
  f.lots[0]=lot("opening:PHYSICAL01",1,6,{
    sourceType:"OPENING_COUNT",releasedOn:"2026-11-01",
  });
  f.entries[0].allocations[0].lotId="opening:PHYSICAL01";
  const r=preview(f);
  assert.equal(r.allocationRows[0].lotId,"opening:PHYSICAL01");
  assert.equal(r.ownerApprovalVerified,false);
  assert.equal(r.sourceBalanceVerified,false);
});

test("opening lot must use opening key, production lot must use split ID", () => {
  const f=fixture();f.lots[0].sourceType="OPENING_COUNT";
  assert.throws(()=>preview(f),/opening/i);
  const g=fixture();g.lots[0].lotId="opening:PHYSICAL01";
  assert.throws(()=>preview(g),/split asal/i);
});

test("bad or absent evidence reference does not authorize movement", () => {
  const f=fixture();f.releaseEvidenceRef="x";
  assert.throws(()=>preview(f),/bukti/i);
  const g=fixture();g.lots[0].evidenceRef="";
  assert.throws(()=>preview(g),/bukti/i);
});

test("invalid operation key cannot be used as an idempotency hint", () => {
  const f=fixture();f.operationKey="not-uuid";
  assert.throws(()=>preview(f),/operation key/i);
});

test("invalid/negative/decimal/unsafe quantity does not become stock", () => {
  for(const qty of [-1,"1.5",null,true,Number.MAX_SAFE_INTEGER+1]){
    const f=fixture();f.entries[0].qty=qty;
    assert.throws(()=>preview(f),/qty|presisi/i);
  }
  const f=fixture();f.entries[0].allocations[1].qty=0;
  assert.throws(()=>preview(f),/positif/i);
});

test("missing inputs, duplicate products and invalid destination are blocked", () => {
  const f=fixture();f.lots=null;
  assert.throws(()=>preview(f),/belum lengkap/i);
  const g=fixture();g.entries=[];
  assert.throws(()=>preview(g),/belum lengkap/i);
  const h=fixture();h.destinationType="SOLD_AT_CAFE";
  assert.throws(()=>preview(h),/tujuan dan klasifikasi/i);
});

test("no mutation of original release, lots or quantities", () => {
  const f=fixture(), before=JSON.stringify(f);
  const r=preview(f);
  assert.equal(JSON.stringify(f),before);
  assert.equal(r.writesDatabase,false);
  assert.equal(r.sourceBalanceVerified,false);
});
