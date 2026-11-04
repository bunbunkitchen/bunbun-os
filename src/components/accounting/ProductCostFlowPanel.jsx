import {useState} from 'react';
import Currency from '../ui/Currency';
import {requestProductCostFlow} from '../../services/accountingProductFlowService';
const labels={THAW:'Frozen ke proofing',BAKE:'Hasil baking frozen',SHIP:'Kirim titipan kafe',RETURN:'Retur kafe yang belum terjual',WASTE:'Waste produk jadi tercatat',SALE:'HPP barang yang benar-benar terjual'};
const types={THAW:'FROZEN_OUT',BAKE:'FINISHED_IN',SHIP:'CAFE_OUT',RETURN:'CAFE_IN',WASTE:'ADJUSTMENT_OUT'};
const locations={THAW:'FROZEN',BAKE:'PROOFING',SHIP:'FINISHED',RETURN:'CONSIGNMENT',WASTE:'FINISHED'};
const key=p=>`${p.splitId}:${p.location}:${p.cafeKey}`;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export default function ProductCostFlowPanel(){
 const [data,setData]=useState(null),[kind,setKind]=useState('SHIP'),[movementId,setMovementId]=useState(''),[saleId,setSaleId]=useState('');
 const [derivedId,setDerivedId]=useState(''),[date,setDate]=useState(today),[sourceDate,setSourceDate]=useState(''),[cafeKey,setCafeKey]=useState('');
 const [lossPolicy,setLossPolicy]=useState(''),[rejectCost,setRejectCost]=useState(''),[quantities,setQuantities]=useState({}),[evidence,setEvidence]=useState(''),[confirmed,setConfirmed]=useState(false);
 const [noExtraCosts,setNoExtraCosts]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[review,setReview]=useState(null);
 const selectedSale=data?.sales?.find(x=>x.id===saleId),selectedMovement=data?.movements?.find(x=>x.id===movementId);
 const selectedDerived=data?.derivedSplits?.find(x=>x.id===derivedId);
 const cafe=kind==='SALE'?(selectedSale?.sales_channel==='DIRECT'?'':selectedSale?.sales_channel||''):['SHIP','RETURN'].includes(kind)?cafeKey:'';
 const expectedLocation=kind==='SALE'?(selectedSale?.sales_channel==='DIRECT'?'FINISHED':'CONSIGNMENT'):locations[kind];
 const positions=(data?.positions||[]).filter(x=>x.location===expectedLocation&&(x.location!=='CONSIGNMENT'||x.cafeKey===cafe)
   &&(!selectedMovement||kind==='BAKE'||x.productId===selectedMovement.product_id)
   &&(kind!=='THAW'||!selectedMovement||x.splitId===selectedMovement.batch_split_id)
   &&(kind!=='BAKE'||x.splitId===derivedId));
 function changed(){setReview(null);setError('');setMessage('');}
 const field=setter=>e=>{setter(e.target.value);changed();};
 async function refresh(){setBusy(true);changed();try{setData(await requestProductCostFlow({action:'inspect'}));setQuantities({});}catch(e){setError(e.message);}finally{setBusy(false);}}
 function changeKind(e){setKind(e.target.value);setNoExtraCosts(false);setMovementId('');setSaleId('');setDerivedId('');setQuantities({});setConfirmed(false);changed();}
 async function inspect(e){
   e.preventDefault();setBusy(true);changed();
   const allocations=positions.filter(p=>quantities[key(p)]&&Number(quantities[key(p)])>0).map(p=>({splitId:p.splitId,location:p.location,cafeKey:p.cafeKey,quantity:quantities[key(p)]}));
   try{setReview(await requestProductCostFlow({action:'review',kind,movementId:kind==='SALE'||!movementId?null:movementId,saleId:kind==='SALE'?saleId:null,
     derivedSplitId:['THAW','BAKE'].includes(kind)?derivedId:null,sourceDate:kind==='BAKE'&&!movementId?sourceDate:null,date,cafeKey:cafe,
     lossPolicy:kind==='BAKE'?lossPolicy:'NONE',rejectCost:kind==='BAKE'?rejectCost:'0',allocations,traceConfirmed:confirmed,noAdditionalBakingCostConfirmed:kind==='BAKE'?noExtraCosts:false,evidenceRef:evidence}));}
   catch(err){setError(err.message);}finally{setBusy(false);}
 }
 async function post(){if(!review?.mayConfirm||!review.reviewToken||busy)return;setBusy(true);setError('');
   try{const r=await requestProductCostFlow({action:'confirm',reviewToken:review.reviewToken,confirmed:true});setReview(null);setData(null);setQuantities({});
     setMessage(r.result?.alreadyProcessed?'Sudah dijurnal; tidak dihitung dua kali.':'Jurnal alur biaya produk dicatat. Muat ulang posisi sebelum melanjutkan.');}
   catch(e){setError(e.message);setReview(null);}finally{setBusy(false);}}
 const s=review?.summary;
 return <section className="mt-6 rounded-xl border bg-white p-5">
   <h2 className="text-lg font-semibold">Nilai perpindahan produk dan HPP terjual</h2>
   <p className="mt-1 text-sm text-slate-600">Pilih mutasi nyata dan lot yang terbukti sesuai. Pengiriman ke kafe tetap persediaan titipan. Catatan penjualan harus berisi jumlah yang sudah terjual; jika masih berupa jumlah kiriman, cocokkan laporan kafe dahulu.</p>
   <button type="button" disabled={busy} onClick={refresh} className="mt-3 rounded border px-3 py-2 text-sm disabled:opacity-50">Muat posisi biaya dan sumber barang</button>
   {data&&<form onSubmit={inspect} className="mt-4 grid gap-3 md:grid-cols-2"><fieldset disabled={busy} className="contents">
     <label className="text-sm">Peristiwa<select value={kind} onChange={changeKind} className="mt-1 w-full rounded border p-2">{Object.entries(labels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
     <label className="text-sm">Tanggal jurnal dalam bulan kejadian<input required type="date" value={date} onChange={field(setDate)} className="mt-1 w-full rounded border p-2" /></label>
     {kind==='SALE'?<label className="text-sm">Penjualan yang pendapatannya sudah diakui<select required value={saleId} onChange={e=>{setSaleId(e.target.value);setQuantities({});changed();}} className="mt-1 w-full rounded border p-2">
       <option value="">Pilih barang terjual</option>{data.sales.map(x=><option key={x.id} value={x.id}>{x.sale_date} — {x.sales_channel} — #{x.id}</option>)}</select></label>:
       <label className="text-sm">Mutasi stok sumber<select required={kind!=='BAKE'||selectedDerived?.good!==0} value={movementId} onChange={e=>{setMovementId(e.target.value);setNoExtraCosts(false);setQuantities({});changed();}} className="mt-1 w-full rounded border p-2">
         <option value="">{kind==='BAKE'?'Pilih penerimaan, atau kosong jika seluruhnya reject':'Pilih mutasi'}</option>{data.movements.filter(x=>x.movement_type===types[kind]&&(kind!=='BAKE'||data.derivedSplits.some(d=>d.id===x.batch_split_id))).map(x=><option key={x.id} value={x.id}>{x.movement_date} — produk #{x.product_id} — {x.qty} pcs — #{x.id}</option>)}</select></label>}
     {['THAW','BAKE'].includes(kind)&&<label className="text-sm">Split turunan frozen<select required value={derivedId} onChange={e=>{setDerivedId(e.target.value);setNoExtraCosts(false);setQuantities({});changed();}} className="mt-1 w-full rounded border p-2"><option value="">Pilih split turunan</option>{data.derivedSplits.filter(x=>kind!=='THAW'||!selectedMovement||x.sourceSplitId===selectedMovement.batch_split_id).map(x=><option key={x.id} value={x.id}>#{x.id} — {x.quantity} pcs — layak {x.good}, reject {x.reject}</option>)}</select></label>}
     {['SHIP','RETURN'].includes(kind)&&<label className="text-sm">Kafe sesuai bukti<select required value={cafeKey} onChange={e=>{setCafeKey(e.target.value);setQuantities({});changed();}} className="mt-1 w-full rounded border p-2"><option value="">Pilih kafe</option><option value="PUBLIC_HUB">Public Hub</option><option value="PUBLIC_COFFEE">The Public Coffee</option></select></label>}
     {kind==='BAKE'&&<>
       {!movementId&&<label className="text-sm">Tanggal baking pada bukti seluruhnya reject<input required type="date" value={sourceDate} onChange={field(setSourceDate)} className="mt-1 w-full rounded border p-2" /></label>}
       <label className="text-sm">Perlakuan reject<select required value={lossPolicy} onChange={field(setLossPolicy)} className="mt-1 w-full rounded border p-2"><option value="">Pilih sesuai bukti</option><option value="ABSORB_NORMAL_LOSS">Susut normal diserap hasil layak</option><option value="SEPARATE_ABNORMAL_LOSS">Kerusakan abnormal menjadi kerugian</option></select></label>
       <label className="text-sm">Nilai kerugian reject terpisah (Rp)<input required type="number" min="0" step="0.01" value={rejectCost} onChange={field(setRejectCost)} className="mt-1 w-full rounded border p-2" /></label>
       <label className="flex items-start gap-2 text-sm md:col-span-2"><input required type="checkbox" checked={noExtraCosts} onChange={e=>{setNoExtraCosts(e.target.checked);changed();}} />Bukti menyatakan tidak ada biaya baking tambahan yang belum masuk nilai lot. Jika gaji/gas/biaya tambahan belum teralokasi, hentikan penilaian baking ini; alokasi biaya tambahan memerlukan alur tersendiri.</label>
     </>}
     <div className="md:col-span-2"><p className="text-sm font-semibold">Lot sumber: isi jumlah yang dipakai dari masing-masing lot</p>{positions.length===0&&<p className="mt-2 text-sm text-amber-900">Belum ada posisi bernilai yang sesuai. Lengkapi biaya batch/perpindahan sebelumnya.</p>}
       {positions.map(p=><label key={key(p)} className="mt-2 flex flex-wrap items-center gap-3 rounded border p-2 text-sm"><span className="flex-1">Lot #{p.splitId}, produk #{p.productId}, {p.location} {p.cafeKey}: tersedia {p.quantity} pcs, <Currency value={p.actualValue} /></span><input aria-label={`Jumlah lot ${p.splitId} ${p.location} ${p.cafeKey}`} type="number" min="0" max={p.quantity} step="1" value={quantities[key(p)]||''} onChange={e=>{setQuantities({...quantities,[key(p)]:e.target.value});changed();}} className="w-28 rounded border p-2" /></label>)}
     </div>
     <label className="text-sm md:col-span-2">Referensi bukti lot, barang dan hasil penjualan<input required minLength={6} maxLength={500} value={evidence} onChange={field(setEvidence)} className="mt-1 w-full rounded border p-2" /></label>
     <label className="flex items-start gap-2 text-sm md:col-span-2"><input required type="checkbox" checked={confirmed} onChange={e=>{setConfirmed(e.target.checked);changed();}} />Saya sudah memeriksa lot, jumlah, kafe dan tanggal sesuai bukti; retur ini barang belum terjual, dan HPP hanya untuk barang yang benar-benar terjual.</label>
     <button disabled={busy||positions.length===0} className="justify-self-start rounded bg-slate-700 px-4 py-2 text-white disabled:opacity-50">Periksa alur biaya</button>
   </fieldset></form>}
   {error&&<p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}{message&&<p role="status" className="mt-3 text-sm text-green-800">{message}</p>}
   {s&&<div className="mt-4 rounded border bg-slate-50 p-4 text-sm"><p>{labels[s.kind]}: kejadian {s.sourceDate}, jurnal {s.postingDate}.</p><p>Nilai lot dipindahkan <Currency value={s.totalCost} />, kerugian reject <Currency value={s.rejectCost} />.</p>
     {s.blockers?.length>0&&<ul className="mt-2 list-disc pl-5 text-amber-900">{s.blockers.map((x,i)=><li key={i}>{x}</li>)}</ul>}
     {review.mayConfirm&&<button type="button" disabled={busy} onClick={post} className="mt-3 rounded bg-orange-700 px-4 py-2 text-white disabled:opacity-50">Konfirmasi jurnal alur biaya</button>}
   </div>}
 </section>;
}
