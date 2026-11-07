import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createProductFlowReviewHandler} from '../supabase/functions/_shared/accountingProductFlowReview.js';
import {openPurchaseReview,sealPurchaseReview} from '../supabase/functions/_shared/accountingPurchaseReview.js';
const owner='2375b60c-c418-47c2-b157-af80b262fadf',origin='https://staging.example',secret='synthetic-product-flow-signing-secret-123456',time=1793740000000;
const ship={action:'review',kind:'SHIP',movementId:'11',saleId:null,derivedSplitId:null,sourceDate:null,date:'2026-11-04',cafeKey:'PUBLIC_HUB',lossPolicy:'NONE',rejectCost:'0',
 allocations:[{splitId:'2',location:'FINISHED',cafeKey:'',quantity:'4'}],traceConfirmed:true,noAdditionalBakingCostConfirmed:false,evidenceRef:'CAFE-LOT-TRACE-11'};
const deps=(extra={})=>({stageEnabled:true,allowedOrigin:origin,signingSecret:secret,now:()=>time,verifyUserToken:async()=>({id:owner}),
 loadProfile:async()=>({id:owner,role:'owner',is_active:true}),loadSource:async()=>({sourceSnapshot:'server-position-digest',mayConfirm:true,totalCost:'40',blockers:[]}),submitReview:async()=>({journalId:'j'}),...extra});
