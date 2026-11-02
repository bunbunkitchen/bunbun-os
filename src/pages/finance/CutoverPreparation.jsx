import { useMemo, useState } from "react";
import { getProposedCutoverInventory } from "../../services/hppCutoverService";
import {
  isValidIsoDate, evaluateCutoverDraft, OPENING_FINANCIAL_FIELDS,
} from "../../utils/hppCutoverOpening";

const rupiah = value => value == null ? "Belum lengkap" :
  Number(value).toLocaleString("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });

function downloadText(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Revocation occurs after the user-initiated download has been scheduled.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function csvCell(value) {
  const source = String(value == null ? "" : value).replace(/\r?\n/g, " ");
  const safe = /^[=+\-@\t]/.test(source.trimStart()) ? "'" + source : source;
  return '"' + safe.replace(/"/g, '""') + '"';
}

export default function CutoverPreparation() {
  const [date, setDate] = useState("");
  const [review, setReview] = useState(null);
  const [physical, setPhysical] = useState({});
  const [financial, setFinancial] = useState({});
  const [notes, setNotes] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [importError, setImportError] = useState("");

  const computed = useMemo(() => {
    if (!review) return { result: null, error: "" };
    try {
      return { result: evaluateCutoverDraft({ review, financial, physical }), error: "" };
    } catch (e) {
      return { result: null, error: e.message || "Input belum valid." };
    }
  }, [review, financial, physical]);

  const filtered = useMemo(() => review?.rows.filter(item =>
    (item.ingredientName + " " + item.unit).toLowerCase().includes(search.toLowerCase())
  ) ?? [], [review, search]);

  async function loadReview(event) {
    event.preventDefault();
    setError("");
    if (!isValidIsoDate(date)) {
      setError("Pilih tanggal mulai pencatatan baru yang valid.");
      return;
    }
    setBusy(true);
    setReview(null);
    try {
      setReview(await getProposedCutoverInventory(date));
    } catch (e) {
      setError(e.message || "Saldo buku tidak dapat dibaca.");
    } finally {
      setBusy(false);
    }
  }

  function changePhysical(id, key, value) {
    setPhysical(previous => ({
      ...previous,
      [String(id)]: { ...previous[String(id)], [key]: value },
    }));
  }

  function exportDraft() {
    if (!review) return;
    const payload = {
      format: "bunbun-cutover-draft-v1",
      cutoverDate: review.cutoverDate,
      exportedAt: new Date().toISOString(),
      financialEntries: financial,
      physicalEntries: physical,
      notes,
      // Never export authorization, never post to accounting.
      accountingStatus: "DRAFT_NOT_POSTED",
    };
    downloadText("bunbun-saldo-awal-draft-" + review.cutoverDate + ".json",
      JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
  }

  function exportOpnameCsv() {
    if (!review) return;
    const rows = [
      ["ID bahan", "Nama bahan", "Satuan master", "Saldo buku (referensi)", "Stok opname", "Nilai per satuan master (Rp)", "Dasar harga/bukti", "Alasan selisih"].map(csvCell).join(","),
      ...review.rows.map(item => {
        const input = physical[String(item.ingredientId)] || {};
        return [
          item.ingredientId, item.ingredientName, item.unit,
          item.bookQty == null ? "Perlu verifikasi" : item.bookQty,
          input.qty || "", input.unitCost || "", input.costSource || "", input.varianceNote || "",
        ].map(csvCell).join(",");
      }),
    ].join("\r\n");
    downloadText("bunbun-form-stok-opname-" + review.cutoverDate + ".csv",
      "\uFEFF" + rows, "text/csv;charset=utf-8");
  }

  async function importDraft(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportError("");
    try {
      if (file.size > 2_000_000) throw new Error("Ukuran draft terlalu besar.");
      const incoming = JSON.parse(await file.text());
      if (incoming?.format !== "bunbun-cutover-draft-v1" ||
        !isValidIsoDate(incoming.cutoverDate)) throw new Error("Format draft tidak sesuai.");
      const nextFinancial = {};
      for (const field of OPENING_FINANCIAL_FIELDS) {
        const value = incoming.financialEntries?.[field.key] ?? "";
        nextFinancial[field.key] = String(value);
      }
      const nextPhysical = {};
      if (incoming.physicalEntries && typeof incoming.physicalEntries === "object") {
        for (const [id, values] of Object.entries(incoming.physicalEntries)) {
          if (!/^\d+$/.test(id) || !values || typeof values !== "object") continue;
          nextPhysical[id] = {
            qty: String(values.qty ?? ""),
            unitCost: String(values.unitCost ?? ""),
            costSource: String(values.costSource ?? "").slice(0, 500),
            varianceNote: String(values.varianceNote ?? "").slice(0, 500),
          };
        }
      }
      setBusy(true);
      setReview(null);
      setDate(incoming.cutoverDate);
      const fetched = await getProposedCutoverInventory(incoming.cutoverDate);
      setFinancial(nextFinancial);
      setPhysical(nextPhysical);
      setNotes(String(incoming.notes ?? "").slice(0, 2000));
      setReview(fetched);
    } catch (e) {
      setImportError(e.message || "Draft tidak bisa dibuka.");
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  return (
    <div className="space-y-6 pb-12">
      <div>
        <h1 className="text-2xl font-bold text-[#595E48]">Persiapan Saldo Awal</h1>
        <p className="mt-1 text-sm text-[#777A6D]">
          Siapkan titik awal akuntansi yang dapat diverifikasi tanpa mengubah data Bunbun OS yang lama.
        </p>
      </div>
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <strong>Mode draft — belum aktif.</strong> Data pada formulir ini tidak otomatis tersimpan di database.
        Unduh file draft sebelum meninggalkan halaman. Angka saldo buku hanya pembanding, bukan stok fisik
        atau saldo awal yang sudah disahkan. Tanggal cutover belum ditetapkan secara resmi.
      </div>
      <div className="rounded-xl border bg-white p-5">
        <h2 className="mb-3 text-lg font-semibold">1. Tentukan tanggal mulai pencatatan baru</h2>
        <form onSubmit={loadReview} className="flex flex-wrap items-end gap-3">
          <label className="block text-sm">
            <span className="mb-1 block font-semibold">Tanggal cutover (usulan)</span>
            <input type="date" required value={date}
              onChange={e => {
                setDate(e.target.value); setReview(null); setPhysical({});
                setError(""); setFinancial({}); setNotes("");
              }}
              className="rounded-lg border px-3 py-2" />
          </label>
          <button type="submit" disabled={busy || !date}
            className="rounded-lg bg-[#595E48] px-4 py-2 text-white disabled:opacity-50">
            {busy ? "Memuat..." : "Tampilkan stok menurut sistem"}
          </button>
          <label className="rounded-lg border px-4 py-2 text-sm font-semibold cursor-pointer">
            Buka draft JSON
            <input type="file" className="sr-only" accept=".json,application/json" onChange={importDraft}/>
          </label>
        </form>
        <p className="mt-2 text-xs text-[#777A6D]">
          Stok buku dihitung dari transaksi sebelum tanggal ini, bukan pada atau sesudahnya.
        </p>
        {error && <p role="alert" className="mt-2 text-red-700">{error}</p>}
        {importError && <p role="alert" className="mt-2 text-red-700">{importError}</p>}
      </div>
      {review && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border bg-white p-4">
              <p className="text-sm text-[#777A6D]">Master bahan</p>
              <p className="text-2xl font-bold">{review.rows.length}</p>
            </div>
            <div className="rounded-xl border bg-white p-4">
              <p className="text-sm text-[#777A6D]">Saldo buku perlu verifikasi</p>
              <p className="text-2xl font-bold">{review.rows.length - review.reliableRowCount}</p>
            </div>
            <div className="rounded-xl border bg-white p-4">
              <p className="text-sm text-[#777A6D]">Item belum selesai</p>
              <p className="text-2xl font-bold">{computed.result?.issues.length ?? "—"}</p>
              <p className="text-xs">Termasuk biaya/kas dan stok opname</p>
            </div>
          </div>
          <section className="rounded-xl border bg-white p-5">
            <h2 className="text-lg font-semibold">2. Saldo keuangan hasil verifikasi</h2>
            <p className="mt-1 text-sm text-[#777A6D]">
              Isi 0 hanya jika benar-benar nihil. Saldo rekening tidak boleh dihitung hanya dari setoran kafe
              dikurangi pengeluaran, karena bisa ada modal, transfer, atau transaksi di luar OS.
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {OPENING_FINANCIAL_FIELDS.map(item => (
                <label key={item.key} className="block text-sm">
                  <span className="mb-1 block font-semibold">{item.label}</span>
                  <input type="number" min="0" step="any" placeholder="Belum diisi"
                    className="w-full rounded-lg border px-3 py-2"
                    value={financial[item.key] ?? ""}
                    onChange={e => setFinancial(old => ({...old, [item.key]:e.target.value}))}
                  />
                </label>
              ))}
            </div>
          </section>
          <section className="rounded-xl border bg-white p-5">
            <h2 className="text-lg font-semibold">3. Stok opname bahan baku</h2>
            <p className="mt-1 text-sm text-[#777A6D]">
              Masukkan jumlah fisik dan biaya per satuan master (contoh Rp/kg, bukan Rp/gram,
              jika satuannya kg). Harga master resep tidak diubah. Stock frozen, produk jadi,
              dan stok titipan kafe dinilai terpisah agar tidak terhitung dua kali.
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <input aria-label="Cari bahan" placeholder="Cari nama bahan..." value={search}
                onChange={e => setSearch(e.target.value)}
                className="rounded-lg border px-3 py-2" />
              <button type="button" onClick={exportOpnameCsv}
                className="rounded-lg border px-4 py-2 text-sm font-semibold">
                Unduh formulir stok opname (CSV)
              </button>
            </div>
            <div className="mt-3 max-h-[560px] overflow-auto">
              <table className="w-full min-w-[1020px] text-left text-sm">
                <thead className="sticky top-0 bg-[#F1F3ED]">
                  <tr>
                    <th className="p-2">Bahan</th><th className="p-2">Buku (referensi)</th>
                    <th className="p-2">Fisik</th><th className="p-2">Biaya per satuan</th>
                    <th className="p-2">Dasar harga</th><th className="p-2">Alasan selisih</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(item => {
                    const value = physical[String(item.ingredientId)] || {};
                    return (
                      <tr key={item.ingredientId} className="border-t align-top">
                        <td className="p-2 font-medium">
                          {item.ingredientName}
                          <span className="block text-xs font-normal text-[#777A6D]">{item.unit}</span>
                          {!item.isReliable && <span className="text-xs text-amber-700">Buku perlu diperiksa</span>}
                        </td>
                        <td className="p-2">{item.bookQty == null ? "Tidak valid" :
                          item.bookQty.toLocaleString("id-ID", {maximumFractionDigits:6}) + " " + item.unit}</td>
                        <td className="p-2"><input type="number" min="0" step="any"
                          aria-label={"Fisik " + item.ingredientName}
                          className="w-28 rounded border px-2 py-1" placeholder="Jumlah"
                          value={value.qty ?? ""} onChange={e => changePhysical(item.ingredientId,"qty",e.target.value)}/></td>
                        <td className="p-2"><input type="number" min="0" step="any"
                          aria-label={"Harga " + item.ingredientName}
                          className="w-32 rounded border px-2 py-1" placeholder="Rupiah"
                          value={value.unitCost ?? ""} onChange={e => changePhysical(item.ingredientId,"unitCost",e.target.value)}/></td>
                        <td className="p-2"><input type="text"
                          aria-label={"Bukti " + item.ingredientName}
                          className="w-44 rounded border px-2 py-1" placeholder="Faktur/opname"
                          value={value.costSource ?? ""} maxLength={500}
                          onChange={e => changePhysical(item.ingredientId,"costSource",e.target.value)}/></td>
                        <td className="p-2"><input type="text"
                          aria-label={"Selisih " + item.ingredientName}
                          className="w-44 rounded border px-2 py-1" placeholder="Jika ada selisih"
                          value={value.varianceNote ?? ""} maxLength={500}
                          onChange={e => changePhysical(item.ingredientId,"varianceNote",e.target.value)}/></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
          <section className="rounded-xl border bg-white p-5">
            <h2 className="text-lg font-semibold">4. Tinjau kesiapan saldo awal</h2>
            <label className="mt-3 block text-sm">
              <span className="mb-1 block font-semibold">Catatan pemilik / bukti opname</span>
              <textarea value={notes} maxLength={2000}
                onChange={e => setNotes(e.target.value)} rows={3}
                className="w-full rounded-lg border px-3 py-2" placeholder="Lokasi stok, tanggal hitung fisik, dokumen rekening..."/>
            </label>
            {computed.error && <p role="alert" className="mt-2 text-red-700">{computed.error}</p>}
            {computed.result?.balance && (
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <div className="rounded-lg bg-[#F1F3ED] p-3"><p className="text-xs">Nilai persediaan bahan</p><p className="font-bold">{rupiah(computed.result.balance.rawInventoryValue)}</p></div>
                <div className="rounded-lg bg-[#F1F3ED] p-3"><p className="text-xs">Aset dikurangi utang (sementara)</p><p className="font-bold">{rupiah(computed.result.balance.openingEquityByDifference)}</p></div>
                <div className="rounded-lg bg-amber-50 p-3"><p className="text-xs">Status</p><p className="font-bold text-amber-800">BELUM DIPOSTING</p></div>
              </div>
            )}
            <p className="mt-3 text-sm font-semibold">
              Status: {computed.result?.status || "INPUT BELUM VALID"}
              {" "}— Aktivasi ke jurnal dan stock hanya setelah review terpisah.
            </p>
            {computed.result?.issues.length > 0 && (
              <div className="mt-3 rounded-lg border border-amber-200 p-3">
                <p className="text-sm font-semibold text-amber-900">Contoh item yang belum selesai:</p>
                <ul className="mt-2 list-disc pl-5 text-sm">
                  {computed.result.issues.slice(0, 8).map((issue, index) => <li key={index}>{issue}</li>)}
                </ul>
                {computed.result.issues.length > 8 && <p className="mt-2 text-xs">Masih ada {computed.result.issues.length - 8} item lain.</p>}
              </div>
            )}
            {computed.result?.warnings.length > 0 && (
              <div className="mt-3 rounded-lg border border-[#D9D8D0] bg-[#F1F3ED] p-3">
                <p className="text-sm font-semibold">Catatan ketidaksesuaian data lama (tidak menghalangi draft saldo awal baru):</p>
                <ul className="mt-2 list-disc pl-5 text-sm">
                  {computed.result.warnings.slice(0, 6).map((warning, index) => <li key={index}>{warning}</li>)}
                </ul>
                {computed.result.warnings.length > 6 && (
                  <p className="mt-2 text-xs">Masih ada {computed.result.warnings.length - 6} catatan historis lain.</p>
                )}
              </div>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={exportDraft}
                className="rounded-lg bg-[#595E48] px-4 py-2 text-sm font-semibold text-white">
                Simpan draft ke file JSON
              </button>
              <button type="button" onClick={exportOpnameCsv}
                className="rounded-lg border px-4 py-2 text-sm font-semibold">
                Export stok opname CSV
              </button>
            </div>
            <p className="mt-2 text-xs text-[#777A6D]">
              File disimpan di perangkat yang digunakan. Tidak ada jurnal, pengeluaran kas,
              penyesuaian stok, atau HPP historis yang dibuat dari formulir ini.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
