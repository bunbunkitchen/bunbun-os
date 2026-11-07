import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCafeLedgerHandler} from '../supabase/functions/_shared/accountingCafeLedgerReview.js';
import {sealPurchaseReview,openPurchaseReview} from '../supabase/functions/_shared/accountingPurchaseReview.js';
const owner='2375b60c-c418-47c2-b157-af80b262fadf',reportId='94000000-0000-4000-8000-000000000001',origin='https://staging.example',secret='synthetic-cafe-ledger-key-1234567890',time=1793740000000;
const input={action:'review_import',reportId,mode:'CREATE',saleDate:'2026-11-30',existingSaleIds:[],actualSoldConfirmed:true,evidenceRef:'CAFE-ACTUAL-SOLD-EVIDENCE'};
const receipt={action:'review_receipt',reportId,incomeId:'17',cashAccount:'1020',evidenceRef:'CAFE-NET-DEPOSIT-EVIDENCE'};
const deps=extra=>({stageEnabled:true,allowedOrigin:origin,signingSecret:secret,now:()=>time,verifyUserToken:async()=>({id:owner}),loadProfile:async()=>({id:owner,role:'owner',is_active:true}),loadSource:async()=>({sourceSnapshot:'a'.repeat(64),mayConfirm:true,netEntitlement:'120.00',allocations:[{saleId:'9',amount:'120.00'}]}),submitReview:async()=>({saleIds:['9']}),...extra});
const req=(body,headers={})=>new Request('https://edge.example/cafe-ledger',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Authorization:'Bearer valid.token',...headers},body:JSON.stringify(body)});
test('signed review binds report, sold evidence, date, choices, source and active Owner; no client totals',async()=>{
 let posted;const h=createCafeLedgerHandler(deps({submitReview:async p=>{posted=p;return{saleIds:['9']};}}));
 const body=await(await h(req(input))).json();assert.equal(body.summary.netEntitlement,'120.00');assert.equal(body.summary.sourceSnapshot,undefined);assert.equal(body.actualProfitAvailable,false);
 const signed=await openPurchaseReview(body.reviewToken,secret+':cafe-ledger-v1',owner,time);assert.equal(signed.action,'post_import');assert.equal(signed.reportId,reportId);assert.equal(signed.saleDate,'2026-11-30');assert.equal(signed.sourceSnapshot,'a'.repeat(64));
 const result=await h(req({action:'confirm',reviewToken:body.reviewToken,confirmed:true}));assert.equal(result.status,200);assert.equal(posted.purpose,'CAFE_LEDGER');assert.equal(posted.netEntitlement,undefined);
 for(const patch of [{netEntitlement:'1'},{actorId:owner},{journalLines:[]},{stockMovementId:'1'},{percentage:70}])assert.equal((await h(req({...input,...patch}))).status,409);
});
test('net receipt review signs explicit actual account and income identity without percentages',async()=>{
 const h=createCafeLedgerHandler(deps());const body=await(await h(req(receipt))).json();const token=await openPurchaseReview(body.reviewToken,secret+':cafe-ledger-v1',owner,time);
 assert.equal(token.action,'post_receipt');assert.equal(token.cashAccount,'1020');assert.equal(token.incomeId,'17');assert.equal(body.summary.netEntitlement,'120.00');
 for(const patch of [{cashAccount:''},{cashAccount:'4010'},{incomeId:17},{incomeId:'9223372036854775808'},{evidenceRef:''}])assert.equal((await h(req({...receipt,...patch}))).status,409);
});
test('existing invoice linking is explicit and unique; unsafe dates/IDs and missing sold confirmation fail',async()=>{
 const h=createCafeLedgerHandler(deps());assert.equal((await h(req({...input,mode:'LINK',existingSaleIds:['1','2']}))).status,200);
 for(const patch of [{mode:'LINK'},{mode:'CREATE',existingSaleIds:['1']},{mode:'LINK',existingSaleIds:['1','1']},{mode:'LINK',existingSaleIds:['1e3']},{saleDate:'2026-02-30'},{actualSoldConfirmed:false},{reportId:'not-uuid'}])assert.equal((await h(req({...input,...patch}))).status,409);
});
test('fresh role revocation blocks a previously signed confirmation',async()=>{
 let active=true,writes=0;const h=createCafeLedgerHandler(deps({loadProfile:async()=>({id:owner,role:'owner',is_active:active}),submitReview:async()=>{writes++;}}));
 const body=await(await h(req(input))).json();active=false;assert.equal((await h(req({action:'confirm',reviewToken:body.reviewToken,confirmed:true}))).status,403);assert.equal(writes,0);
});
test('wrong purpose, expired review, changed actor and injected confirmation choices fail',async()=>{
 const h=createCafeLedgerHandler(deps());const body=await(await h(req(input))).json();const confirm={action:'confirm',reviewToken:body.reviewToken,confirmed:true};
 assert.equal((await h(req({...confirm,cashAccount:'1010'}))).status,409);
 const expired=createCafeLedgerHandler(deps({now:()=>time+300000}));assert.equal((await expired(req(confirm))).status,409);
 const wrong=await sealPurchaseReview({version:1,purpose:'CAFE_FACTS',actorId:owner,action:'post_import',issuedAt:time,expiresAt:time+300000},secret+':cafe-ledger-v1');assert.equal((await h(req({...confirm,reviewToken:wrong}))).status,409);
 const other='2375b60c-c418-47c2-b157-af80b262fadd';const changed=createCafeLedgerHandler(deps({verifyUserToken:async()=>({id:other}),loadProfile:async()=>({id:other,role:'owner',is_active:true})}));assert.equal((await changed(req(confirm))).status,409);
});
test('backend mismatch, incomplete report, duplicate shipment-shaped sale and closed periods cannot return a successful post',async()=>{
 const h=createCafeLedgerHandler(deps({submitReview:async()=>{throw Error('Internal financial source details must not leak');}}));const body=await(await h(req(input))).json();const result=await h(req({action:'confirm',reviewToken:body.reviewToken,confirmed:true}));assert.equal(result.status,409);assert.ok(!(await result.text()).includes('Internal'));
 for(const source of [{mayConfirm:false,sourceSnapshot:'a'.repeat(64)},{mayConfirm:true,sourceSnapshot:'bad'}])assert.equal((await createCafeLedgerHandler(deps({loadSource:async()=>source}))(req(input))).status,409);
});
test('staging/origin/session and body guards run before private source loads',async()=>{
 let reads=0;const d=deps({loadSource:async()=>{reads++;return{};}});
 assert.equal((await createCafeLedgerHandler({...d,stageEnabled:false})(req(input))).status,503);
 assert.equal((await createCafeLedgerHandler(d)(req(input,{Origin:'https://evil.example'}))).status,403);
 assert.equal((await createCafeLedgerHandler({...d,verifyUserToken:async()=>{throw Error('bad');}})(req(input))).status,401);
 assert.equal((await createCafeLedgerHandler(d)(req({...input,evidenceRef:'a'.repeat(17000)}))).status,413);assert.equal(reads,0);
});
