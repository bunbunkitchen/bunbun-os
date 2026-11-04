import {useState} from 'react';
import {requestCafeException} from '../../services/accountingCafeExceptionService';
const box='border rounded-lg px-3 py-2 w-full bg-white';
const button='rounded-lg bg-[#595e47] text-white px-4 py-2 disabled:opacity-50';
export default function CafeExceptionPanel({report,status,products,onComplete}){
 const [evidence,setEvidence]=useState(report.input.evidenceRef),[cash,setCash]=useState(''),[confirmed,setConfirmed]=useState(false),[income,setIncome]=useState(''),[date,setDate]=useState(''),[amounts,setAmounts]=useState({}),[product,setProduct]=useState(''),[wasteDate,setWasteDate]=useState(''),[lots,setLots]=useState({}),[review,setReview]=useState(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const change=fn=>{fn();setReview(null);setMessage('');};
 const run=async fn=>{setBusy(true);setMessage('');try{await fn();}catch(e){setMessage(e.message);}finally{setBusy(false);}};
 const send=async input=>setReview({...await requestCafeException({...input,reportId:report.id,evidenceRef:evidence}),kind:input.action});
 const end=new Date(Date.UTC(Number(report.input.month.slice(0,4)),Number(report.input.month.slice(5)),0)).toISOString().slice(0,10);
 return <section className="p-5 bg-white rounded-xl space-y-4"><h2 className="font-bold text-xl">Uang Muka dan Waste Kafe</h2>
  <p>Setoran lebih awal tetap dicatat pada tanggal penerimaan sebagai uang muka. Saat penjualan diakui, saldo uang muka melunasi piutang tanpa menambah kas atau pendapatan lagi. Waste hanya memakai jumlah laporan dan biaya lot aktual.</p>
  {!status?<p>Pemeriksaan sumber belum tersedia. Muat ulang laporan sebelum posting.</p>:<>
   {message&&<p role="status" className="p-3 bg-amber-50 rounded-lg">{message}</p>}
   <label>Bukti setoran / penghitungan barang<input className={box} value={evidence} onChange={e=>change(()=>setEvidence(e.target.value))} /></label>
   <label className="block"><input type="checkbox" checked={confirmed} onChange={e=>change(()=>setConfirmed(e.target.checked))} /> Saya sudah memeriksa sumber setoran, bagian laporan, jumlah fisik dan lot yang dipakai sesuai bukti.</label>
   <fieldset disabled={busy} className="border rounded-xl p-4 space-y-3"><legend>Penerimaan uang muka</legend>
    <label>Akun penerimaan sebenarnya<select className={box} value={cash} onChange={e=>change(()=>setCash(e.target.value))}><option value="">Pilih akun</option><option value="1020">Bank</option><option value="1010">Kas</option></select></label>
    <p>Nominal penuh setoran akan masuk ke akun yang dipilih. Semua bagiannya harus sudah tertaut ke laporan masing-masing.</p>
    {status.advances.map(a=><div key={a.incomeId} className="border rounded-lg p-3 space-y-2"><p>Setoran #{a.incomeId} · bagian laporan Rp{a.portion} · {a.posted?`uang muka sudah dicatat; bagian yang diterapkan Rp${a.applied}`:a.receiptPosted?'sudah dijurnal sebagai pelunasan':'belum dijurnal sebagai uang muka'}</p>
     {!a.posted&&<button className={button} disabled={!cash||!confirmed||a.receiptPosted} onClick={()=>run(()=>send({action:'review_advance',incomeId:a.incomeId,cashAccount:cash,allocationConfirmed:confirmed}))}>Periksa penerimaan uang muka</button>}</div>)}
   </fieldset>
   <fieldset disabled={busy} className="border rounded-xl p-4 space-y-3"><legend>Terapkan saldo uang muka ke penjualan</legend>
    <label>Sumber uang muka<select className={box} value={income} onChange={e=>change(()=>{setIncome(e.target.value);setAmounts({});})}><option value="">Pilih setoran</option>{status.advances.filter(a=>a.posted).map(a=><option key={a.incomeId} value={a.incomeId}>#{a.incomeId} · bagian Rp{a.reserved} · sudah diterapkan Rp{a.applied}</option>)}</select></label>
    <label>Tanggal penerapan sesuai pengakuan penjualan<input className={box} type="date" value={date} onChange={e=>change(()=>setDate(e.target.value))} /></label>
    <p>Isi hanya nominal yang dipakai untuk melunasi faktur berikut. Tanggal tidak boleh mendahului penerimaan dan faktur penjualan.</p>
    {status.sales.map(s=><label key={s.saleId} className="block">Penjualan #{s.saleId} · {s.date} · sisa piutang Rp{s.outstanding}<input className={box} inputMode="decimal" value={amounts[s.saleId]||''} onChange={e=>change(()=>setAmounts({...amounts,[s.saleId]:e.target.value}))} placeholder="Nominal pelunasan dari uang muka" /></label>)}
    <button className={button} disabled={!income||!date||!confirmed} onClick={()=>run(()=>send({action:'review_apply',incomeId:income,applicationDate:date,allocations:Object.entries(amounts).filter(([,v])=>v!=='').map(([saleId,amount])=>({saleId,amount})),allocationConfirmed:confirmed}))}>Periksa penerapan uang muka</button>
   </fieldset>
   <fieldset disabled={busy} className="border rounded-xl p-4 space-y-3"><legend>Waste produk di kafe</legend>
    <p>Pengurangan hanya pada persediaan titipan kafe. Tidak membuat pengeluaran kas atau pengurangan stok dapur lagi.</p>
    {!status.waste.length&&<p>Tidak ada waste terkonfirmasi pada laporan ini.</p>}
    {status.waste.filter(w=>w.posted).map(w=><p key={w.productId}>{products.find(p=>p.id===w.productId)?.name||w.productId}: waste {w.quantity} pcs sudah dijurnal dengan biaya aktual Rp{w.actualCost}.</p>)}
    <label>Produk waste yang belum dijurnal<select className={box} value={product} onChange={e=>change(()=>{setProduct(e.target.value);setLots({});})}><option value="">Pilih produk</option>{status.waste.filter(w=>!w.posted).map(w=><option key={w.productId} value={w.productId}>{products.find(p=>p.id===w.productId)?.name||w.productId} · {w.quantity} pcs</option>)}</select></label>
    <label>Tanggal pengakuan waste bulanan<input type="date" className={box} min={end} max={end} value={wasteDate} onChange={e=>change(()=>setWasteDate(e.target.value))} /></label>
    {status.positions.filter(p=>p.productId===product).map(p=><label key={p.splitId} className="block">Lot #{p.splitId} · tersedia {p.quantity} pcs · nilai aktual Rp{p.actualValue}<input className={box} inputMode="numeric" value={lots[p.splitId]||''} onChange={e=>change(()=>setLots({...lots,[p.splitId]:e.target.value}))} placeholder="Jumlah waste dari lot ini" /></label>)}
    <button className={button} disabled={!product||!wasteDate||!confirmed} onClick={()=>run(()=>send({action:'review_waste',productId:product,date:wasteDate,allocations:Object.entries(lots).filter(([,v])=>v!=='').map(([splitId,quantity])=>({splitId,quantity})),lossConfirmed:confirmed}))}>Periksa jurnal waste</button>
   </fieldset>
   {review&&<div className="bg-amber-50 p-4 rounded-lg space-y-3"><h3 className="font-bold">Pemeriksaan sebelum posting</h3><p>{review.kind==='review_advance'?`Debit ${cash==='1020'?'Bank':'Kas'} · Kredit Uang Muka Kafe`:review.kind==='review_apply'?'Debit Uang Muka Kafe · Kredit Piutang Kafe':'Debit Kerugian Stok · Kredit Persediaan Titipan Kafe'}: Rp{review.summary.amount}, tanggal {review.summary.date}.</p>
    {review.kind==='review_waste'&&<p>Waste terkonfirmasi {review.summary.quantity} pcs. Nilai berasal dari biaya lot, bukan harga jual atau HPP resep.</p>}
    <button className={button} disabled={busy} onClick={()=>run(async()=>{await requestCafeException({action:'confirm',reviewToken:review.reviewToken,confirmed:true});setReview(null);await onComplete();setMessage('Posting selesai. Saldo sumber dan jurnal telah diperbarui tanpa menggandakan kas atau stok.');})}>Konfirmasi posting</button>
   </div>}
  </>}
 </section>;
}
