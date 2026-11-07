import {authorizeActiveOwner} from './accountingOwnerReadiness.js';
import {openPurchaseReview,sealPurchaseReview} from './accountingPurchaseReview.js';
const exact=(x,fields)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===[...fields].sort().join(',');
const id=x=>typeof x==='string'&&/^[1-9]\d{0,18}$/.test(x)&&BigInt(x)<=9223372036854775807n;
const date=x=>typeof x==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(x)&&!Number.isNaN(Date.parse(x+'T00:00:00Z'))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
const money=x=>typeof x==='string'&&/^\d{1,12}(\.\d{1,2})?$/.test(x);
const cafes=['','PUBLIC_HUB','PUBLIC_COFFEE'];
export function createProductFlowReviewHandler({stageEnabled,allowedOrigin,signingSecret,verifyUserToken,loadProfile,loadSource,submitReview,now=Date.now}){
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
   const secret=signingSecret+':product-cost-flow-v1';
   if(input?.action==='confirm'){
     if(!exact(input,['action','reviewToken','confirmed'])||input.confirmed!==true)return reply({code:'CONFIRMATION_REQUIRED'},422,origin);
     let review;
     try{review=await openPurchaseReview(input.reviewToken,secret,auth.userId,now());if(review.kindOfReview!=='PRODUCT_COST_FLOW'||review.action!=='post')throw Error('Wrong purpose');}
     catch{return reply({code:'REVIEW_EXPIRED_OR_CHANGED',message:'Pemeriksaan kedaluwarsa atau berubah. Periksa alur biaya kembali.'},409,origin);}
     try{return reply({ok:true,result:await submitReview(review,auth.userId),actualProfitAvailable:false},200,origin);}
     catch{return reply({code:'SOURCE_OR_POSITION_CHANGED',message:'Belum dijurnal. Posisi lot, sumber barang/penjualan, atau periode berubah; periksa kembali.'},409,origin);}
   }
   if(exact(input,['action'])&&input.action==='inspect'){
     try{return reply({ok:true,...await loadSource('inspect',{},auth.userId),actualProfitAvailable:false},200,origin);}
     catch{return reply({code:'POSITIONS_UNAVAILABLE',message:'Posisi biaya belum dapat dimuat; daftar terlalu besar perlu pemeriksaan yang lebih spesifik.'},503,origin);}
   }
   const fields=['action','kind','movementId','saleId','derivedSplitId','sourceDate','date','cafeKey','lossPolicy','rejectCost','allocations','traceConfirmed','noAdditionalBakingCostConfirmed','evidenceRef'];
   if(!exact(input,fields)||input.action!=='review'||!['THAW','BAKE','SHIP','RETURN','WASTE','SALE'].includes(input.kind)
     ||!date(input.date)||!cafes.includes(input.cafeKey)||!money(input.rejectCost)||input.traceConfirmed!==true
     ||typeof input.evidenceRef!=='string'||input.evidenceRef.trim().length<6||input.evidenceRef.trim().length>500)
     return reply({code:'INVALID_REVIEW_REQUEST'},422,origin);
   const sale=input.kind==='SALE',bake=input.kind==='BAKE',thaw=input.kind==='THAW';
   if(bake?input.noAdditionalBakingCostConfirmed!==true:input.noAdditionalBakingCostConfirmed!==false)return reply({code:'ADDITIONAL_BAKING_COST_REVIEW_REQUIRED'},422,origin);
   if((sale?(!id(input.saleId)||input.movementId!==null||input.derivedSplitId!==null||input.sourceDate!==null):
     (input.saleId!==null||(!(bake&&input.movementId===null)&&!id(input.movementId))))
     ||((bake||thaw)?!id(input.derivedSplitId):input.derivedSplitId!==null)
     ||(bake&&input.movementId===null?!date(input.sourceDate):input.sourceDate!==null)
     ||(bake?!['ABSORB_NORMAL_LOSS','SEPARATE_ABNORMAL_LOSS'].includes(input.lossPolicy):input.lossPolicy!=='NONE'||Number(input.rejectCost)!==0)
     ||(['SHIP','RETURN'].includes(input.kind)&&!input.cafeKey)||(['THAW','BAKE','WASTE'].includes(input.kind)&&input.cafeKey!==''))
     return reply({code:'SOURCE_IDENTITY_REQUIRED'},422,origin);
   if(!Array.isArray(input.allocations)||input.allocations.length<1||input.allocations.length>50||input.allocations.some(x=>
     !exact(x,['splitId','location','cafeKey','quantity'])||!id(x.splitId)||!['FROZEN','PROOFING','FINISHED','CONSIGNMENT'].includes(x.location)||!cafes.includes(x.cafeKey)
     ||typeof x.quantity!=='string'||!/^[1-9]\d{0,9}$/.test(x.quantity)||BigInt(x.quantity)>2147483647n
     ||(x.location==='CONSIGNMENT'?!x.cafeKey:x.cafeKey!==''))||new Set(input.allocations.map(x=>`${x.splitId}:${x.location}:${x.cafeKey}`)).size!==input.allocations.length)
     return reply({code:'LOT_TRACE_REQUIRED'},422,origin);
   const payload={...input};delete payload.action;payload.evidenceRef=payload.evidenceRef.trim();
   let source;
   try{source=await loadSource('review',payload,auth.userId);}
   catch{return reply({code:'SOURCE_REQUIRES_RECONCILIATION',message:'Pastikan lot/satuan/jumlah, kafe, hasil baking dan bukti barang terjual cocok. Kiriman bukan bukti penjualan.'},409,origin);}
   if(!source||typeof source.sourceSnapshot!=='string'||new TextEncoder().encode(source.sourceSnapshot).length>24000)return reply({code:'SOURCE_UNAVAILABLE'},409,origin);
   const issuedAt=now(),review={...payload,sourceSnapshot:source.sourceSnapshot,version:1,kindOfReview:'PRODUCT_COST_FLOW',action:'post',actorId:auth.userId,
     operationKey:crypto.randomUUID(),issuedAt,expiresAt:issuedAt+300000};
   const summary={...source};delete summary.sourceSnapshot;
   return reply({ok:true,mayConfirm:source.mayConfirm===true,reviewToken:source.mayConfirm===true?await sealPurchaseReview(review,secret):null,summary,actualProfitAvailable:false},200,origin);
 };
}
