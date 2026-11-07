import { authorizeActiveOwner } from './accountingOwnerReadiness.js';
import { openPurchaseReview, sealPurchaseReview } from './accountingPurchaseReview.js';

const exact = (x, fields) => x && typeof x === 'object' && !Array.isArray(x)
  && Object.keys(x).sort().join(',') === [...fields].sort().join(',');
const validId = x => typeof x === 'string' && /^[1-9]\d{0,18}$/.test(x) && BigInt(x) <= 9223372036854775807n;
export function createMaterialReviewHandler({ stageEnabled, allowedOrigin, signingSecret,
  verifyUserToken, loadProfile, loadSource, submitReview, now = Date.now }) {
  const reply = (body,status,origin) => new Response(JSON.stringify(body),{status,headers:{
    'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin',
    ...(origin?{'Access-Control-Allow-Origin':origin}:{}),
  }});
  return async request => {
    const origin=request.headers.get('Origin');
    if (!stageEnabled || !allowedOrigin || typeof signingSecret!=='string' || signingSecret.length<32) return reply({code:'STAGING_NOT_CONFIGURED'},503);
    if (origin!==allowedOrigin) return reply({code:'ORIGIN_NOT_ALLOWED'},403);
    if (request.method==='OPTIONS') return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':origin,
      'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Vary':'Origin'}});
    if (request.method!=='POST') return reply({code:'METHOD_NOT_ALLOWED'},405,origin);
    if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) return reply({code:'JSON_REQUIRED'},415,origin);
    const auth=await authorizeActiveOwner({authorization:request.headers.get('Authorization'),verifyUserToken,loadProfile});
    if (!auth.ok) return reply({code:auth.code},auth.status,origin);
    let input;
    try { const text=await request.text(); if(new TextEncoder().encode(text).length>65536) return reply({code:'BODY_TOO_LARGE'},413,origin); input=JSON.parse(text); }
    catch {return reply({code:'INVALID_JSON'},400,origin);}
    const secret=signingSecret+':material-wip-v1';
    if(input?.action==='confirm') {
      if(!exact(input,['action','reviewToken','confirmed']) || input.confirmed!==true) return reply({code:'CONFIRMATION_REQUIRED'},422,origin);
      let review;
      try {review=await openPurchaseReview(input.reviewToken,secret,auth.userId,now());
        if(review.kind!=='MATERIAL_TO_WIP'||review.action!=='post') throw Error('Wrong review');}
      catch {return reply({code:'REVIEW_EXPIRED_OR_CHANGED',message:'Pemeriksaan kedaluwarsa atau berubah. Periksa pemakaian kembali.'},409,origin);}
      try {return reply({ok:true,code:'POSTED',result:await submitReview(review,auth.userId),actualProfitAvailable:false},200,origin);}
      catch {return reply({code:'SOURCE_OR_COST_CHANGED',message:'Belum dijurnal. Periksa kembali sumber bahan, urutan pemakaian, nilai persediaan dan periode.'},409,origin);}
    }
    if(!exact(input,['action','transactionId','usageConfirmed','evidenceRef']) || input.action!=='review'
      ||!validId(input.transactionId)||input.usageConfirmed!==true||typeof input.evidenceRef!=='string'
      ||input.evidenceRef.trim().length<6||input.evidenceRef.trim().length>500)
      return reply({code:'INVALID_REVIEW_REQUEST',message:'Pilih pemakaian bahan dan referensi bukti produksi yang sudah diperiksa.'},422,origin);
    let source;
    try {source=await loadSource(input.transactionId,auth.userId);}
    catch {return reply({code:'SOURCE_UNAVAILABLE',message:'Pemakaian harus berasal dari batch Finished dengan catatan bahan yang lengkap.'},409,origin);}
    if(!source) return reply({code:'SOURCE_NOT_FOUND'},404,origin);
    if(source.posted===true) return reply({ok:true,code:'ALREADY_POSTED',mayConfirm:false,reviewToken:null,
      summary:source.result,actualProfitAvailable:false},200,origin);
    if(typeof source.sourceSnapshot!=='string'||new TextEncoder().encode(source.sourceSnapshot).length>24000)
      return reply({code:'SOURCE_REQUIRES_RECONCILIATION',message:'Riwayat terlalu besar atau belum lengkap untuk pemeriksaan.'},409,origin);
    const issuedAt=now();
    const review={version:1,kind:'MATERIAL_TO_WIP',actorId:auth.userId,action:'post',transactionId:input.transactionId,
      sourceSnapshot:source.sourceSnapshot,usageConfirmed:true,evidenceRef:input.evidenceRef.trim(),
      operationKey:crypto.randomUUID(),issuedAt,expiresAt:issuedAt+300000};
    const summary={...source}; delete summary.sourceSnapshot;
    return reply({ok:true,code:source.mayConfirm===true?'READY_FOR_CONFIRMATION':'MATERIAL_RECONCILIATION_REQUIRED',
      mayConfirm:source.mayConfirm===true,reviewToken:source.mayConfirm===true?await sealPurchaseReview(review,secret):null,
      summary,actualProfitAvailable:false,completeProductCost:false},200,origin);
  };
}
