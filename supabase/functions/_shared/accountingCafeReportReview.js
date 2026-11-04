import {authorizeActiveOwner} from './accountingOwnerReadiness.js';
import {openPurchaseReview,sealPurchaseReview} from './accountingPurchaseReview.js';
import {validateCafeReport,reconcileCafeReport} from './accountingCafeReport.js';
export function createCafeReportHandler({stageEnabled,allowedOrigin,signingSecret,verifyUserToken,loadProfile,loadSource,submitReview,now=Date.now}){
 const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','X-Content-Type-Options':'nosniff',...(allowedOrigin?{'Access-Control-Allow-Origin':allowedOrigin}:{})}});
 return async request=>{
  if(!stageEnabled||!allowedOrigin||!signingSecret||signingSecret.length<32)return reply({code:'STAGING_NOT_CONFIGURED'},503);
  if(request.headers.get('Origin')!==allowedOrigin)return reply({code:'ORIGIN_NOT_ALLOWED'},403);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':allowedOrigin,'Vary':'Origin','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info'}});
  if(request.method!=='POST')return reply({code:'METHOD_NOT_ALLOWED'},405);
  const auth=await authorizeActiveOwner({authorization:request.headers.get('Authorization'),verifyUserToken,loadProfile});
  if(!auth.ok)return reply({code:auth.code},auth.status);
  if(!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))return reply({code:'JSON_REQUIRED'},415);
  let x;try{const body=await request.text();if(new TextEncoder().encode(body).length>60000)return reply({code:'BODY_TOO_LARGE'},413);x=JSON.parse(body);}catch{return reply({code:'INVALID_JSON'},400);}
  try{
   if(x.action==='inspect'&&Object.keys(x).sort().join(',')==='action,cafeKey,month')return reply({ok:true,...await loadSource('inspect',{month:x.month,cafeKey:x.cafeKey},auth.userId)});
   const secret=signingSecret+':cafe-facts-v1';
   if(x.action==='confirm'){
    if(Object.keys(x).sort().join(',')!=='action,confirmed,reviewToken'||x.confirmed!==true)throw Error('Konfirmasi laporan diperlukan.');
    const review=await openPurchaseReview(x.reviewToken,secret,auth.userId,now());
    if(review.purpose!=='CAFE_FACTS')throw Error('Periksa laporan kembali.');
    validateCafeReport(review.input);
    const result=await submitReview(review,auth.userId);
    return reply({ok:true,result,actualProfitAvailable:false});
   }
   if(x.action!=='review'||Object.keys(x).sort().join(',')!=='action,input')throw Error('Permintaan laporan tidak valid.');
   validateCafeReport(x.input);
   const source=await loadSource('review',x.input,auth.userId),summary=reconcileCafeReport(x.input,source);
   const issuedAt=now(),review={version:1,purpose:'CAFE_FACTS',actorId:auth.userId,input:x.input,summary,fingerprint:source.fingerprint,operationKey:crypto.randomUUID(),issuedAt,expiresAt:issuedAt+300000};
   const reviewToken=await sealPurchaseReview(review,secret);
   if(reviewToken.length>55000)throw Error('Laporan terlalu besar. Kurangi jumlah produk atau sumber per pemeriksaan.');
   return reply({ok:true,summary,reviewToken});
  }catch(error){return reply({code:'REPORT_REQUIRES_REVIEW',message:error instanceof Error?error.message:'Periksa sumber, periode, dan laporan kembali.'},409);}
 };
}
