import { authorizeActiveOwner } from './accountingOwnerReadiness.js';
import { openPurchaseReview, sealPurchaseReview } from './accountingPurchaseReview.js';
const exact=(x,fields)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===[...fields].sort().join(',');
const id=x=>typeof x==='string'&&/^[1-9]\d{0,18}$/.test(x)&&BigInt(x)<=9223372036854775807n;
const money=(x,zero=false)=>typeof x==='string'&&/^\d{1,12}(\.\d{1,2})?$/.test(x)&&(zero||Number(x)>0);
const date=x=>typeof x==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(x)&&!Number.isNaN(Date.parse(x+'T00:00:00Z'))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
export function createProductionReviewHandler({stageEnabled,allowedOrigin,signingSecret,verifyUserToken,loadProfile,loadSource,submitReview,now=Date.now}){
 const reply=(body,status,origin)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',
   'X-Content-Type-Options':'nosniff',...(origin?{'Access-Control-Allow-Origin':origin}:{})}});
 return async request=>{
   const origin=request.headers.get('Origin');
   if(!stageEnabled||!allowedOrigin||typeof signingSecret!=='string'||signingSecret.length<32)return reply({code:'STAGING_NOT_CONFIGURED'},503);
   if(origin!==allowedOrigin)return reply({code:'ORIGIN_NOT_ALLOWED'},403);
   if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':origin,'Vary':'Origin',
     'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info'}});
   if(request.method!=='POST')return reply({code:'METHOD_NOT_ALLOWED'},405,origin);
   if(!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))return reply({code:'JSON_REQUIRED'},415,origin);
   const auth=await authorizeActiveOwner({authorization:request.headers.get('Authorization'),verifyUserToken,loadProfile});
   if(!auth.ok)return reply({code:auth.code},auth.status,origin);
   let input;
   try{const text=await request.text();if(new TextEncoder().encode(text).length>65536)return reply({code:'BODY_TOO_LARGE'},413,origin);input=JSON.parse(text);}
   catch{return reply({code:'INVALID_JSON'},400,origin);}
   const secret=signingSecret+':production-cost-v1';
   if(input?.action==='confirm'){
     if(!exact(input,['action','reviewToken','confirmed'])||input.confirmed!==true)return reply({code:'CONFIRMATION_REQUIRED'},422,origin);
     let review;
     try{review=await openPurchaseReview(input.reviewToken,secret,auth.userId,now());if(review.kind!=='PRODUCTION_COST'||!['post_cost','post_completion'].includes(review.action))throw Error('Wrong purpose');}
     catch{return reply({code:'REVIEW_EXPIRED_OR_CHANGED',message:'Pemeriksaan kedaluwarsa atau berubah. Periksa biaya kembali.'},409,origin);}
     try{return reply({ok:true,result:await submitReview(review,auth.userId),actualProfitAvailable:false},200,origin);}
     catch{return reply({code:'SOURCE_OR_COST_CHANGED',message:'Belum dijurnal. Sumber, sisa biaya, hasil produksi atau periode berubah; periksa kembali.'},409,origin);}
   }
   if(exact(input,['action','batchId'])&&input.action==='inspect-batch'&&id(input.batchId)){
     try{const result=await loadSource('inspect_batch',{batchId:input.batchId},auth.userId);return result?reply({ok:true,...result,actualProfitAvailable:false},200,origin):reply({code:'SOURCE_NOT_FOUND'},404,origin);}
     catch{return reply({code:'SOURCE_UNAVAILABLE'},503,origin);}
   }
   const cost=input?.action==='review-cost',completion=input?.action==='review-completion';
   const fields=cost?['action','batchId','expenseId','amount','date','costKind','cashAccount','productionConfirmed','evidenceRef']:
     ['action','batchId','date','lossPolicy','rejectCost','lotCosts','allCostsConfirmed','zeroLaborConfirmed','zeroOverheadConfirmed','evidenceRef'];
   if((!cost&&!completion)||!exact(input,fields)||!id(input.batchId)||!date(input.date)||typeof input.evidenceRef!=='string'||input.evidenceRef.trim().length<6||input.evidenceRef.trim().length>500)
     return reply({code:'INVALID_REVIEW_REQUEST'},422,origin);
   if(cost&&(!id(input.expenseId)||!money(input.amount)||!['LABOR','OVERHEAD'].includes(input.costKind)||!['1010','1020'].includes(input.cashAccount)||input.productionConfirmed!==true))
     return reply({code:'PRODUCTION_PURPOSE_REQUIRED'},422,origin);
   if(completion&&(!['ABSORB_NORMAL_LOSS','SEPARATE_ABNORMAL_LOSS'].includes(input.lossPolicy)||!money(input.rejectCost,true)||input.allCostsConfirmed!==true
     ||typeof input.zeroLaborConfirmed!=='boolean'||typeof input.zeroOverheadConfirmed!=='boolean'||!Array.isArray(input.lotCosts)||input.lotCosts.length<1||input.lotCosts.length>50
     ||input.lotCosts.some(x=>!exact(x,['splitId','amount'])||!id(x.splitId)||!money(x.amount))||new Set(input.lotCosts.map(x=>x.splitId)).size!==input.lotCosts.length))
     return reply({code:'COMPLETE_COST_REVIEW_REQUIRED'},422,origin);
   const payload={...input};delete payload.action;payload.evidenceRef=payload.evidenceRef.trim();
   let source;
   try{source=await loadSource(cost?'review_cost':'review_completion',payload,auth.userId);}
   catch{return reply({code:'SOURCE_REQUIRES_RECONCILIATION',message:'Periksa sumber pembayaran, batch Finished, hasil layak/reject dan mutasi stok asal.'},409,origin);}
   if(!source)return reply({code:'SOURCE_NOT_FOUND'},404,origin);
   if(typeof source.sourceSnapshot!=='string'||new TextEncoder().encode(source.sourceSnapshot).length>24000)return reply({code:'SOURCE_UNAVAILABLE'},409,origin);
   const issuedAt=now(),review={...payload,sourceSnapshot:source.sourceSnapshot,version:1,kind:'PRODUCTION_COST',action:cost?'post_cost':'post_completion',
     actorId:auth.userId,operationKey:crypto.randomUUID(),issuedAt,expiresAt:issuedAt+300000};
   const summary={...source};delete summary.sourceSnapshot;
   return reply({ok:true,mayConfirm:source.mayConfirm===true,reviewToken:source.mayConfirm===true?await sealPurchaseReview(review,secret):null,
     summary,actualProfitAvailable:false},200,origin);
 };
}
