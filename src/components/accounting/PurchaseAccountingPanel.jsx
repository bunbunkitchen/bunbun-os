import { useState } from 'react';
import Currency from '../ui/Currency';
import { requestPurchaseAccounting } from '../../services/accountingPurchaseService';

export default function PurchaseAccountingPanel({ purchases, onPosted }) {
  const [purchaseId, setPurchaseId] = useState('');
  const [action, setAction] = useState('review-post');
  const [cashAccount, setCashAccount] = useState('');
  const [evidenceRef, setEvidenceRef] = useState('');
  const [newUnitPrice, setNewUnitPrice] = useState('');
  const [review, setReview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const field = (setter) => event => { setter(event.target.value); setReview(null); setMessage(''); setError(''); };
  async function inspect(event) {
    event.preventDefault(); setBusy(true); setError(''); setMessage(''); setReview(null);
    try {
      setReview(await requestPurchaseAccounting({ action, purchaseId, cashAccount, evidenceRef,
        newUnitPrice: action === 'review-correction' ? newUnitPrice : null }));
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function confirm() {
    if (!review?.mayConfirm || !review.reviewToken || busy) return;
    setBusy(true); setError('');
    try {
      const result = await requestPurchaseAccounting({ action: 'confirm', reviewToken: review.reviewToken, confirmed: true });
      setReview(null);
      setMessage(result.result?.alreadyProcessed ? 'Transaksi ini sudah tercatat; tidak dibuat jurnal ganda.' : 'Jurnal pembelian dan pembayaran berhasil dicatat.');
      // Failure to reload must never look like a failed posting and encourage
      // the user to repeat a different correction operation.
      try { await onPosted?.(); } catch { setMessage('Jurnal berhasil dicatat. Muat ulang halaman untuk melihat pembelian terbaru.'); }
    } catch (e) { setError(e.message); setReview(null); } finally { setBusy(false); }
  }
  const s = review?.summary;
  return <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5">
    <h2 className="text-lg font-semibold text-slate-800">Akuntansi pembelian</h2>
    <p className="mt-1 text-sm text-slate-600">Periksa pembelian bahan dan pembayaran terkait sebelum mencatat jurnal. Koreksi harga mempertahankan jumlah bahan yang diterima.</p>
    <form onSubmit={inspect} className="mt-4 grid gap-3 md:grid-cols-2">
      <fieldset disabled={busy} className="contents">
        <label className="text-sm">Pembelian
          <select required value={purchaseId} onChange={field(setPurchaseId)} className="mt-1 w-full rounded border p-2">
            <option value="">Pilih pembelian bahan</option>
            {purchases.filter(x => x.purchaseType === 'INGREDIENT').map(x => <option key={x.id} value={String(x.id)}>{x.tanggal} — {x.itemNama} — #{x.id}</option>)}
          </select>
        </label>
        <label className="text-sm">Tindakan
          <select value={action} onChange={field(setAction)} className="mt-1 w-full rounded border p-2">
            <option value="review-post">Catat jurnal pembelian dan pembayaran</option>
            <option value="review-correction">Koreksi harga atau akun pembayaran</option>
          </select>
        </label>
        <label className="text-sm">Pembayaran berasal dari
          <select required value={cashAccount} onChange={field(setCashAccount)} className="mt-1 w-full rounded border p-2">
            <option value="">Pilih kas atau bank</option><option value="1010">Kas tunai</option><option value="1020">Bank</option>
          </select>
        </label>
        <label className="text-sm">Referensi nota dan bukti pembayaran
          <input required minLength={6} maxLength={500} value={evidenceRef} onChange={field(setEvidenceRef)} className="mt-1 w-full rounded border p-2" placeholder="Nomor nota / lokasi bukti yang telah diperiksa" />
        </label>
        {action === 'review-correction' && <label className="text-sm">Harga per sediaan yang benar (Rp)
          <input required type="number" min="0.01" step="0.01" value={newUnitPrice} onChange={field(setNewUnitPrice)} className="mt-1 w-full rounded border p-2" />
          <span className="mt-1 block text-xs text-slate-500">Untuk koreksi akun saja, isi harga per sediaan saat ini. Harga setelah bahan terpakai memerlukan rekonsiliasi biaya.</span>
        </label>}
        <div className="flex items-end"><button disabled={busy} className="rounded bg-slate-700 px-4 py-2 text-white disabled:opacity-50">{busy ? 'Memproses…' : 'Periksa sebelum mencatat'}</button></div>
      </fieldset>
    </form>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="mt-3 text-sm text-green-800">{message}</p>}
    {s && <div className="mt-4 rounded border bg-slate-50 p-4 text-sm">
      <p>Pembelian #{s.purchaseId}: {s.quantity} {s.unit}. Total tercatat: <Currency value={s.total} />.</p>
      <p className="mt-1">Jumlah sediaan: {s.packageQuantity || 'belum tercatat'}. Harga per sediaan saat ini: <Currency value={s.unitPrice} />.</p>
      {s.newUnitPrice && <p className="mt-1">Harga koreksi per sediaan: <Currency value={s.newUnitPrice} />. Total setelah koreksi: <Currency value={s.newTotal} />.</p>}
      <p className="mt-1">Akun pembayaran: {s.cashAccount === '1010' ? 'Kas tunai' : 'Bank'}. Bukti: {s.evidenceRef}.</p>
      {review.mayConfirm ? <><p className="mt-2">Pastikan nota dan sumber pembayaran sudah sesuai. Pemeriksaan berlaku lima menit.</p>
        <button type="button" disabled={busy} onClick={confirm} className="mt-3 rounded bg-amber-700 px-4 py-2 font-medium text-white disabled:opacity-50">Konfirmasi dan catat jurnal</button></>
        : <p role="status" className="mt-3 text-amber-800">Jurnal belum dapat dicatat: saldo awal belum disahkan atau periode transaksi belum dibuka.</p>}
    </div>}
  </section>;
}