const req=(body,headers={})=>new Request('https://edge.example/flow',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Authorization:'Bearer valid.token',...headers},body:JSON.stringify(body)});
test('product flow signs exact lot source choices and server digest without accepting a client value',async()=>{
 let posted;
 const h=createProductFlowReviewHandler(deps({submitReview:async(p,actor)=>{posted={p,actor};return{journalId:'j'};}}));
 const b=await (await h(req(ship))).json();assert.equal(b.summary.totalCost,'40');assert.equal(b.actualProfitAvailable,false);assert.equal(b.summary.sourceSnapshot,undefined);
 const token=await openPurchaseReview(b.reviewToken,secret+':product-cost-flow-v1',owner,time);
 assert.equal(token.kind,'SHIP');assert.equal(token.kindOfReview,'PRODUCT_COST_FLOW');assert.equal(token.sourceSnapshot,'server-position-digest');assert.deepEqual(token.allocations,ship.allocations);
 assert.equal((await h(req({action:'confirm',confirmed:true,reviewToken:b.reviewToken}))).status,200);assert.equal(posted.actor,owner);
});
test('actual sold source identity is explicit and delivery cannot be submitted as sale without a sale ID',async()=>{
 const h=createProductFlowReviewHandler(deps());
 assert.equal((await h(req({...ship,kind:'SALE'}))).status,422);
 const sold={...ship,kind:'SALE',saleId:'5',movementId:null,allocations:[{splitId:'2',location:'CONSIGNMENT',cafeKey:'PUBLIC_HUB',quantity:'4'}]};
 const r=await h(req(sold));assert.equal(r.status,200);assert.equal((await r.json()).actualProfitAvailable,false);
});
test('all-reject baking has an explicit actual date, loss classification and no unknown additional cost',async()=>{
 const h=createProductFlowReviewHandler(deps());
 const bake={...ship,kind:'BAKE',movementId:null,derivedSplitId:'3',sourceDate:'2026-11-04',cafeKey:'',lossPolicy:'SEPARATE_ABNORMAL_LOSS',rejectCost:'40',
   noAdditionalBakingCostConfirmed:true,allocations:[{splitId:'3',location:'PROOFING',cafeKey:'',quantity:'4'}]};
 assert.equal((await h(req(bake))).status,200);
 for(const patch of [{noAdditionalBakingCostConfirmed:false},{sourceDate:null},{rejectCost:'NaN'},{lossPolicy:'NONE'}])assert.equal((await h(req({...bake,...patch}))).status,422);
});
test('extra actor/value/percentage/journal fields and unsafe or coerced quantities fail',async()=>{
 const h=createProductFlowReviewHandler(deps());
 for(const patch of [{actorId:owner},{totalCost:'1'},{percentage:70},{journalLines:[]},{date:'2026-02-30'},{movementId:'9223372036854775808'},{traceConfirmed:false}])assert.equal((await h(req({...ship,...patch}))).status,422);
 for(const quantity of [4,'0','-1','1.5','1e3','2147483648'])assert.equal((await h(req({...ship,allocations:[{...ship.allocations[0],quantity}]}))).status,422);
 assert.equal((await h(req({...ship,allocations:[ship.allocations[0],ship.allocations[0]]}))).status,422);
 assert.equal((await h(req({...ship,allocations:[{...ship.allocations[0],cafeKey:'PUBLIC_HUB'}]}))).status,422);
});
test('unknown period yields a blocker without a confirmation token',async()=>{
 const h=createProductFlowReviewHandler(deps({loadSource:async()=>({sourceSnapshot:'digest',mayConfirm:false,blockers:['Month needs accrual']})}));
 const b=await (await h(req(ship))).json();assert.equal(b.mayConfirm,false);assert.equal(b.reviewToken,null);assert.deepEqual(b.summary.blockers,['Month needs accrual']);
});
test('confirm checks a fresh active Owner, expiry, purpose and exact confirmation shape',async()=>{
 let active=true,writes=0;const h=createProductFlowReviewHandler(deps({loadProfile:async()=>({id:owner,role:'owner',is_active:active}),submitReview:async()=>{writes++;}}));
 const b=await (await h(req(ship))).json();active=false;
 assert.equal((await h(req({action:'confirm',confirmed:true,reviewToken:b.reviewToken}))).status,403);assert.equal(writes,0);
 assert.equal((await createProductFlowReviewHandler(deps({now:()=>time+300000}))(req({action:'confirm',confirmed:true,reviewToken:b.reviewToken}))).status,409);
 const token=await sealPurchaseReview({actorId:owner,kindOfReview:'PRODUCT_COST_FLOW',action:'post',issuedAt:time,expiresAt:time+300000},secret+':production-cost-v1');
 assert.equal((await createProductFlowReviewHandler(deps())(req({action:'confirm',confirmed:true,reviewToken:token}))).status,409);
 assert.equal((await createProductFlowReviewHandler(deps())(req({action:'confirm',confirmed:true,reviewToken:b.reviewToken,quantity:'1'}))).status,422);
});
test('concurrent source/position change at confirmation cannot claim posting success',async()=>{
 const h=createProductFlowReviewHandler(deps({submitReview:async()=>{throw Error('private detail');}}));const b=await (await h(req(ship))).json();
 const r=await h(req({action:'confirm',confirmed:true,reviewToken:b.reviewToken}));assert.equal(r.status,409);assert.equal((await r.json()).code,'SOURCE_OR_POSITION_CHANGED');
});
test('position inspection is read-only Owner scope and never says profit is final',async()=>{
 let writes=0;const h=createProductFlowReviewHandler(deps({loadSource:async()=>({positions:[],actualProfitAvailable:true}),submitReview:async()=>{writes++;}}));
 const b=await (await h(req({action:'inspect'}))).json();assert.equal(b.actualProfitAvailable,false);assert.equal(writes,0);
 for(const role of ['cashier','admin','baker','helper'])assert.equal((await createProductFlowReviewHandler(deps({loadProfile:async()=>({id:owner,role,is_active:true})}))(req({action:'inspect'}))).status,403);
});
test('wrong origins, disabled staging, incomplete or oversized sources fail closed',async()=>{
 assert.equal((await createProductFlowReviewHandler(deps({stageEnabled:false}))(req(ship))).status,503);
 assert.equal((await createProductFlowReviewHandler(deps())(req(ship,{Origin:'https://evil.example'}))).status,403);
 assert.equal((await createProductFlowReviewHandler(deps({loadSource:async()=>null}))(req(ship))).status,409);
 assert.equal((await createProductFlowReviewHandler(deps({loadSource:async()=>({sourceSnapshot:'x'.repeat(24001),mayConfirm:true})}))(req(ship))).status,409);
});
