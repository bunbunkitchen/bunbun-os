import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createExpenseReviewHandler } from '../supabase/functions/_shared/accountingExpenseReview.js';
import { sealPurchaseReview, openPurchaseReview } from '../supabase/functions/_shared/accountingPurchaseReview.js';
const owner='2375b60c-c418-47c2-b157-af80b262fadf';
const origin='https://staging.example';
const signingSecret='synthetic-secret-only-no-real-credentials-12345';
const now=1793740000000;
const input={action:'review-post',expenseId:'42',expenseAccount:'6050',cashAccount:'1020',evidenceRef:'RENT-PAYMENT-42',newAmount:null,nonProductionConfirmed:true};
const source={sourceSnapshot:'{"id":42,"nominal":20000,"purchase_id":null}',amount:'20000.00',date:'2026-11-04',category:'Sewa',posted:false,sourceComplete:true,periodReady:true};
const deps=(extra={})=>({stageEnabled:true,allowedOrigin:origin,signingSecret,now:()=>now,
 verifyUserToken:async token=>token==='valid.token'?{id:owner}:null,
 loadProfile:async()=>({id:owner,role:'owner',is_active:true}),loadReview:async()=>source,submitReview:async()=>({journalId:'journal-id'}),...extra});
const request=(body,extra={})=>new Request('https://edge.example/accounting-expense',{method:'POST',headers:{Origin:extra.origin||origin,'Content-Type':'application/json',
 ...(extra.token===null?{}:{Authorization:'Bearer '+(extra.token||'valid.token')})},body:JSON.stringify(body)});
async function review(handler,body=input){const r=await handler(request(body));assert.equal(r.status,200);return r.json();}
test('expense confirmation binds server snapshot, selected classification and fresh Owner',async()=>{
 let received;
 const handler=createExpenseReviewHandler(deps({submitReview:async(p,actor)=>{received={p,actor};return{journalId:'journal-id'};}}));
 const r=await review(handler);
 const response=await handler(request({action:'confirm',reviewToken:r.reviewToken,confirmed:true}));
 assert.equal(response.status,200);assert.equal(received.actor,owner);assert.equal(received.p.sourceSnapshot,source.sourceSnapshot);
 assert.equal(received.p.costScope,'PERIOD_NONPRODUCTION');assert.equal(received.p.expenseAccount,'6050');assert.equal(received.p.action,'post');
});
test('production scope, cash depreciation, stock-loss and purchase accounts cannot be submitted as period payment',async()=>{
 const handler=createExpenseReviewHandler(deps());
 assert.equal((await handler(request({...input,nonProductionConfirmed:false}))).status,422);
 for(const account of ['1210','1215','6040','6070','3000','toString',6010])assert.equal((await handler(request({...input,expenseAccount:account}))).status,422);
 assert.equal((await handler(request({...input,nominal:1}))).status,422);
});
test('linked purchases and incorrect posting state block before confirmation',async()=>{
 for(const s of [{...source,sourceComplete:false},{...source,posted:true}]){
  const handler=createExpenseReviewHandler(deps({loadReview:async()=>s}));assert.equal((await handler(request(input))).status,409);
 }
});
test('missing opening or closed period displays review without posting capability',async()=>{
 const handler=createExpenseReviewHandler(deps({loadReview:async()=>({...source,periodReady:false})}));
 const r=await review(handler);assert.equal(r.mayConfirm,false);assert.equal(r.reviewToken,null);
});
test('purchase review token cannot be reused in expense endpoint',async()=>{
 let writes=0;
 const handler=createExpenseReviewHandler(deps({submitReview:async()=>{writes++;}}));
 const token=await sealPurchaseReview({version:1,actorId:owner,issuedAt:now,expiresAt:now+300000,kind:'PERIOD_EXPENSE',action:'post'},signingSecret);
 assert.equal((await handler(request({action:'confirm',confirmed:true,reviewToken:token}))).status,409);assert.equal(writes,0);
});
test('expense tokens expire and cannot alter Owner or reviewed amount',async()=>{
 const handler=createExpenseReviewHandler(deps({loadReview:async()=>({...source,posted:true})}));
 const r=await review(handler,{...input,action:'review-correction',newAmount:'25000.00'});
 const signed=await openPurchaseReview(r.reviewToken,signingSecret+':period-expense-v1',owner,now);
 assert.equal(signed.newAmount,'25000.00');assert.equal(signed.action,'correct');
 assert.equal((await handler(request({action:'confirm',reviewToken:r.reviewToken,confirmed:true,newAmount:'1'}))).status,422);
 const expired=createExpenseReviewHandler(deps({now:()=>now+300000}));
 assert.equal((await expired(request({action:'confirm',reviewToken:r.reviewToken,confirmed:true}))).status,409);
});
test('unauthenticated and other roles cannot review; deactivated Owner cannot confirm',async()=>{
 let active=true;let reads=0;
 const handler=createExpenseReviewHandler(deps({loadProfile:async()=>({id:owner,role:'owner',is_active:active}),loadReview:async()=>{reads++;return source;}}));
 assert.equal((await handler(request(input,{token:null}))).status,401);
 assert.equal((await handler(request(input,{token:'bad.token'}))).status,401);assert.equal(reads,0);
 const r=await review(handler);active=false;
 assert.equal((await handler(request({action:'confirm',reviewToken:r.reviewToken,confirmed:true}))).status,403);
 for(const role of ['admin','cashier','baker','helper']){
  const h=createExpenseReviewHandler(deps({loadProfile:async()=>({id:owner,role,is_active:true})}));assert.equal((await h(request(input))).status,403);
 }
});
test('money precision, explicit acknowledgement, ID and transport limits are enforced',async()=>{
 const handler=createExpenseReviewHandler(deps());
 for(const newAmount of ['NaN','-1','0','1e4','1.001',25000])assert.equal((await handler(request({...input,action:'review-correction',newAmount}))).status,422);
 for(const expenseId of ['-1','9223372036854775808','1;drop table expenses',42])assert.equal((await handler(request({...input,expenseId}))).status,422);
 const r=await review(handler);assert.equal((await handler(request({action:'confirm',reviewToken:r.reviewToken,confirmed:false}))).status,422);
 assert.equal((await handler(request({...input,evidenceRef:'x'.repeat(70000)}))).status,413);
 assert.equal((await handler(request(input,{origin:'https://evil.example'}))).status,403);
 assert.equal((await createExpenseReviewHandler(deps({stageEnabled:false}))(request(input))).status,503);
});
test('source and posting failures return safe messages without claiming success',async()=>{
 assert.equal((await createExpenseReviewHandler(deps({loadReview:async()=>null}))(request(input))).status,404);
 assert.equal((await createExpenseReviewHandler(deps({loadReview:async()=>{throw Error('secret');}}))(request(input))).status,503);
 const handler=createExpenseReviewHandler(deps({submitReview:async()=>{throw Error('private source changed');}}));
 const r=await review(handler);const failed=await handler(request({action:'confirm',reviewToken:r.reviewToken,confirmed:true}));
 assert.equal(failed.status,409);assert.equal((await failed.json()).code,'SOURCE_OR_PERIOD_CHANGED');
});
