import { useEffect, useState } from "react";
import { getAllIngredients } from "../../services/ingredientService";
import { getHistoricalIngredientAudit } from "../../services/hppHistoricalValuationService";

const LABELS = {
  OPENING_BALANCE_UNVERIFIED: "Saldo awal belum diverifikasi",
  USE_BEFORE_FIRST_PURCHASE: "Pemakaian mendahului pembelian pertama",
  SAME_DAY_ORDER_UNVERIFIED: "Urutan masuk/keluar pada tanggal sama belum diverifikasi",
  PURCHASE_COST_UNCONFIRMED: "Nilai pembelian nol / tidak tersedia",
  PURCHASE_QUANTITY_MISMATCH: "Jumlah pembelian dan inventory berbeda",
  PURCHASE_LINK_INVALID: "Tautan pembelian tidak valid",
  UNIT_OR_QUANTITY_INVALID: "Satuan atau jumlah tidak valid",
  NON_PURCHASE_VALUE_MISSING: "Nilai stok non-pembelian hilang",
  INBOUND_VALUE_UNCONFIRMED: "Biaya stok masuk / sub-recipe belum divalidasi",
  NEGATIVE_BALANCE: "Saldo tidak cukup",
  UNSUPPORTED_MOVEMENT: "Jenis transaksi belum didukung",
};

export default function HistoricalInventoryAudit() {
  const [ingredients, setIngredients] = useState([]);
  const [listError, setListError] = useState("");
  const [ingredientId, setIngredientId] = useState("");
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    getAllIngredients()
      .then(data => { if (alive) setIngredients(data); })
      .catch(err => { if (alive) setListError(err.message || "Bahan gagal dimuat."); });
    return () => { alive = false; };
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!ingredientId) return;
    setLoading(true);
    setError("");
    setReport(null);
    try {
      setReport(await getHistoricalIngredientAudit(ingredientId));
    } catch (err) {
      setError(err.message || "Audit bahan gagal dimuat.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-xl border bg-white p-5">
      <h2 className="text-lg font-semibold">Rekonstruksi nilai bahan — MWA</h2>
      <p className="mt-1 text-sm text-[#777A6D]">
        Pemeriksaan per bahan dari transaksi historis. Tidak mengubah harga master,
        stok, atau HPP. Perhitungan nilai ditahan sampai saldo awal disahkan.
      </p>
      {listError && <p role="alert" className="mt-2 text-red-700">{listError}</p>}
      <form className="mt-3 flex flex-wrap gap-2" onSubmit={handleSubmit}>
        <select aria-label="Pilih bahan baku" required value={ingredientId}
          onChange={e => { setIngredientId(e.target.value); setReport(null); setError(""); }}
          className="min-w-52 flex-1 rounded-lg border px-3 py-2">
          <option value="">Pilih bahan baku</option>
          {ingredients.map(item => (
            <option key={item.id} value={item.id}>{item.nama} ({item.satuan})</option>
          ))}
        </select>
        <button type="submit" disabled={loading}
          className="rounded-lg bg-[#595E48] px-4 py-2 text-white disabled:opacity-50">
          {loading ? "Memeriksa..." : "Audit bahan"}
        </button>
      </form>
      {error && <p role="alert" className="mt-3 text-red-700">{error}</p>}
      {report && (
        <div className="mt-4 space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-lg bg-[#F1F3ED] p-3">
              <p className="text-xs text-[#777A6D]">Transaksi aktif</p>
              <p className="text-lg font-semibold">{report.transactionCount.toLocaleString("id-ID")}</p>
            </div>
            <div className="rounded-lg bg-[#F1F3ED] p-3">
              <p className="text-xs text-[#777A6D]">Temuan audit</p>
              <p className="text-lg font-semibold">{report.blockerCount.toLocaleString("id-ID")}</p>
            </div>
            <div className="rounded-lg bg-amber-50 p-3">
              <p className="text-xs text-amber-900">Status HPP historis</p>
              <p className="text-sm font-bold text-amber-900">BELUM TERVALIDASI</p>
            </div>
          </div>
          <p className="text-sm">
            Pembelian pertama: <strong>{report.firstPurchaseDate || "Belum ada"}</strong>.
            {" "}Pemakaian pertama: <strong>{report.firstUseDate || "Belum ada"}</strong>.
          </p>
          <p className="text-sm text-amber-900">
            Saldo awal belum disahkan, sehingga nilai Rupiah persediaan/HPP
            tidak ditampilkan sebagai angka aktual.
          </p>
          <div className="max-h-72 overflow-y-auto rounded-lg border">
            <table className="w-full min-w-[480px] text-sm">
              <thead className="sticky top-0 bg-[#F1F3ED] text-left">
                <tr><th className="p-2">Tanggal</th><th className="p-2">Transaksi</th><th className="p-2">Temuan</th></tr>
              </thead>
              <tbody>
                {report.blockers.slice(0, 60).map((item, i) => (
                  <tr className="border-t" key={item.code + "-" + item.transactionId + "-" + i}>
                    <td className="p-2">{item.date || "Saldo awal"}</td>
                    <td className="p-2">{item.transactionId || "—"}</td>
                    <td className="p-2">{LABELS[item.code] || item.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {report.blockerCount > 60 && (
            <p className="text-xs text-[#777A6D]">
              Ditampilkan 60 dari {report.blockerCount} temuan. Data mentah tidak diubah.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
