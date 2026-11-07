import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMaterialReviewHandler } from '../supabase/functions/_shared/accountingMaterialReview.js';
import { openPurchaseReview, sealPurchaseReview } from '../supabase/functions/_shared/accountingPurchaseReview.js';
const owner='2375b60c-c418-47c2-b157-af80b262fadf',origin='https://staging.example';
const secret='synthetic-material-test-signing-secret-123456',time=1793740000000;
const input={action:'review',transactionId:'11',usageConfirmed:true,evidenceRef:'PRODUCTION-BATCH-11'};
const source={transactionId:'11',batchId:'3',sourceSnapshot:'{"source":"locked-database-value"}',mayConfirm:true,
  actualMaterialCost:'0.33',poolValue:'1.00',poolQuantity:'3',quantity:'1',unit:'g',blockers:[],posted:false};
const deps=(extra={})=>({stageEnabled:true,allowedOrigin:origin,signingSecret:secret,now:()=>time,
 verifyUserToken:async()=>({id:owner}),loadProfile:async()=>({id:owner,role:'owner',is_active:true}),
 loadSource:async()=>source,submitReview:async()=>({journalId:'j'}),...extra});
const request=(body,extra={})=>new Request('https://edge.example/material',{method:'POST',headers:{Origin:origin,
 'Content-Type':'application/json',Authorization:'Bearer valid.token',...extra},body:JSON.stringify(body)});
test('material review signs only the server cost/source and purpose-bound explicit usage approval',async()=>{
 let posted;
 const h=createMaterialReviewHandler(deps({submitReview:async(p,actor)=>{posted={p,actor};return{journalId:'j'};}}));
 const r=await h(request(input));assert.equal(r.status,200);const body=await r.json();
 assert.equal(body.summary.actualMaterialCost,'0.33');assert.equal(body.actualProfitAvailable,false);assert.equal(body.completeProductCost,false);
 assert.equal(body.summary.sourceSnapshot,undefined);
 const token=await openPurchaseReview(body.reviewToken,secret+':material-wip-v1',owner,time);
 assert.equal(token.sourceSnapshot,source.sourceSnapshot);assert.equal(token.usageConfirmed,true);
 assert.equal((await h(request({action:'confirm',confirmed:true,reviewToken:body.reviewToken}))).status,200);
 assert.equal(posted.actor,owner);assert.equal(posted.p.transactionId,'11');assert.equal(posted.p.actualMaterialCost,undefined);
});
test('unknown opening, cost or source order produces blockers and no confirmation token',async()=>{
 const h=createMaterialReviewHandler(deps({loadSource:async()=>({...source,mayConfirm:false,actualMaterialCost:null,blockers:['Missing cost evidence']})}));
 const r=await h(request(input));const b=await r.json();assert.equal(r.status,200);assert.equal(b.mayConfirm,false);assert.equal(b.reviewToken,null);
 assert.deepEqual(b.summary.blockers,['Missing cost evidence']);assert.equal(b.summary.actualMaterialCost,null);
});
test('posted usage reports original result without a second confirmation',async()=>{
 const h=createMaterialReviewHandler(deps({loadSource:async()=>({posted:true,result:{journalId:'original',transactionId:'11'}})}));
 const b=await (await h(request(input))).json();assert.equal(b.code,'ALREADY_POSTED');assert.equal(b.summary.journalId,'original');assert.equal(b.reviewToken,null);
});
test('client cost, actor, percentage, source injection, unsafe IDs and missing proof are rejected',async()=>{
 const h=createMaterialReviewHandler(deps());
 for(const patch of [{actualMaterialCost:'1'},{actorId:owner},{percentage:70},{sourceSnapshot:'fake'},
   {transactionId:11},{transactionId:'9223372036854775808'},{usageConfirmed:false},{evidenceRef:''}]){
   assert.equal((await h(request({...input,...patch}))).status,422);
 }
});
test('authorization is fresh for confirmation and roles cannot approve materials',async()=>{
 let active=true,calls=0;
 const h=createMaterialReviewHandler(deps({loadProfile:async()=>({id:owner,role:'owner',is_active:active}),submitReview:async()=>{calls++;}}));
 const b=await (await h(request(input))).json();active=false;
 assert.equal((await h(request({action:'confirm',confirmed:true,reviewToken:b.reviewToken}))).status,403);assert.equal(calls,0);
 for(const role of ['admin','cashier','baker','helper'])assert.equal((await createMaterialReviewHandler(deps({loadProfile:async()=>({id:owner,role,is_active:true})}))(request(input))).status,403);
});
test('expired, wrong-purpose and altered confirmations cannot submit',async()=>{
 const h=createMaterialReviewHandler(deps());const b=await (await h(request(input))).json();
 const old=createMaterialReviewHandler(deps({now:()=>time+300000}));
 assert.equal((await old(request({action:'confirm',confirmed:true,reviewToken:b.reviewToken}))).status,409);
 const wrong=await sealPurchaseReview({actorId:owner,kind:'MATERIAL_TO_WIP',action:'post',issuedAt:time,expiresAt:time+300000},secret+':sale-settlement-v1');
 assert.equal((await h(request({action:'confirm',confirmed:true,reviewToken:wrong}))).status,409);
 assert.equal((await h(request({action:'confirm',confirmed:true,reviewToken:b.reviewToken,quantity:'9'}))).status,422);
});
test('pool/source changes at confirmation do not claim a successful journal',async()=>{
 const h=createMaterialReviewHandler(deps({submitReview:async()=>{throw Error('secret database detail');}}));
 const b=await (await h(request(input))).json();const r=await h(request({action:'confirm',confirmed:true,reviewToken:b.reviewToken}));
 assert.equal(r.status,409);assert.equal((await r.json()).code,'SOURCE_OR_COST_CHANGED');
});
test('missing sources, oversized history, unavailable staging and untrusted origins fail closed',async()=>{
 assert.equal((await createMaterialReviewHandler(deps({loadSource:async()=>null}))(request(input))).status,404);
 assert.equal((await createMaterialReviewHandler(deps({loadSource:async()=>({...source,sourceSnapshot:'a'.repeat(24001)})}))(request(input))).status,409);
 assert.equal((await createMaterialReviewHandler(deps({stageEnabled:false}))(request(input))).status,503);
 assert.equal((await createMaterialReviewHandler(deps())(request(input,{Origin:'https://other.example'}))).status,403);
});
