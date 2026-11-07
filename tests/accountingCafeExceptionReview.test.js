import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCafeExceptionHandler} from '../supabase/functions/_shared/accountingCafeExceptionReview.js';
import {openPurchaseReview,sealPurchaseReview} from '../supabase/functions/_shared/accountingPurchaseReview.js';
const owner='2375b60c-c418-47c2-b157-af80b262fadf',reportId='95000000-0000-4000-8000-000000000001',origin='https://staging.example',secret='synthetic-cafe-exception-key-123456789',time=1793740000000;
const advance={action:'review_advance',reportId,incomeId:'17',cashAccount:'1020',evidenceRef:'CAFE-ACTUAL-EARLY-RECEIPT',allocationConfirmed:true};
const apply={action:'review_apply',reportId,incomeId:'17',applicationDate:'2026-12-31',allocations:[{saleId:'9',amount:'20'}],evidenceRef:'CAFE-APPLY-PAID-ADVANCE',allocationConfirmed:true};
const waste={action:'review_waste',reportId,productId:'3',date:'2026-12-31',allocations:[{splitId:'1',quantity:'1'}],evidenceRef:'CAFE-ACTUAL-WASTE-COUNT',lossConfirmed:true};
const deps=extra=>({stageEnabled:true,allowedOrigin:origin,signingSecret:secret,now:()=>time,verifyUserToken:async()=>({id:owner}),loadProfile:async()=>({id:owner,role:'owner',is_active:true}),loadSource:async()=>({sourceSnapshot:'a'.repeat(64),mayConfirm:true,amount:'20.00',date:'2026-12-10',quantity:1}),submitReview:async()=>({journalId:'j'}),...extra});
const req=(body,headers={})=>new Request('https://edge.example/exceptions',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Authorization:'Bearer valid.token',...headers},body:JSON.stringify(body)});
test('advance/waste reviews sign exact type, date, account/quantity and report source without client costs',async()=>{
 for(const x of [advance,apply,waste]){let written;const h=createCafeExceptionHandler(deps({submitReview:async p=>{written=p;return{journalId:'j'};}}));
  const body=await(await h(req(x))).json();assert.equal(body.summary.amount,'20.00');assert.equal(body.summary.sourceSnapshot,undefined);assert.equal(body.actualProfitAvailable,false);
  const signed=await openPurchaseReview(body.reviewToken,secret+':cafe-exceptions-v1',owner,time);assert.equal(signed.action,x.action.replace('review_','post_'));assert.equal(signed.reportId,reportId);
  assert.equal((await h(req({action:'confirm',confirmed:true,reviewToken:body.reviewToken}))).status,200);assert.equal(written.purpose,'CAFE_EXCEPTIONS');assert.equal(written.actorId,owner);
  for(const patch of [{actualCost:'1'},{actorId:owner},{percentage:70},{journalLines:[]},{physicalMovementId:'9'}])assert.equal((await h(req({...x,...patch}))).status,409);
 }
});
test('advance receipt account and full source identity require explicit confirmation',async()=>{
 const h=createCafeExceptionHandler(deps());for(const patch of [{incomeId:17},{incomeId:'9223372036854775808'},{cashAccount:'2130'},{cashAccount:''},{allocationConfirmed:false},{evidenceRef:''},{reportId:'bad'}])assert.equal((await h(req({...advance,...patch}))).status,409);
});
test('advance invoice application rejects duplicate/coerced/negative amounts and unsafe dates',async()=>{
 const h=createCafeExceptionHandler(deps());for(const patch of [{applicationDate:'2026-02-30'},{allocationConfirmed:false},{allocations:[]},{allocations:[apply.allocations[0],apply.allocations[0]]},{allocations:[{saleId:9,amount:'20'}]}])assert.equal((await h(req({...apply,...patch}))).status,409);
 for(const amount of ['0','-1','NaN','Infinity','1e3','0.001',20])assert.equal((await h(req({...apply,allocations:[{saleId:'9',amount}]}))).status,409);
});
test('waste accepts only explicit positive integer lot quantities; recipe values cannot be supplied',async()=>{
 const h=createCafeExceptionHandler(deps());for(const quantity of ['',0,'0','-1','1.5','1e3','1000000000'])assert.equal((await h(req({...waste,allocations:[{splitId:'1',quantity}]}))).status,409);
 for(const patch of [{date:'2026-02-30'},{lossConfirmed:false},{allocations:[]},{allocations:[waste.allocations[0],waste.allocations[0]]},{allocations:[{splitId:'1',quantity:'1',unitCost:'2615'}]}])assert.equal((await h(req({...waste,...patch}))).status,409);
});
test('fresh Owner revocation, actor change, expiration, purpose and exact confirmation guards apply to advance/waste',async()=>{
 let active=true,writes=0;const h=createCafeExceptionHandler(deps({loadProfile:async()=>({id:owner,role:'owner',is_active:active}),submitReview:async()=>{writes++;}}));
 const body=await(await h(req(waste))).json(),confirm={action:'confirm',reviewToken:body.reviewToken,confirmed:true};active=false;assert.equal((await h(req(confirm))).status,403);assert.equal(writes,0);active=true;
 assert.equal((await h(req({...confirm,amount:'1'}))).status,409);
 assert.equal((await createCafeExceptionHandler(deps({now:()=>time+300000}))(req(confirm))).status,409);
 const wrong=await sealPurchaseReview({version:1,purpose:'CAFE_LEDGER',action:'post_waste',actorId:owner,issuedAt:time,expiresAt:time+300000},secret+':cafe-exceptions-v1');assert.equal((await h(req({...confirm,reviewToken:wrong}))).status,409);
});
test('backend overdraw/lot/date/closed-period/stale failure does not report success or leak sources',async()=>{
 const h=createCafeExceptionHandler(deps({submitReview:async()=>{throw Error('PRIVATE_SQL_DETAILS');}}));const body=await(await h(req(apply))).json();const r=await h(req({action:'confirm',reviewToken:body.reviewToken,confirmed:true}));assert.equal(r.status,409);assert.ok(!(await r.text()).includes('PRIVATE_SQL_DETAILS'));
});
test('staging/origin/session and bounded body guards run before private source loading',async()=>{
 let reads=0;const d=deps({loadSource:async()=>{reads++;return{};}});
 assert.equal((await createCafeExceptionHandler({...d,stageEnabled:false})(req(waste))).status,503);
 assert.equal((await createCafeExceptionHandler(d)(req(waste,{Origin:'https://evil.example'}))).status,403);
 assert.equal((await createCafeExceptionHandler({...d,verifyUserToken:async()=>{throw Error();}})(req(waste))).status,401);
 assert.equal((await createCafeExceptionHandler(d)(req({...waste,evidenceRef:'a'.repeat(25000)}))).status,413);assert.equal(reads,0);
});
