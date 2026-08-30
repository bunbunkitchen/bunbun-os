import { useRef, useState } from "react";

import { createProductStockOperationKey } from "../../services/productStockService";
import Button from "../ui/Button";
import Input from "../ui/Input";

const DESTINATIONS = [
  "The Public Coffee",
  "Penjualan Event",
  "Pesanan Langsung",
  "Sampel/Complimentary",
  "Penyesuaian Stok",
  "Lainnya",
];

function getLocalDate() {
  const now = new Date();
  const timezoneOffset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - timezoneOffset).toISOString().slice(0, 10);
}

export default function FinishedProductReleaseForm({ products = [], onSave, onCancel }) {
  const [movementDate, setMovementDate] = useState(getLocalDate());
  const [destination, setDestination] = useState("The Public Coffee");
  const [otherDestination, setOtherDestination] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState([{ productId: "", qty: "" }]);
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const operationKeyRef = useRef(createProductStockOperationKey());

  const availableProducts = products.filter((item) => item.saldo > 0);

  function updateRow(index, field, value) {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row));
    setError("");
  }

  function addRow() {
    setRows((current) => [...current, { productId: "", qty: "" }]);
  }

  function removeRow(index) {
    setRows((current) => current.length === 1 ? current : current.filter((_, rowIndex) => rowIndex !== index));
    setError("");
  }

  function getBalance(productId) {
    return availableProducts.find((item) => String(item.productId) === String(productId))?.saldo ?? 0;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const finalDestination = destination === "Lainnya" ? otherDestination.trim() : destination;
    const selected = rows.filter((row) => row.productId || row.qty);

    if (!movementDate) {
      setError("Tanggal pengeluaran wajib diisi.");
      return;
    }
    if (!finalDestination) {
      setError("Tujuan / keperluan wajib diisi.");
      return;
    }
    if (destination === "Penyesuaian Stok" && !notes.trim()) {
      setError("Untuk penyesuaian stok, catatan wajib diisi.");
      return;
    }
    if (!selected.length) {
      setError("Minimal pilih satu produk dan jumlahnya.");
      return;
    }

    const seen = new Set();
    const items = [];
    for (const row of selected) {
      const productId = Number(row.productId);
      const quantity = Number(row.qty);
      if (!Number.isInteger(productId) || !Number.isInteger(quantity) || quantity <= 0) {
        setError("Setiap produk harus memiliki jumlah bilangan bulat lebih dari 0.");
        return;
      }
      if (seen.has(productId)) {
        setError("Produk yang sama tidak boleh dipilih dua kali. Gabungkan jumlahnya dalam satu baris.");
        return;
      }
      if (quantity > getBalance(productId)) {
        const product = availableProducts.find((item) => item.productId === productId);
        setError(`Jumlah ${product?.productNama || "produk"} melebihi stok tersedia (${getBalance(productId)} pcs).`);
        return;
      }
      seen.add(productId);
      items.push({ productId, quantity });
    }

    setError("");
    setIsSaving(true);
    try {
      await onSave({ movementDate, destination: finalDestination, notes: notes.trim(), items, operationKey: operationKeyRef.current });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Keluarkan Produk Jadi</h2>
        <p className="mt-1 text-sm text-gray-500">Satu pengeluaran dapat berisi beberapa jenis produk sekaligus.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="block space-y-1 text-sm font-medium text-gray-700">
          <span>Tanggal Pengeluaran</span>
          <Input type="date" value={movementDate} disabled={isSaving} onChange={(event) => { setMovementDate(event.target.value); setError(""); }} />
        </label>
        <label className="block space-y-1 text-sm font-medium text-gray-700">
          <span>Tujuan / Keperluan</span>
          <select className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:border-amber-600" value={destination} disabled={isSaving} onChange={(event) => { setDestination(event.target.value); setError(""); }}>
            {DESTINATIONS.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
      </div>

      {destination === "Lainnya" && (
        <label className="block space-y-1 text-sm font-medium text-gray-700">
          <span>Nama Kafe / Keperluan Lainnya</span>
          <Input type="text" value={otherDestination} disabled={isSaving} placeholder="Contoh: Kafe XYZ" onChange={(event) => { setOtherDestination(event.target.value); setError(""); }} />
        </label>
      )}

      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-800">Produk yang Dikeluarkan</h3>
            <p className="text-xs text-gray-500">Pilih beberapa produk dan jumlahnya. Stok akan berkurang sesuai input.</p>
          </div>
          <Button type="button" onClick={addRow} disabled={isSaving}>+ Tambah Produk</Button>
        </div>

        <div className="space-y-3">
          {rows.map((row, index) => {
            const balance = getBalance(row.productId);
            return (
              <div key={index} className="grid gap-3 rounded-xl border border-gray-200 p-3 md:grid-cols-[minmax(0,1fr)_160px_auto] md:items-end">
                <label className="block space-y-1 text-sm font-medium text-gray-700">
                  <span>Produk {index + 1}</span>
                  <select className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:border-amber-600" value={row.productId} disabled={isSaving} onChange={(event) => updateRow(index, "productId", event.target.value)}>
                    <option value="">Pilih produk</option>
                    {availableProducts.map((item) => <option key={item.productId} value={item.productId}>{item.productNama} — stok {item.saldo} pcs</option>)}
                  </select>
                </label>
                <label className="block space-y-1 text-sm font-medium text-gray-700">
                  <span>Jumlah {row.productId ? `(maks. ${balance})` : ""}</span>
                  <Input type="number" min="1" max={balance || undefined} step="1" value={row.qty} disabled={isSaving || !row.productId} placeholder="Qty" onChange={(event) => updateRow(index, "qty", event.target.value)} />
                </label>
                <Button type="button" onClick={() => removeRow(index)} disabled={isSaving || rows.length === 1} className="bg-gray-200 text-gray-700 hover:bg-gray-300">Hapus</Button>
              </div>
            );
          })}
        </div>
      </div>

      <label className="block space-y-1 text-sm font-medium text-gray-700">
        <span>Catatan {destination === "Penyesuaian Stok" ? "(wajib)" : "(opsional)"}</span>
        <textarea className="min-h-24 w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:border-amber-600" value={notes} disabled={isSaving} placeholder={destination === "Penyesuaian Stok" ? "Contoh: hasil stock opname, selisih fisik -2 pcs" : "Contoh: titip jual shift pagi"} onChange={(event) => { setNotes(event.target.value); setError(""); }} />
      </label>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Pengeluaran ini mengurangi stok produk jadi. Semua produk dalam satu pengeluaran diproses sekaligus.</div>

      <div className="flex justify-end gap-3">
        <Button type="button" onClick={onCancel} disabled={isSaving} className="bg-gray-200 text-gray-700 hover:bg-gray-300">Batal</Button>
        <Button type="submit" disabled={isSaving}>{isSaving ? "Menyimpan..." : "Simpan Pengeluaran"}</Button>
      </div>
    </form>
  );
}
