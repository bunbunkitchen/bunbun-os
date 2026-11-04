import { useState } from 'react';
import Currency from '../ui/Currency';
import { requestMaterialAccounting } from '../../services/accountingMaterialService';

export default function MaterialAccountingPanel({ materials, batchCode }) {
  const [transactionId,setTransactionId]=useState('');
  const [evidenceRef,setEvidenceRef]=useState('');
  const [usageConfirmed,setUsageConfirmed]=useState(false);
  const [review,setReview]=useState(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  function changed() {setReview(null);setError('');setMessage('');}
  async function inspect(event) {
    event.preventDefault();setBusy(true);setReview(null);setError('');setMessage('');
    try {setReview(await requestMaterialAccounting({action:'review',transactionId,evidenceRef,usageConfirmed}));}
    catch(e) {setError(e.message);} finally {setBusy(false);}
  }
  async function confirm() {
    if(!review?.mayConfirm||!review.reviewToken||busy)return;
    setBusy(true);setError('');
    try {
      const response=await requestMaterialAccounting({action:'confirm',confirmed:true,reviewToken:review.reviewToken});
      setMessage(response.result?.alreadyProcessed?'Pemakaian ini sudah dijurnal; tidak dicatat dua kali.':'Biaya bahan dipindahkan ke produksi dalam proses. HPP produk masih perlu dilengkapi.');
      setReview(null);
    } catch(e) {setError(e.message);setReview(null);} finally {setBusy(false);}
  }
  const s=review?.summary;
  return <section className="mt-5 rounded-xl border border-slate-200 bg-white p-5">
    <h3 className="font-semibold">Biaya bahan aktual — {batchCode}</h3>
    <p className="mt-1 text-sm text-slate-600">Nilai pemakaian dari persediaan yang sudah dijurnal, dengan rata-rata bergerak. Harga master resep dan tarif Rp2.615 tidak dipakai sebagai biaya aktual.</p>
    <form onSubmit={inspect} className="mt-3 grid gap-3 md:grid-cols-2">
      <fieldset disabled={busy} className="contents">
        <label className="text-sm">Catatan pemakaian bahan
          <select required value={transactionId} onChange={e=>{setTransactionId(e.target.value);changed();}} className="mt-1 w-full rounded border p-2">
            <option value="">Pilih bahan yang dipakai</option>
            {[...materials].sort((a,b)=>a.transaction_date.localeCompare(b.transaction_date)||Number(a.id)-Number(b.id)).map(x=><option key={x.id} value={String(x.id)}>{x.transaction_date} — bahan #{x.ingredient_id} — {x.qty} {x.unit} (#{x.id})</option>)}
          </select>
        </label>
        <label className="text-sm">Referensi bukti pemakaian produksi
          <input required minLength={6} maxLength={500} value={evidenceRef} onChange={e=>{setEvidenceRef(e.target.value);changed();}} className="mt-1 w-full rounded border p-2" />
        </label>
        <label className="flex items-start gap-2 text-sm md:col-span-2">
          <input required type="checkbox" checked={usageConfirmed} onChange={e=>{setUsageConfirmed(e.target.checked);changed();}} />
          Catatan ini sesuai dengan bahan yang benar-benar dipakai untuk batch tersebut.
        </label>
        <button disabled={busy} className="justify-self-start rounded bg-slate-700 px-4 py-2 text-white disabled:opacity-50">{busy?'Memproses…':'Periksa nilai bahan'}</button>
      </fieldset>
    </form>
    {error&&<p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {message&&<p role="status" className="mt-3 text-sm text-green-800">{message}</p>}
    {s&&<div className="mt-4 rounded border bg-slate-50 p-4 text-sm">
      {review.code==='ALREADY_POSTED'?<p>Pemakaian #{s.transactionId} sudah dijurnal.</p>:<>
        <p>Bahan #{s.ingredientId}: {s.quantity} {s.unit}, {s.date}.</p>
        <p>Persediaan yang sudah dinilai: {s.poolQuantity} {s.unit}, <Currency value={s.poolValue} />.</p>
        <p>Biaya bahan ke produksi dalam proses: {s.actualMaterialCost==null?'Belum tersedia':<Currency value={s.actualMaterialCost} />}.</p>
        {s.blockers?.length>0&&<ul className="mt-2 list-disc pl-5 text-amber-900">{s.blockers.map((x,i)=><li key={i}>{x}</li>)}</ul>}
      </>}
      <p className="mt-2 text-amber-900">Belum termasuk tenaga kerja, overhead, hasil produk, waste dan HPP produk terjual.</p>
      {review.mayConfirm&&<button type="button" disabled={busy} onClick={confirm} className="mt-3 rounded bg-orange-700 px-4 py-2 text-white disabled:opacity-50">Konfirmasi jurnal bahan ke produksi</button>}
    </div>}
  </section>;
}
