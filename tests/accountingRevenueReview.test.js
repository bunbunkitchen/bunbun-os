import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRevenueReviewHandler, revenueMoneyToCents } from '../supabase/functions/_shared/accountingRevenueReview.js';
import { openPurchaseReview, sealPurchaseReview } from '../supabase/functions/_shared/accountingPurchaseReview.js';
const owner='2375b60c-c418-47c2-b157-af80b262fadf', origin='https://staging.example';
const secret='synthetic-revenue-secret-not-real-credentials-12345', time=1793740000000;
const sale={action:'review-sale',saleId:'41',recordedBasis:'GROSS_CAFE',netEntitlement:'70000.00',soldConfirmed:true,evidenceRef:'SOLD-PROOF-41'};
const income={action:'review-income',incomeId:'51',cashAccount:'1020',allocationConfirmed:true,evidenceRef:'BANK-PROOF-51',allocations:[{saleId:'41',amount:'30000.00'}]};
const saleSource={sourceSnapshot:'{"sale":{"id":41,"total_amount":100000},"items":[]}',date:'2026-11-04',channel:'PUBLIC_HUB',total:'100000.00',sourceComplete:true,posted:false,periodReady:true};
const incomeSource={sourceSnapshot:'{"id":51,"pemasukan_bunbun":30000,"persentase_bunbun":70}',date:'2026-11-05',amount:'30000.00',sourceComplete:true,posted:false,periodReady:true};
const receivables=[{saleId:'41',date:'2026-11-04',channel:'PUBLIC_HUB',outstanding:'70000.00',entitlement:'70000.00',cogsStatus:'PENDING_VALUATION'}];
const deps=(extra={})=>({stageEnabled:true,allowedOrigin:origin,signingSecret:secret,now:()=>time,
 verifyUserToken:async token=>token==='valid.token'?{id:owner}:null,
 loadProfile:async()=>({id:owner,role:'owner',is_active:true}),
 loadSource:async action=>action==='review_sale'?saleSource:incomeSource,
 loadReceivables:async()=>({receivables,actualProfitAvailable:false}),submitReview:async()=>({journalId:'posted'}),...extra});
const request=(body,opts={})=>new Request('https://edge.example/accounting-revenue',{method:'POST',headers:{Origin:opts.origin||origin,'Content-Type':'application/json',
 ...(opts.token===null?{}:{Authorization:'Bearer '+(opts.token||'valid.token')})},body:JSON.stringify(body)});
