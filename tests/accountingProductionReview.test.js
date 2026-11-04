import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createProductionReviewHandler} from '../supabase/functions/_shared/accountingProductionReview.js';
import {openPurchaseReview,sealPurchaseReview} from '../supabase/functions/_shared/accountingPurchaseReview.js';
const owner='2375b60c-c418-47c2-b157-af80b262fadf',origin='https://staging.example',secret='synthetic-production-signing-secret-12345678',time=1793740000000;
const cost={action:'review-cost',batchId:'1',expenseId:'2',amount:'20',date:'2026-11-04',costKind:'LABOR',cashAccount:'1020',productionConfirmed:true,evidenceRef:'LABOR-PROOF-1'};
const completion={action:'review-completion',batchId:'1',date:'2026-11-04',lossPolicy:'ABSORB_NORMAL_LOSS',rejectCost:'0',
  lotCosts:[{splitId:'3',amount:'80'}],allCostsConfirmed:true,zeroLaborConfirmed:false,zeroOverheadConfirmed:false,evidenceRef:'COMPLETE-PROOF-1'};
const deps=(extra={})=>({stageEnabled:true,allowedOrigin:origin,signingSecret:secret,now:()=>time,verifyUserToken:async()=>({id:owner}),
 loadProfile:async()=>({id:owner,role:'owner',is_active:true}),loadSource:async()=>({sourceSnapshot:'server-digest',mayConfirm:true,blockers:[],totalCost:'80'}),submitReview:async()=>({journalId:'j'}),...extra});
const req=(body,headers={})=>new Request('https://edge.example/production',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Authorization:'Bearer valid.token',...headers},body:JSON.stringify(body)});
test('production review purpose-binds actual source, allocation choices and active Owner',async()=>{
 let posted;
 const h=createProductionReviewHandler(deps({submitReview:async(p,actor)=>{posted={p,actor};return{journalId:'j'};}}));
 const r=await h(req(cost));assert.equal(r.status,200);const b=await r.json();assert.equal(b.summary.sourceSnapshot,undefined);
 const token=await openPurchaseReview(b.reviewToken,secret+':production-cost-v1',owner,time);
 assert.equal(token.sourceSnapshot,'server-digest');assert.equal(token.amount,'20');assert.equal(token.action,'post_cost');
 assert.equal((await h(req({action:'confirm',confirmed:true,reviewToken:b.reviewToken}))).status,200);assert.equal(posted.actor,owner);
});
test('completion review preserves exact explicit root allocations and loss policy, never advertises final profit',async()=>{
 const h=createProductionReviewHandler(deps());const b=await (await h(req(completion))).json();
 const token=await openPurchaseReview(b.reviewToken,secret+':production-cost-v1',owner,time);
 assert.equal(token.action,'post_completion');assert.deepEqual(token.lotCosts,completion.lotCosts);assert.equal(token.allCostsConfirmed,true);assert.equal(b.actualProfitAvailable,false);
});
test('missing source/period/cost evidence returns blockers without a posting token',async()=>{
 const h=createProductionReviewHandler(deps({loadSource:async()=>({sourceSnapshot:'digest',mayConfirm:false,blockers:['Unknown overhead']})}));
 const b=await (await h(req(completion))).json();assert.equal(b.mayConfirm,false);assert.equal(b.reviewToken,null);assert.deepEqual(b.summary.blockers,['Unknown overhead']);
});
test('review rejects forged costs, actors, unsafe IDs, invalid dates, coercions and incomplete production approval',async()=>{
 const h=createProductionReviewHandler(deps());
 for(const patch of [{actorId:owner},{totalCost:'1'},{sourceSnapshot:'fake'},{batchId:'9223372036854775808'},{date:'2026-02-30'},{amount:'NaN'},{amount:'1e4'},{productionConfirmed:false}]){
   assert.equal((await h(req({...cost,...patch}))).status,422);
 }
 for(const patch of [{allCostsConfirmed:false},{zeroLaborConfirmed:'true'},{rejectCost:'-1'},
   {lotCosts:[{splitId:'3',amount:'40'},{splitId:'3',amount:'40'}]},{lotCosts:[{splitId:'3',amount:'80',productId:'9'}]}])assert.equal((await h(req({...completion,...patch}))).status,422);
});
test('fresh Owner, purpose, expiry and exact confirmation shape are checked again',async()=>{
 let active=true,writes=0;
 const h=createProductionReviewHandler(deps({loadProfile:async()=>({id:owner,role:'owner',is_active:active}),submitReview:async()=>{writes++;}}));
 const b=await (await h(req(cost))).json();active=false;
 assert.equal((await h(req({action:'confirm',confirmed:true,reviewToken:b.reviewToken}))).status,403);assert.equal(writes,0);
 const expired=createProductionReviewHandler(deps({now:()=>time+300000}));assert.equal((await expired(req({action:'confirm',confirmed:true,reviewToken:b.reviewToken}))).status,409);
 const bad=await sealPurchaseReview({actorId:owner,kind:'PRODUCTION_COST',action:'post_cost',issuedAt:time,expiresAt:time+300000},secret+':material-wip-v1');
 assert.equal((await createProductionReviewHandler(deps())(req({action:'confirm',confirmed:true,reviewToken:bad}))).status,409);
 assert.equal((await createProductionReviewHandler(deps())(req({action:'confirm',confirmed:true,reviewToken:b.reviewToken,amount:'1'}))).status,422);
});
test('source/pool change on confirmation does not claim a successful journal',async()=>{
 const h=createProductionReviewHandler(deps({submitReview:async()=>{throw Error('private database detail');}}));
 const b=await (await h(req(cost))).json();const r=await h(req({action:'confirm',confirmed:true,reviewToken:b.reviewToken}));
 assert.equal(r.status,409);assert.equal((await r.json()).code,'SOURCE_OR_COST_CHANGED');
});
test('batch inspection is Owner-only, bounded and cannot post anything',async()=>{
 let calls=0;const h=createProductionReviewHandler(deps({loadSource:async(action,p)=>{assert.equal(action,'inspect_batch');assert.equal(p.batchId,'1');return{roots:[],totalCost:'0'};},submitReview:async()=>{calls++;}}));
 const r=await h(req({action:'inspect-batch',batchId:'1'}));assert.equal(r.status,200);assert.equal((await r.json()).actualProfitAvailable,false);assert.equal(calls,0);
 for(const role of ['cashier','baker','helper','admin'])assert.equal((await createProductionReviewHandler(deps({loadProfile:async()=>({id:owner,role,is_active:true})}))(req(cost))).status,403);
});
test('untrusted origins, disabled staging and missing/oversized source snapshots fail closed',async()=>{
 assert.equal((await createProductionReviewHandler(deps({stageEnabled:false}))(req(cost))).status,503);
 assert.equal((await createProductionReviewHandler(deps())(req(cost,{Origin:'https://evil.example'}))).status,403);
 assert.equal((await createProductionReviewHandler(deps({loadSource:async()=>null}))(req(cost))).status,404);
 assert.equal((await createProductionReviewHandler(deps({loadSource:async()=>({sourceSnapshot:'x'.repeat(24001),mayConfirm:true})}))(req(cost))).status,409);
});
