import { useRef, useState } from "react";

import { createProductStockOperationKey } from "../../services/productStockService";
import Button from "../ui/Button";
import Input from "../ui/Input";

const DESTINATIONS = [
  "Sewangi Cafe",
  "Penjualan Event",
  "Pesanan Langsung",
  "Sampel / Complimentary",
  "Lainnya",
];

export default function FinishedProductReleaseForm({ item, onSave, onCancel }) {
  const [qty, setQty] = useState("");
  const [destination, setDestination] = useState("Sewangi Cafe");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const operationKeyRef = useRef(createProductStockOperationKey());

  async function handleSubmit(event) {
    event.preventDefault();
    const quantity = Number(qty);

    if (!Number.isInteger(quantity) || quantity <= 0) {
      setError("Jumlah harus berupa bilangan bulat lebih dari 0.");
      return;
    }

    if (quantity > item.saldo) {
      setError("Jumlah tidak boleh melebihi stok produk jadi.");
      return;
    }

    setError("");
    setIsSaving(true);

    try {
      await onSave({
        qty: quantity,
        destination,
        notes: notes.trim(),
        operationKey: operationKeyRef.current,
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Keluarkan Produk Jadi</h2>
        <p className="mt-1 text-sm text-gray-500">
          {item.productNama} · Stok {item.saldo} pcs
        </p>
      </div>

      <label className="block space-y-1 text-sm font-medium text-gray-700">
        <span>Jumlah</span>
        <Input
          type="number"
          min="1"
          max={item.saldo}
          step="1"
          placeholder="Jumlah produk keluar"
          value={qty}
          disabled={isSaving}
          onChange={(event) => {
            setQty(event.target.value);
            setError("");
          }}
        />
        {error && <span className="text-xs text-red-600">{error}</span>}
      </label>

      <label className="block space-y-1 text-sm font-medium text-gray-700">
        <span>Tujuan</span>
        <select
          className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:border-amber-600"
          value={destination}
          disabled={isSaving}
          onChange={(event) => setDestination(event.target.value)}
        >
          {DESTINATIONS.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      </label>

      <label className="block space-y-1 text-sm font-medium text-gray-700">
        <span>Catatan (opsional)</span>
        <textarea
          className="min-h-24 w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:border-amber-600"
          value={notes}
          disabled={isSaving}
          placeholder="Contoh: titip jual shift pagi"
          onChange={(event) => setNotes(event.target.value)}
        />
      </label>

      <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
        Transaksi ini hanya mengurangi stok produk. Omzet tetap dicatat terpisah di menu Pemasukan.
      </div>

      <div className="flex justify-end gap-3">
        <Button
          type="button"
          onClick={onCancel}
          disabled={isSaving}
          className="bg-gray-200 text-gray-700 hover:bg-gray-300"
        >
          Batal
        </Button>
        <Button type="submit" disabled={isSaving}>
          {isSaving ? "Menyimpan..." : "Simpan Pengeluaran"}
        </Button>
      </div>
    </form>
  );
}
