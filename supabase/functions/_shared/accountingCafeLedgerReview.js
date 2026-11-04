import {authorizeActiveOwner} from './accountingOwnerReadiness.js';
import {sealPurchaseReview,openPurchaseReview} from './accountingPurchaseReview.js';
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===[...keys].sort().join(',');
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(x);
const id=x=>typeof x==='string'&&/^[1-9]\d{0,18}$/.test(x)&&BigInt(x)<=9223372036854775807n;
const date=x=>typeof x==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(x)&&!Number.isNaN(Date.parse(x+'T00:00:00Z'))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
const hints=new Map([
 ['Cafe facts changed or still differ; review and save factual report first','Sumber laporan berubah atau masih berselisih. Periksa dan simpan ulang laporan sebelum menjurnal.'],
 ['Existing cafe sales must be reconciled; shipment-shaped sales cannot be imported twice','Sudah ada penjualan bulan ini. Cocokkan seluruh jumlah terjual dan hak bersihnya; data kiriman tidak boleh dijurnal lagi sebagai penjualan.'],
 ['Actual sold product quantities differ from existing sales','Jumlah atau nominal produk pada penjualan lama berbeda dari laporan kafe. Perlu koreksi sumber sebelum ditautkan.'],
 ['All existing monthly cafe sales must already have matching posted net entitlement','Pilih semua penjualan bulan ini yang sudah dijurnal dengan dasar hak bersih Bunbun. Total hak bersih harus sama dengan laporan.'],
 ['Reviewed opening and open accounting month required','Saldo awal yang disetujui dan periode akuntansi terbuka diperlukan sebelum posting.'],
 ['All portions of net deposit must be linked before posting; no second deduction or guessed balance','Seluruh bagian setoran bersih harus sudah dialokasikan; sisa nominal tidak boleh dianggap nol.'],
 ['Every linked report needs one imported invoice; multiple existing invoices need explicit settlement allocation','Semua laporan yang memakai setoran ini harus tertaut ke satu faktur masing-masing. Jika faktur lebih dari satu, gunakan alokasi pelunasan di pemeriksaan sumber keuangan.'],
 ['Deposit precedes monthly invoice; advance accounting is required','Setoran diterima sebelum faktur bulanan. Perlu pencatatan uang muka; jangan mengubah tanggal penerimaan agar bisa diposting.'],
 ['Monthly sold summaries require month-end recognition; earlier deposits need advance accounting','Ringkasan penjualan bulanan diakui pada akhir bulan. Setoran yang lebih awal memerlukan pencatatan uang muka.'],
 ['Cafe overpayment needs advance accounting first','Kelebihan bayar memerlukan pencatatan uang muka terlebih dahulu.'],
 ['Free promotional goods need explicit accounting classification','Produk promo gratis memerlukan klasifikasi biaya yang jelas sebelum laporan dijurnal.'],
]);
export function createCafeLedgerHandler({stageEnabled,allowedOrigin,signingSecret,verifyUserToken,loadProfile,loadSource,submitReview,now=Date.now}){
 const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','X-Content-Type-Options':'nosniff',...(allowedOrigin?{'Access-Control-Allow-Origin':allowedOrigin}:{})}});
 return async request=>{
  if(!stageEnabled||!allowedOrigin||!signingSecret||signingSecret.length<32)return reply({code:'STAGING_NOT_CONFIGURED'},503);
  if(request.headers.get('Origin')!==allowedOrigin)return reply({code:'ORIGIN_NOT_ALLOWED'},403);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':allowedOrigin,'Vary':'Origin','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info'}});
  if(request.method!=='POST')return reply({code:'METHOD_NOT_ALLOWED'},405);
  const auth=await authorizeActiveOwner({authorization:request.headers.get('Authorization'),verifyUserToken,loadProfile});if(!auth.ok)return reply({code:auth.code},auth.status);
  if(!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))return reply({code:'JSON_REQUIRED'},415);
  let x;try{const body=await request.text();if(new TextEncoder().encode(body).length>16000)return reply({code:'BODY_TOO_LARGE'},413);x=JSON.parse(body);}catch{return reply({code:'INVALID_JSON'},400);}
  const secret=signingSecret+':cafe-ledger-v1';
  try{
   if(exact(x,['action','reportId'])&&x.action==='inspect'&&uuid(x.reportId))return reply({ok:true,...await loadSource('inspect',{reportId:x.reportId},auth.userId)});
   if(x?.action==='confirm'){
    if(!exact(x,['action','reviewToken','confirmed'])||x.confirmed!==true)throw Error('Konfirmasi jurnal diperlukan.');
    const review=await openPurchaseReview(x.reviewToken,secret,auth.userId,now());
    if(review.purpose!=='CAFE_LEDGER'||!['post_import','post_receipt'].includes(review.action))throw Error('Periksa jurnal kembali.');
    return reply({ok:true,result:await submitReview(review,auth.userId),actualProfitAvailable:false});
   }
   const importing=x?.action==='review_import';
   if(!(importing?exact(x,['action','reportId','mode','saleDate','existingSaleIds','actualSoldConfirmed','evidenceRef']):exact(x,['action','reportId','incomeId','cashAccount','evidenceRef']))
    ||!['review_import','review_receipt'].includes(x.action)||!uuid(x.reportId)||typeof x.evidenceRef!=='string'||x.evidenceRef.trim().length<6||x.evidenceRef.length>500)throw Error('Lengkapi pemeriksaan jurnal dan bukti.');
   if(importing?(!['CREATE','LINK'].includes(x.mode)||!date(x.saleDate)||x.actualSoldConfirmed!==true||!Array.isArray(x.existingSaleIds)||x.existingSaleIds.length>50||x.existingSaleIds.some(v=>!id(v))||new Set(x.existingSaleIds).size!==x.existingSaleIds.length||(x.mode==='CREATE'?x.existingSaleIds.length!==0:!x.existingSaleIds.length)):
    (!id(x.incomeId)||!['1010','1020'].includes(x.cashAccount)))throw Error('Tanggal, penjualan aktual, sumber setoran, atau akun belum sesuai.');
   const payload={...x};delete payload.action;payload.evidenceRef=payload.evidenceRef.trim();
   const source=await loadSource(x.action,payload,auth.userId);
   if(source?.mayConfirm!==true||typeof source.sourceSnapshot!=='string'||!/^[a-f0-9]{64}$/.test(source.sourceSnapshot))throw Error('Sumber belum siap dijurnal.');
   const issuedAt=now(),review={...payload,sourceSnapshot:source.sourceSnapshot,action:importing?'post_import':'post_receipt',purpose:'CAFE_LEDGER',version:1,actorId:auth.userId,operationKey:crypto.randomUUID(),issuedAt,expiresAt:issuedAt+300000};
   const summary={...source};delete summary.sourceSnapshot;
   return reply({ok:true,summary,reviewToken:await sealPurchaseReview(review,secret),actualProfitAvailable:false});
  }catch(error){return reply({code:'CAFE_LEDGER_REQUIRES_RECONCILIATION',message:hints.get(error?.message)||'Belum dijurnal. Pastikan laporan terbaru sudah cocok, saldo awal dan periode terbuka, penjualan lama sesuai barang terjual, serta seluruh bagian setoran sudah tertaut. Periksa ulang jika sumber berubah.'},409);}
 };
}
