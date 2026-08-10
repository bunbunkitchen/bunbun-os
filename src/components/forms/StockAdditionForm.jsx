import { useEffect, useMemo, useRef, useState } from "react";

import Button from "../ui/Button";
import Currency from "../ui/Currency";
import Input from "../ui/Input";
import { getAllIngredients } from "../../services/ingredientService";

const SOURCES = [
  "Stok Pribadi Owner",
  "Bonus Supplier",
  "Koreksi Stok",
  "Lainnya",
];

function createOperationKey() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `stock-add-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function StockAdditionForm({ onSave, onCancel, saving = false }) {
  const [ingredients, setIngredients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formError, setFormError] = useState("");
  const [errors, setErrors] = useState({});
  const operationKeyRef = useRef(createOperationKey());
  const [form, setForm] = useState({
    tanggal: new Date().toISOString().slice(0, 10),
    ingredientId: "",
    jumlah: "",
    satuan: "",
    nilaiSatuan: "",
    sumber: "Stok Pribadi Owner",
    keterangan: "",
  });

  useEffect(() => {
    let active = true;

    async function loadIngredients() {
      try {
        const data = await getAllIngredients();
        if (active) setIngredients(data.filter((item) => item.status === "Aktif"));
      } catch (error) {
        if (active) setFormError(error.message || "Bahan baku gagal dimuat.");
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadIngredients();
    return () => { active = false; };
  }, []);

  const totalValue = useMemo(
    () => (Number(form.jumlah) || 0) * (Number(form.nilaiSatuan) || 0),
    [form.jumlah, form.nilaiSatuan]
  );

  function change(field, value) {
    setForm((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => ({ ...previous, [field]: "" }));
    setFormError("");
  }

  function selectIngredient(value) {
    const ingredient = ingredients.find((item) => item.id === Number(value));
    setForm((previous) => ({
      ...previous,
      ingredientId: value,
      satuan: ingredient?.satuan || "",
      nilaiSatuan: ingredient?.harga > 0 ? String(ingredient.harga) : "",
    }));
    setErrors({});
    setFormError("");
  }

  function validate() {
    const next = {};
    if (!form.tanggal) next.tanggal = "Tanggal wajib diisi";
    if (!form.ingredientId) next.ingredientId = "Bahan baku wajib dipilih";
    if (!(Number(form.jumlah) > 0)) next.jumlah = "Jumlah harus lebih dari 0";
    if (!form.satuan.trim()) next.satuan = "Satuan wajib diisi";
    if (!(Number(form.nilaiSatuan) > 0)) next.nilaiSatuan = "Nilai HPP harus lebih dari 0";
    if (!form.sumber.trim()) next.sumber = "Sumber stok wajib dipilih";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(event) {
    event.preventDefault();
    if (saving || !validate()) return;

    try {
      setFormError("");
      await onSave({
        tanggal: form.tanggal,
        ingredientId: Number(form.ingredientId),
        jumlah: Number(form.jumlah),
        satuan: form.satuan.trim(),
        nilaiSatuan: Number(form.nilaiSatuan),
        sumber: form.sumber.trim(),
        keterangan: form.keterangan.trim(),
        operationKey: operationKeyRef.current,
      });
    } catch (error) {
      setFormError(error.message || "Penambahan stok gagal disimpan.");
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-gray-800">Penambahan Stok</h2>
        <p className="mt-1 text-sm text-gray-500">Stok bertambah tanpa mencatat pengeluaran kas.</p>
      </div>

      {formError && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{formError}</div>}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1 text-sm font-medium text-gray-700">
          <span>Tanggal</span>
          <Input type="date" value={form.tanggal} onChange={(e) => change("tanggal", e.target.value)} disabled={saving} />
          {errors.tanggal && <span className="text-xs text-red-600">{errors.tanggal}</span>}
        </label>

        <label className="space-y-1 text-sm font-medium text-gray-700">
          <span>Bahan Baku</span>
          <select className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:border-amber-600" value={form.ingredientId} onChange={(e) => selectIngredient(e.target.value)} disabled={saving || loading}>
            <option value="">{loading ? "Memuat..." : "Pilih bahan"}</option>
            {ingredients.map((item) => <option key={item.id} value={item.id}>{item.kode} - {item.nama}</option>)}
          </select>
          {errors.ingredientId && <span className="text-xs text-red-600">{errors.ingredientId}</span>}
        </label>

        <label className="space-y-1 text-sm font-medium text-gray-700">
          <span>Jumlah</span>
          <Input type="number" min="0" step="0.001" value={form.jumlah} onChange={(e) => change("jumlah", e.target.value)} disabled={saving} placeholder="Contoh: 1" />
          {errors.jumlah && <span className="text-xs text-red-600">{errors.jumlah}</span>}
        </label>

        <label className="space-y-1 text-sm font-medium text-gray-700">
          <span>Satuan</span>
          <Input value={form.satuan} onChange={(e) => change("satuan", e.target.value)} disabled={saving} placeholder="liter, kg, gram, pcs" />
          {errors.satuan && <span className="text-xs text-red-600">{errors.satuan}</span>}
        </label>

        <label className="space-y-1 text-sm font-medium text-gray-700">
          <span>Nilai HPP per Satuan</span>
          <Input type="number" min="0" step="1" value={form.nilaiSatuan} onChange={(e) => change("nilaiSatuan", e.target.value)} disabled={saving} placeholder="Harga wajar bahan" />
          {errors.nilaiSatuan && <span className="text-xs text-red-600">{errors.nilaiSatuan}</span>}
        </label>

        <label className="space-y-1 text-sm font-medium text-gray-700">
          <span>Sumber</span>
          <select className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:border-amber-600" value={form.sumber} onChange={(e) => change("sumber", e.target.value)} disabled={saving}>
            {SOURCES.map((source) => <option key={source} value={source}>{source}</option>)}
          </select>
          {errors.sumber && <span className="text-xs text-red-600">{errors.sumber}</span>}
        </label>
      </div>

      <label className="block space-y-1 text-sm font-medium text-gray-700">
        <span>Catatan (opsional)</span>
        <textarea className="min-h-24 w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:border-amber-600" value={form.keterangan} onChange={(e) => change("keterangan", e.target.value)} disabled={saving} placeholder="Contoh: susu dari stok rumah" />
      </label>

      <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
        <div>Nilai persediaan: <Currency value={totalValue} /></div>
        <div className="mt-1">Pengeluaran kas: <strong>Rp0</strong></div>
      </div>

      <div className="flex justify-end gap-3">
        <Button type="button" onClick={onCancel} disabled={saving} className="bg-gray-200 text-gray-700 hover:bg-gray-300">Batal</Button>
        <Button type="submit" disabled={saving || loading}>{saving ? "Menyimpan..." : "Simpan Penambahan Stok"}</Button>
      </div>
    </form>
  );
}