async function inspect(handler,input=sale){const r=await handler(request(input));assert.equal(r.status,200);return r.json();}
test('sale recognition signs actual source and confirmed net entitlement, never an automatic percentage',async()=>{
 let posted;
 const handler=createRevenueReviewHandler(deps({submitReview:async(p,actor)=>{posted={p,actor};return{journalId:'posted'};}}));
 const r=await inspect(handler);
 assert.equal(r.summary.netEntitlement,'70000.00');assert.equal(r.summary.cogsStatus,'PENDING_VALUATION');assert.equal(r.actualProfitAvailable,false);
 assert.equal((await handler(request({action:'confirm',confirmed:true,reviewToken:r.reviewToken}))).status,200);
 assert.equal(posted.actor,owner);assert.equal(posted.p.sourceSnapshot,saleSource.sourceSnapshot);assert.equal(posted.p.netEntitlement,'70000.00');
 assert.equal(posted.p.action,'post_sale');assert.equal(posted.p.soldConfirmed,true);
});
test('unconfirmed delivery, net-basis mismatch, excessive entitlement and extra client journal fields fail',async()=>{
 const handler=createRevenueReviewHandler(deps());
 assert.equal((await handler(request({...sale,soldConfirmed:false}))).status,422);
 assert.equal((await handler(request({...sale,recordedBasis:'NET_BUNBUN'}))).status,409);
 assert.equal((await handler(request({...sale,netEntitlement:'100000.01'}))).status,409);
 assert.equal((await handler(request({...sale,journalLines:[]}))).status,422);
 const correct=await inspect(handler,{...sale,recordedBasis:'NET_BUNBUN',netEntitlement:'100000.00'});
 assert.equal(correct.summary.netEntitlement,'100000.00');
});
test('partial receipt is allocated at actual net cash, without applying the stored 70 percent again',async()=>{
 const handler=createRevenueReviewHandler(deps());
 const r=await inspect(handler,income);
 assert.equal(r.summary.netReceipt,'30000.00');assert.equal(r.summary.allocations[0].amount,'30000.00');
 const token=await openPurchaseReview(r.reviewToken,secret+':sale-settlement-v1',owner,time);
 assert.equal(token.action,'post_income');assert.equal(token.allocations[0].amount,'30000.00');
 assert.equal(token.sourceSnapshot,incomeSource.sourceSnapshot);
 assert.equal((await handler(request({...income,allocations:[{saleId:'41',amount:'21000'}]}))).status,409);
});
test('one receipt can settle several confirmed invoices with an exact total',async()=>{
 const handler=createRevenueReviewHandler(deps({loadReceivables:async()=>({receivables:[...receivables,{saleId:'42',date:'2026-11-04',channel:'PUBLIC_COFFEE',outstanding:'20000'}]})}));
 const r=await inspect(handler,{...income,allocations:[{saleId:'41',amount:'10000'},{saleId:'42',amount:'20000'}]});
 assert.equal(r.summary.allocations.length,2);assert.equal(r.summary.allocations[1].channel,'PUBLIC_COFFEE');
});
test('duplicate invoice, unposted invoice, overpayment and deposit before sale are blocked',async()=>{
 const handler=createRevenueReviewHandler(deps());
 assert.equal((await handler(request({...income,allocations:[{saleId:'41',amount:'15000'},{saleId:'41',amount:'15000'}]}))).status,422);
 assert.equal((await handler(request({...income,allocations:[{saleId:'999',amount:'30000'}]}))).status,409);
 const over=createRevenueReviewHandler(deps({loadReceivables:async()=>({receivables:[{...receivables[0],outstanding:'20000'}]})}));
 assert.equal((await over(request(income))).status,409);
 const early=createRevenueReviewHandler(deps({loadSource:async()=>({...incomeSource,date:'2026-11-03'})}));
 assert.equal((await early(request(income))).status,409);
});
test('confirm rechecks fresh Owner and handles a changed receivable without claiming posting',async()=>{
 let active=true,writes=0;
 const handler=createRevenueReviewHandler(deps({loadProfile:async()=>({id:owner,role:'owner',is_active:active}),submitReview:async()=>{writes++;throw Error('Balance changed');}}));
 const r=await inspect(handler,income);active=false;
 assert.equal((await handler(request({action:'confirm',confirmed:true,reviewToken:r.reviewToken}))).status,403);assert.equal(writes,0);
 active=true;const response=await handler(request({action:'confirm',confirmed:true,reviewToken:r.reviewToken}));
 assert.equal(response.status,409);assert.equal((await response.json()).code,'SOURCE_OR_BALANCE_CHANGED');
});
test('no opening yields inspection without confirmation, and already-posted sources are rejected',async()=>{
 const blocked=createRevenueReviewHandler(deps({loadSource:async()=>({...saleSource,periodReady:false})}));
 const r=await inspect(blocked);assert.equal(r.mayConfirm,false);assert.equal(r.reviewToken,null);
 for(const patch of [{posted:true},{sourceComplete:false}]){
  const h=createRevenueReviewHandler(deps({loadSource:async()=>({...saleSource,...patch})}));assert.equal((await h(request(sale))).status,409);
 }
});
test('review signatures are purpose-bound, expire and reject altered confirmations',async()=>{
 const handler=createRevenueReviewHandler(deps());const r=await inspect(handler);
 const token=await sealPurchaseReview({version:1,actorId:owner,kind:'REVENUE_AND_SETTLEMENT',action:'post_sale',issuedAt:time,expiresAt:time+300000},secret);
 assert.equal((await handler(request({action:'confirm',confirmed:true,reviewToken:token}))).status,409);
 const expired=createRevenueReviewHandler(deps({now:()=>time+300000}));
 assert.equal((await expired(request({action:'confirm',confirmed:true,reviewToken:r.reviewToken}))).status,409);
 assert.equal((await handler(request({action:'confirm',confirmed:true,reviewToken:r.reviewToken,netEntitlement:'1'}))).status,422);
 assert.equal((await handler(request({action:'confirm',confirmed:false,reviewToken:r.reviewToken}))).status,422);
});
test('receivable list is Owner-only and never advertises complete actual profit',async()=>{
 const handler=createRevenueReviewHandler(deps());const r=await inspect(handler,{action:'receivables'});
 assert.equal(r.receivables.length,1);assert.equal(r.actualProfitAvailable,false);
 assert.equal((await handler(request({action:'receivables'},{token:null}))).status,401);
 for(const role of ['admin','cashier','baker','helper']){
  const h=createRevenueReviewHandler(deps({loadProfile:async()=>({id:owner,role,is_active:true})}));assert.equal((await h(request({action:'receivables'}))).status,403);
 }
});
test('bounded decimal amounts and IDs reject coercion, exponents and forged allocation fields',async()=>{
 const handler=createRevenueReviewHandler(deps());
 assert.equal(revenueMoneyToCents('0.10')+revenueMoneyToCents('0.20'),30n);
 for(const netEntitlement of [70000,'NaN','1e4','0','-1','1.001'])assert.equal((await handler(request({...sale,netEntitlement}))).status,422);
 for(const saleId of [41,'-1','9223372036854775808'])assert.equal((await handler(request({...sale,saleId}))).status,422);
 assert.equal((await handler(request({...income,allocations:[{saleId:'41',amount:'30000',outstanding:'99999'}]}))).status,422);
});
test('source lookup failures, missing source, disabled target and wrong origin fail closed',async()=>{
 assert.equal((await createRevenueReviewHandler(deps({loadSource:async()=>null}))(request(sale))).status,404);
 assert.equal((await createRevenueReviewHandler(deps({loadSource:async()=>{throw Error('secret');}}))(request(sale))).status,503);
 assert.equal((await createRevenueReviewHandler(deps({stageEnabled:false}))(request(sale))).status,503);
 assert.equal((await createRevenueReviewHandler(deps())(request(sale,{origin:'https://evil.example'}))).status,403);
});
