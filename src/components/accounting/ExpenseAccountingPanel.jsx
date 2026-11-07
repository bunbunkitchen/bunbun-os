import { useState } from 'react';
import Currency from '../ui/Currency';
import { periodExpenseAccounts, requestExpenseAccounting } from '../../services/accountingExpenseService';

export default function ExpenseAccountingPanel({ expenses, onPosted }) {
  const [expenseId, setExpenseId] = useState('');
  const [action, setAction] = useState('review-post');
  const [cashAccount, setCashAccount] = useState('');
  const [expenseAccount, setExpenseAccount] = useState('');
  const [evidenceRef, setEvidenceRef] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [nonProductionConfirmed, setNonProductionConfirmed] = useState(false);
  const [review, setReview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  function changed() { setReview(null); setError(''); setMessage(''); }
  const field = setter => event => { setter(event.target.value); changed(); };
  async function inspect(event) {
    event.preventDefault(); setBusy(true); setReview(null); setError(''); setMessage('');
    try { setReview(await requestExpenseAccounting({ action, expenseId, cashAccount, expenseAccount, evidenceRef,
      nonProductionConfirmed, newAmount: action === 'review-correction' ? newAmount : null })); }
    catch(e) { setError(e.message); } finally { setBusy(false); }
  }
  async function confirm() {
    if (!review?.mayConfirm || !review.reviewToken || busy) return;
    setBusy(true); setError('');
    try {
      const result = await requestExpenseAccounting({ action: 'confirm', reviewToken: review.reviewToken, confirmed: true });
      setReview(null);
      setMessage(result.result?.alreadyProcessed ? 'Pengeluaran ini sudah dijurnal; tidak dicatat dua kali.' : 'Jurnal pengeluaran berhasil dicatat.');
      try { await onPosted?.(); } catch { setMessage('Jurnal berhasil dicatat. Muat ulang halaman untuk memperbarui daftar.'); }
    } catch(e) { setError(e.message); setReview(null); } finally { setBusy(false); }
  }
  const s = review?.summary;
  return <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5">
    <h2 className="text-lg font-semibold text-slate-800">Akuntansi pengeluaran</h2>
    <p className="mt-1 text-sm text-slate-600">Catat biaya periode yang sudah dibayar. Pembayaran dari Purchasing diproses melalui akuntansi pembelian.</p>
    <form onSubmit={inspect} className="mt-4 grid gap-3 md:grid-cols-2">
      <fieldset disabled={busy} className="contents">
        <label className="text-sm">Pengeluaran
          <select required value={expenseId} onChange={field(setExpenseId)} className="mt-1 w-full rounded border p-2">
            <option value="">Pilih pengeluaran di luar Purchasing</option>
            {expenses.filter(x => x.purchaseId == null).map(x => <option key={x.id} value={String(x.id)}>{x.tanggal} — {x.kategori} — #{x.id}</option>)}
          </select>
        </label>
        <label className="text-sm">Tindakan
          <select value={action} onChange={field(setAction)} className="mt-1 w-full rounded border p-2">
            <option value="review-post">Catat jurnal pengeluaran</option><option value="review-correction">Koreksi nominal atau akun</option>
          </select>
        </label>
        <label className="text-sm">Jenis biaya
          <select required value={expenseAccount} onChange={field(setExpenseAccount)} className="mt-1 w-full rounded border p-2">
            <option value="">Pilih klasifikasi biaya</option>
            {Object.entries(periodExpenseAccounts).map(([code,label]) => <option key={code} value={code}>{label}</option>)}
          </select>
        </label>
        <label className="text-sm">Dibayar dari
          <select required value={cashAccount} onChange={field(setCashAccount)} className="mt-1 w-full rounded border p-2">
            <option value="">Pilih kas atau bank</option><option value="1010">Kas tunai</option><option value="1020">Bank</option>
          </select>
        </label>
        <label className="text-sm">Referensi bukti pembayaran
          <input required minLength={6} maxLength={500} value={evidenceRef} onChange={field(setEvidenceRef)} className="mt-1 w-full rounded border p-2" />
        </label>
        {action === 'review-correction' && <label className="text-sm">Nominal pembayaran yang benar (Rp)
          <input required type="number" min="0.01" step="0.01" value={newAmount} onChange={field(setNewAmount)} className="mt-1 w-full rounded border p-2" />
        </label>}
        <label className="flex items-start gap-2 text-sm md:col-span-2">
          <input required type="checkbox" checked={nonProductionConfirmed} onChange={event => { setNonProductionConfirmed(event.target.checked); changed(); }} />
          Saya sudah memeriksa bahwa ini biaya periode nonproduksi, bukan pembelian bahan, biaya yang masuk HPP produksi, aset, atau prive.
        </label>
        <button disabled={busy} className="justify-self-start rounded bg-slate-700 px-4 py-2 text-white disabled:opacity-50">{busy ? 'Memproses…' : 'Periksa sebelum mencatat'}</button>
      </fieldset>
    </form>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="mt-3 text-sm text-green-800">{message}</p>}
    {s && <div className="mt-4 rounded border bg-slate-50 p-4 text-sm">
      <p>Pengeluaran #{s.expenseId}, {s.date}: <Currency value={s.amount} />.</p>
      {s.newAmount && <p className="mt-1">Nominal setelah koreksi: <Currency value={s.newAmount} />.</p>}
      <p className="mt-1">{s.expenseLabel}, dibayar dari {s.cashAccount === '1010' ? 'kas tunai' : 'bank'}. Bukti: {s.evidenceRef}.</p>
      {review.mayConfirm ? <><p className="mt-2">Periksa bukti dan klasifikasi biaya. Pemeriksaan berlaku lima menit.</p>
        <button type="button" disabled={busy} onClick={confirm} className="mt-3 rounded bg-amber-700 px-4 py-2 font-medium text-white disabled:opacity-50">Konfirmasi dan catat jurnal</button></>
        : <p role="status" className="mt-3 text-amber-800">Jurnal belum dapat dicatat: saldo awal belum disahkan atau periode belum dibuka.</p>}
    </div>}
  </section>;
}
