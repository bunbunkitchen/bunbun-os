import { buildOpeningJournalPreview, buildOpeningFinancialPosition } from "../../utils/accountingOpeningJournal";

const rupiah = value => Number(value || 0).toLocaleString("id-ID", {
  style: "currency", currency: "IDR", maximumFractionDigits: 0,
});

export default function OpeningJournalPreview({ draft }) {
  if (!draft) return null;
  if (draft.issues?.length || !draft.balance) {
    return (
      <section className="rounded-xl border border-[#D9D8D0] bg-white p-5">
        <h2 className="text-lg font-semibold">5. Pratinjau jurnal saldo awal</h2>
        <p className="mt-2 text-sm text-[#777A6D]">
          Pratinjau jurnal akan tersedia setelah saldo kas, bank, kewajiban,
          stok fisik, dan dasar nilai persediaan dilengkapi. Ini tidak akan
          mengubah stok atau keuangan yang sudah tercatat.
        </p>
      </section>
    );
  }
  let journal;
  let position;
  try {
    journal = buildOpeningJournalPreview(draft);
    position = buildOpeningFinancialPosition(journal);
  } catch (error) {
    return (
      <section className="rounded-xl border bg-white p-5">
        <h2 className="text-lg font-semibold">5. Pratinjau jurnal saldo awal</h2>
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error.message || "Jurnal belum dapat diperiksa."}
        </p>
      </section>
    );
  }
  return (
    <section className="rounded-xl border bg-white p-5">
      <h2 className="text-lg font-semibold">5. Pratinjau jurnal saldo awal</h2>
      <p className="mt-1 text-sm text-[#777A6D]">
        Perhitungan debit dan kredit berdasarkan draft; bukan jurnal resmi,
        belum disimpan, dan belum menyatakan tanggal cutover telah disetujui.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[600px] text-sm">
          <thead className="bg-[#F1F3ED] text-left">
            <tr><th className="p-2">Akun</th><th className="p-2 text-right">Debit</th><th className="p-2 text-right">Kredit</th></tr>
          </thead>
          <tbody>
            {journal.lines.map(line => (
              <tr key={line.accountCode} className="border-b">
                <td className="p-2">{line.accountCode} — {line.accountName}</td>
                <td className="p-2 text-right">{line.debit ? rupiah(line.debit) : "—"}</td>
                <td className="p-2 text-right">{line.credit ? rupiah(line.credit) : "—"}</td>
              </tr>
            ))}
            <tr className="font-bold">
              <td className="p-2">TOTAL (SEIMBANG)</td>
              <td className="p-2 text-right">{rupiah(journal.totals.debit)}</td>
              <td className="p-2 text-right">{rupiah(journal.totals.credit)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <h3 className="mt-4 font-semibold">Simulasi posisi keuangan pada tanggal awal</h3>
      <div className="mt-2 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-[#F1F3ED] p-3">
          <p className="text-xs">Total aset</p>
          <p className="text-lg font-semibold">{rupiah(position.totals.assets)}</p>
        </div>
        <div className="rounded-lg bg-[#F1F3ED] p-3">
          <p className="text-xs">Total kewajiban</p>
          <p className="text-lg font-semibold">{rupiah(position.totals.liabilities)}</p>
        </div>
        <div className="rounded-lg bg-amber-50 p-3">
          <p className="text-xs">Ekuitas awal penyeimbang*</p>
          <p className="text-lg font-semibold">{rupiah(position.totals.equity)}</p>
        </div>
      </div>
      <p className="mt-3 text-xs text-amber-900">
        * Ekuitas awal hanya selisih aset dan kewajiban; belum tentu modal yang
        pernah disetor Owner atau laba periode sebelumnya. Jurnal seimbang
        secara matematika tidak berarti nilai stok/bank sudah diverifikasi.
      </p>
      <p className="mt-2 text-xs text-[#777A6D]">
        Laba rugi, arus kas, dan dana tersedia untuk bonus belum dapat dihitung
        hanya dari saldo awal. Dibutuhkan transaksi yang benar sesudah cutover.
      </p>
    </section>
  );
}
