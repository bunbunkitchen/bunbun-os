import { test } from "node:test";
import assert from "node:assert/strict";
import { previewNewLotRelease } from "../src/utils/accountingNewLotReleasePlan.js";
import { buildLotReleaseServerRequest } from "../src/utils/accountingLotReleaseTransport.js";

function draft() {
  return previewNewLotRelease({
    cutoverDate:"2026-11-01",
    releaseDate:"2026-11-07",
    destination:"The Public Coffee",
    destinationType:"CAFE_CONSIGNMENT",
    operationKey:"b221ffff-1111-4111-8111-111111111111",
    releaseEvidenceRef:"DELIVERY-NOTE-20261107",
    lots:[
      {lotId:"split:100",productId:1,availableQty:5,location:"FINISHED",
        sourceType:"PRODUCTION_DIRECT",releasedOn:"2026-11-05",
        evidenceRef:"SIGNED-LOT-SNAPSHOT-100"},
      {lotId:"split:101",productId:1,availableQty:6,location:"FINISHED",
        sourceType:"PRODUCTION_FROZEN_CONVERTED",releasedOn:"2026-11-05",
        evidenceRef:"SIGNED-LOT-SNAPSHOT-101"},
      {lotId:"split:102",productId:2,availableQty:3,location:"FINISHED",
        sourceType:"PRODUCTION_DIRECT",releasedOn:"2026-11-05",
        evidenceRef:"SIGNED-LOT-SNAPSHOT-102"},
    ],
    entries:[
      {productId:1,qty:7,allocations:[
        {lotId:"split:100",qty:4},{lotId:"split:101",qty:3},
      ]},
      {productId:2,qty:2,allocations:[
        {lotId:"split:102",qty:2},
      ]},
    ],
  });
}

test("maps future multi-product, multi-lot plan to isolated SQL request without approving it",()=>{
  const result=buildLotReleaseServerRequest(draft());
  assert.deepEqual(result,{
    action:"record-lot-assigned-release",
    operationKey:"b221ffff-1111-4111-8111-111111111111",
    movementDate:"2026-11-07",
    destination:"The Public Coffee",
    destinationType:"CAFE_CONSIGNMENT",
    evidenceRef:"DELIVERY-NOTE-20261107",
    items:[
      {productId:"1",quantity:7,allocations:[
        {lotKey:"split:100",qty:4},
        {lotKey:"split:101",qty:3},
      ]},
      {productId:"2",quantity:2,allocations:[
        {lotKey:"split:102",qty:2},
      ]},
    ],
    browserEvidenceIsNotApproval:true,
  });
  const json=JSON.stringify(result);
  for(const forbidden of ["actor_id","actorId","userId","approvedBy",
    "cogs","revenue","sellingPrice","bankAccount","availableQty"]) {
    assert.ok(!json.includes('"' + forbidden + '"'),forbidden);
  }
});

test("invalid status or fake approval blocks transport even though transport has no posting",()=>{
  for(const invalid of [
    {status:"POSTED"},
    {readyToPost:true},
    {writesDatabase:true},
    {ownerApprovalVerified:true},
    {sourceBalanceVerified:true},
    {createsSale:true},
    {createsCogs:true},
    {requiresAtomicReleaseWithStockMovement:false},
  ]) {
    assert.throws(()=>buildLotReleaseServerRequest({...draft(),...invalid}),/preview/i);
  }
});

test("cannot omit a lot or change its quantity after the preview",()=>{
  const altered=draft();
  altered.allocationRows[0].qty=1;
  assert.throws(()=>buildLotReleaseServerRequest(altered),/jumlah lot/i);
  const deleted=draft();
  deleted.allocationRows.pop();
  assert.throws(()=>buildLotReleaseServerRequest(deleted),/jumlah lot/i);
});

test("cannot add a second copy of lot allocation",()=>{
  const plan=draft();
  plan.allocationRows.push({...plan.allocationRows[0]});
  assert.throws(()=>buildLotReleaseServerRequest(plan),/duplikat/i);
});

test("cannot forge stock movement IDs, move date or destination after preview",()=>{
  const spoof=draft();
  spoof.allocationRows[0].stockMovementId=123;
  assert.throws(()=>buildLotReleaseServerRequest(spoof),/tidak konsisten/i);
  const date=draft();
  date.allocationRows[1].movementDate="2026-11-20";
  assert.throws(()=>buildLotReleaseServerRequest(date),/tidak konsisten/i);
  const dest=draft();
  dest.allocationRows[0].destinationType="DIRECT_SALE";
  assert.throws(()=>buildLotReleaseServerRequest(dest),/tidak konsisten/i);
});

test("the adapter is immutable, does not know or access Supabase",()=>{
  const plan=draft();
  const serialized=JSON.stringify(plan);
  const request=buildLotReleaseServerRequest(plan);
  assert.equal(JSON.stringify(plan),serialized);
  assert.equal(request.browserEvidenceIsNotApproval,true);
  assert.equal("approvedBy" in request,false);
  assert.equal("p_actor_id" in request,false);
});
