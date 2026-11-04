import {authorizeActiveOwner} from './accountingOwnerReadiness.js';
import {sealPurchaseReview,openPurchaseReview} from './accountingPurchaseReview.js';
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===[...keys].sort().join(',');
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(x);
const id=x=>typeof x==='string'&&/^[1-9]\d{0,18}$/.test(x)&&BigInt(x)<=9223372036854775807n;
const date=x=>typeof x==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(x)&&!Number.isNaN(Date.parse(x+'T00:00:00Z'))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
const money=x=>typeof x==='string'&&/^\d{1,12}(\.\d{1,2})?$/.test(x)&&Number(x)>0;
const fields={review_advance:['incomeId','cashAccount','allocationConfirmed'],review_apply:['incomeId','applicationDate','allocations','allocationConfirmed'],review_waste:['productId','date','allocations','lossConfirmed']};
export function createCafeExceptionHandler({stageEnabled,allowedOrigin,signingSecret,verifyUserToken,loadProfile,loadSource,submitReview,now=Date.now}){
 const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','X-Content-Type-Options':'nosniff',...(allowedOrigin?{'Access-Control-Allow-Origin':allowedOrigin}:{})}});
 return async request=>{
  if(!stageEnabled||!allowedOrigin||!signingSecret||signingSecret.length<32)return reply({code:'STAGING_NOT_CONFIGURED'},503);
  if(request.headers.get('Origin')!==allowedOrigin)return reply({code:'ORIGIN_NOT_ALLOWED'},403);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':allowedOrigin,'Vary':'Origin','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info'}});
  if(request.method!=='POST')return reply({code:'METHOD_NOT_ALLOWED'},405);
  const auth=await authorizeActiveOwner({authorization:request.headers.get('Authorization'),verifyUserToken,loadProfile});if(!auth.ok)return reply({code:auth.code},auth.status);
  if(!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))return reply({code:'JSON_REQUIRED'},415);
  let x;try{const body=await request.text();if(new TextEncoder().encode(body).length>24000)return reply({code:'BODY_TOO_LARGE'},413);x=JSON.parse(body);}catch{return reply({code:'INVALID_JSON'},400);}
  const secret=signingSecret+':cafe-exceptions-v1';
  try{
   if(exact(x,['action','reportId'])&&x.action==='inspect'&&uuid(x.reportId))return reply({ok:true,...await loadSource('inspect',{reportId:x.reportId},auth.userId)});
   if(x?.action==='confirm'){
    if(!exact(x,['action','reviewToken','confirmed'])||x.confirmed!==true)throw Error();
    const review=await openPurchaseReview(x.reviewToken,secret,auth.userId,now());
    if(review.purpose!=='CAFE_EXCEPTIONS'||!['post_advance','post_apply','post_waste'].includes(review.action))throw Error();
    return reply({ok:true,result:await submitReview(review,auth.userId),actualProfitAvailable:false});
   }
   const keys=fields[x?.action];
   if(!keys||!exact(x,['action','reportId','evidenceRef',...keys])||!uuid(x.reportId)||typeof x.evidenceRef!=='string'||x.evidenceRef.trim().length<6||x.evidenceRef.length>500)throw Error();
   if(x.action==='review_advance'&&(!id(x.incomeId)||!['1010','1020'].includes(x.cashAccount)||x.allocationConfirmed!==true))throw Error();
   if(x.action==='review_apply'&&(!id(x.incomeId)||!date(x.applicationDate)||x.allocationConfirmed!==true||!Array.isArray(x.allocations)||x.allocations.length<1||x.allocations.length>50||x.allocations.some(a=>!exact(a,['saleId','amount'])||!id(a.saleId)||!money(a.amount))||new Set(x.allocations.map(a=>a.saleId)).size!==x.allocations.length))throw Error();
   if(x.action==='review_waste'&&(!id(x.productId)||!date(x.date)||x.lossConfirmed!==true||!Array.isArray(x.allocations)||x.allocations.length<1||x.allocations.length>50||x.allocations.some(a=>!exact(a,['splitId','quantity'])||!id(a.splitId)||typeof a.quantity!=='string'||!/^\d{1,9}$/.test(a.quantity)||BigInt(a.quantity)<=0n)||new Set(x.allocations.map(a=>a.splitId)).size!==x.allocations.length))throw Error();
   const payload={...x};delete payload.action;payload.evidenceRef=payload.evidenceRef.trim();
   const source=await loadSource(x.action,payload,auth.userId);
   if(source?.mayConfirm!==true||typeof source.sourceSnapshot!=='string'||!/^[a-f0-9]{64}$/.test(source.sourceSnapshot))throw Error();
   const issuedAt=now(),review={...payload,sourceSnapshot:source.sourceSnapshot,action:x.action.replace('review_','post_'),purpose:'CAFE_EXCEPTIONS',version:1,actorId:auth.userId,operationKey:crypto.randomUUID(),issuedAt,expiresAt:issuedAt+300000};
   const summary={...source};delete summary.sourceSnapshot;
   return reply({ok:true,summary,reviewToken:await sealPurchaseReview(review,secret),actualProfitAvailable:false});
  }catch{return reply({code:'CAFE_EXCEPTION_REQUIRES_RECONCILIATION',message:'Belum dijurnal. Periksa nominal setoran penuh, bagian setiap laporan, saldo uang muka/piutang, jumlah waste dan lot kafe yang benar, tanggal serta periode terbuka. Sumber yang berubah harus diperiksa ulang.'},409);}
 };
}
