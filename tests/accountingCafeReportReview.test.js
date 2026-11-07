import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateCafeReport,reconcileCafeReport} from '../supabase/functions/_shared/accountingCafeReport.js';
import {createCafeReportHandler} from '../supabase/functions/_shared/accountingCafeReportReview.js';
const owner='2375b60c-c418-47c2-b157-af80b262fadf',origin='https://staging.example',secret='synthetic-cafe-signing-secret-1234567890',now=1793740000000;
const row={productId:'1',openingQty:'0',receivedQty:'6',regularQty:'2',bundleQty:'1',discountQty:'1',wasteQty:'0',returnedQty:'1',closingQty:'1',regularNet:'40',bundleNet:'20',discountNet:'20'};
const input={month:'2026-11',cafeKey:'PUBLIC_HUB',asOfDate:'2026-12-05',expectedReportId:null,openingEvidenceRef:'COUNT-2026-11-01',evidenceRef:'CAFE-REPORT-2026-11',factsConfirmed:true,confirmedUnpaid:'0',confirmedCredit:'0',shipmentIds:['11'],returnIds:['12'],receipts:[{incomeId:'3',amount:'80'}],rows:[row]};
const source={fingerprint:'abc',products:[{id:'1'}],previousReportId:null,previousRows:[],movements:[{id:'11',type:'CAFE_OUT',productId:'1',quantity:'6',cafeKey:'PUBLIC_HUB'},{id:'12',type:'CAFE_IN',productId:'1',quantity:'1',cafeKey:'PUBLIC_HUB'}],incomes:[{id:'3',date:'2026-12-02',net:'120',usedElsewhere:'40',percentage:70}]};
const req=body=>new Request('https://edge.example/report',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Authorization:'Bearer valid.token'},body:JSON.stringify(body)});
const deps=extra=>({stageEnabled:true,allowedOrigin:origin,signingSecret:secret,now:()=>now,verifyUserToken:async()=>({id:owner}),loadProfile:async()=>({id:owner,role:'owner',is_active:true}),loadSource:async()=>source,submitReview:async()=>({revision:1}),...extra});
test('net receipts are used in full, normal/bundle/discount categories reconcile without percentages',()=>{
 const r=reconcileCafeReport(input,source);assert.equal(r.receipts,'80.00');assert.equal(r.entitlement,'80.00');assert.equal(r.paymentVariance,'0.00');assert.equal(r.factsMatch,true);assert.equal(r.rows[0].soldQty,'4');assert.equal(r.wasteQty,'0');assert.equal(r.readyToClose,false);assert.equal(r.actualProfitAvailable,false);
});
test('cash variance never creates waste; known unpaid balance explains the difference',()=>{
 const x={...input,receipts:[{incomeId:'3',amount:'56'}]};let r=reconcileCafeReport(x,source);assert.equal(r.paymentVariance,'24.00');assert.equal(r.wasteQty,'0');assert.equal(r.factsMatch,false);
 r=reconcileCafeReport({...x,confirmedUnpaid:'24'},source);assert.equal(r.paymentVariance,'0.00');assert.equal(r.factsMatch,true);
});
test('confirmed credit has the correct sign, cents stay exact',()=>{
 const x={...input,rows:[{...row,regularNet:'40.01'}],receipts:[{incomeId:'3',amount:'80.02'}],confirmedCredit:'0.01'};
 const r=reconcileCafeReport(x,{...source,incomes:[{...source.incomes[0],usedElsewhere:'0'}]});assert.equal(r.paymentVariance,'0.00');assert.equal(r.entitlement,'80.01');
});
test('unknown blank values, coercions, duplicate products, unsafe precision and invented fields fail',()=>{
 for(const patch of [{confirmedUnpaid:''},{confirmedCredit:null},{factsConfirmed:false},{percentage:70},{asOfDate:'2026-11-20'},{month:'2026-13'},{cafeKey:'CAFE_OTHER'},{asOfDate:'2026-02-30'},{rows:[row,row]}])assert.throws(()=>validateCafeReport({...input,...patch}));
 for(const value of ['',null,1,'-1','1e3','1.5','1000000000'])assert.throws(()=>validateCafeReport({...input,rows:[{...row,wasteQty:value}]}));
 for(const amount of ['NaN','Infinity','0.001','-0.01'])assert.throws(()=>validateCafeReport({...input,rows:[{...row,regularNet:amount}]}));
 assert.throws(()=>validateCafeReport({...input,rows:[{...row,regularQty:'0'}]}));
});
test('zero-price promo is explicit and is not replaced by master retail price',()=>{
 assert.equal(reconcileCafeReport({...input,rows:[{...row,bundleNet:'0'}],receipts:[{incomeId:'3',amount:'60'}]},source).entitlement,'60.00');
});
test('external stock facts, source quantities and prior-month closing have separate differences',()=>{
 const r=reconcileCafeReport({...input,rows:[{...row,openingQty:'2',receivedQty:'8',returnedQty:'0'}]}, {...source,previousReportId:'previous',previousRows:[{productId:'1',closingQty:'1'}]});
 assert.equal(r.rows[0].stockVariance,'5');assert.equal(r.rows[0].receivedVariance,'2');assert.equal(r.rows[0].returnVariance,'-1');assert.equal(r.rows[0].openingVariance,'1');assert.equal(r.factsMatch,false);
});
test('omitted known/unknown movements and prior closing products remain unresolved',()=>{
 const r=reconcileCafeReport(input,{...source,previousRows:[{productId:'2',closingQty:'2'}],movements:[...source.movements,{id:'13',cafeKey:'PUBLIC_HUB'},{id:'14',cafeKey:''}]});
 assert.equal(r.issues.length,3);assert.equal(r.factsMatch,false);
});
test('missing/wrong-type/cross-cafe/refund movement and overallocated/deleted/future receipts fail',()=>{
 for(const change of [{shipmentIds:['12']},{shipmentIds:['99']}])assert.throws(()=>reconcileCafeReport({...input,...change},source));
 for(const patch of [{cafeKey:'PUBLIC_COFFEE'},{excluded:true}])assert.throws(()=>reconcileCafeReport(input,{...source,movements:[{...source.movements[0],...patch},source.movements[1]]}));
 for(const incomes of [[],[{...source.incomes[0],usedElsewhere:'41'}],[{...source.incomes[0],date:'2026-12-06'}]])assert.throws(()=>reconcileCafeReport(input,{...source,incomes}));
});
test('signed review binds Owner, source fingerprint, facts and server summary; client summaries fail',async()=>{
 let saved;const h=createCafeReportHandler(deps({submitReview:async x=>{saved=x;return{revision:1};}}));
 const b=await (await h(req({action:'review',input}))).json();assert.ok(b.reviewToken);
 assert.equal((await h(req({action:'confirm',reviewToken:b.reviewToken,confirmed:true}))).status,200);assert.equal(saved.fingerprint,'abc');assert.equal(saved.summary.receipts,'80.00');
 assert.equal((await h(req({action:'review',input,summary:{}}))).status,409);
 assert.equal((await h(req({action:'confirm',reviewToken:b.reviewToken,confirmed:true,summary:{}}))).status,409);
});
test('review expires and fresh revoked/changed Owner prevents confirmation',async()=>{
 let active=true;const h=createCafeReportHandler(deps({loadProfile:async()=>({id:owner,role:'owner',is_active:active})}));
 const b=await (await h(req({action:'review',input}))).json();active=false;assert.equal((await h(req({action:'confirm',reviewToken:b.reviewToken,confirmed:true}))).status,403);
 const expired=createCafeReportHandler(deps({now:()=>now+300001}));assert.equal((await expired(req({action:'confirm',reviewToken:b.reviewToken,confirmed:true}))).status,409);
 const other=createCafeReportHandler(deps({verifyUserToken:async()=>({id:'2375b60c-c418-47c2-b157-af80b262fadd'}),loadProfile:async()=>({id:'2375b60c-c418-47c2-b157-af80b262fadd',role:'owner',is_active:true})}));assert.equal((await other(req({action:'confirm',reviewToken:b.reviewToken,confirmed:true}))).status,409);
});
test('backend stale/closed/receipt-cap rejection never reports a saved report',async()=>{
 const h=createCafeReportHandler(deps({submitReview:async()=>{throw Error('Source changed');}}));const b=await (await h(req({action:'review',input}))).json();assert.equal((await h(req({action:'confirm',reviewToken:b.reviewToken,confirmed:true}))).status,409);
});
test('origin/staging/auth guards apply before loading private sources',async()=>{
 let reads=0;const d=deps({loadSource:async()=>{reads++;return source;}});
 assert.equal((await createCafeReportHandler({...d,stageEnabled:false})(req({action:'review',input}))).status,503);
 assert.equal((await createCafeReportHandler({...d,allowedOrigin:'https://other.example'})(req({action:'review',input}))).status,403);
 assert.equal((await createCafeReportHandler({...d,verifyUserToken:async()=>{throw Error('bad');}})(req({action:'review',input}))).status,401);assert.equal(reads,0);
});
