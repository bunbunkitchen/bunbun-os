import { useEffect, useRef, useState } from "react";

import Button from "../ui/Button";
import Input from "../ui/Input";
import { getAllProducts } from "../../services/productService";
import { createProductStockOperationKey } from "../../services/productStockService";

const REASONS = [
  "Selisih stok fisik",
  "Produk rusak",
  "Produk hilang",
  "Salah input",
  "Koreksi lainnya",
];

export default function ProductStockAdjustmentForm({
  onSave,
  onCancel,
  saving = false,
}) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formError, setFormError] = useState("");
  const [errors, setErrors] = useState({});
  const operationKeyRef = useRef(createProductStockOperationKey());

  const [form, setForm] = useState({
    tanggal: new Date().toISOString().slice(0, 10),
    productId: "",
    jenis: "OUT",
    jumlah: "",
    alasan: "Selisih stok fisik",
    keterangan: "",
  });

  useEffect(() => {
    let active = true;

    async function loadProducts() {
      try {
        const data = await getAllProducts();
        if (active) {
          setProducts(
            data.filter((item) => item.status === "Aktif")
          );
        }
      } catch (error) {
        if (active) {
          setFormError(
            error.message || "Produk gagal dimuat."
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadProducts();
    return () => {
      active = false;
    };
  }, []);

  function change(field, value) {
    setForm((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => ({ ...previous, [field]: "" }));
    setFormError("");
  }

  function validate() {
    const next = {};

    if (!form.tanggal) next.tanggal = "Tanggal wajib diisi";
    if (!form.productId) next.productId = "Produk wajib dipilih";
    if (!form.jenis) next.jenis = "Jenis adjustment wajib dipilih";
    if (!(Number(form.jumlah) > 0)) next.jumlah = "Jumlah harus lebih dari 0";
    if (!form.alasan.trim()) next.alasan = "Alasan adjustment wajib dipilih";

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
        productId: Number(form.productId),
        jenis: form.jenis,
        jumlah: Number(form.jumlah),
        alasan: form.alasan.trim(),
        keterangan: form.keterangan.trim(),
        operationKey: operationKeyRef.current,
      });
    } catch (error) {
      setFormError(
        error.message || "Penyesuaian stok produk gagal disimpan."
      );
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-gray-800">
          Penyesuaian Stok Produk
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Sesuaikan stok produk jadi dengan kondisi stok fisik.
        </p>
      </div>

      {formError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {formError}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1 text-sm font-medium text-gray-700">
          <span>Tanggal</span>
          <Input
            type="date"
            value={form.tanggal}
            onChange={(event) => change("tanggal", event.target.value)}
            disabled={saving}
          />
          {errors.tanggal && (
            <span className="text-xs text-red-600">{errors.tanggal}</span>
          )}
        </label>

        <label className="space-y-1 text-sm font-medium text-gray-700">
          <span>Produk</span>
          <select
            className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:border-amber-600"
            value={form.productId}
            onChange={(event) => change("productId", event.target.value)}
            disabled={saving || loading}
          >
            <option value="">
              {loading ? "Memuat..." : "Pilih produk"}
            </option>
            {products.map((item) => (
              <option key={item.id} value={item.id}>
                {item.sku} — {item.nama}
              </option>
            ))}
          </select>
          {errors.productId && (
            <span className="text-xs text-red-600">{errors.productId}</span>
          )}
        </label>

        <label className="space-y-1 text-sm font-medium text-gray-700">
          <span>Jenis Adjustment</span>
          <select
            className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:border-amber-600"
            value={form.jenis}
            onChange={(event) => change("jenis", event.target.value)}
            disabled={saving}
          >
            <option value="OUT">Kurangi Stok</option>
            <option value="IN">Tambah Stok</option>
          </select>
          {errors.jenis && (
            <span className="text-xs text-red-600">{errors.jenis}</span>
          )}
        </label>

        <label className="space-y-1 text-sm font-medium text-gray-700">
          <span>Jumlah (pcs)</span>
          <Input
            type="number"
            min="1"
            step="1"
            value={form.jumlah}
            onChange={(event) => change("jumlah", event.target.value)}
            disabled={saving}
            placeholder="Contoh: 2"
          />
          {errors.jumlah && (
            <span className="text-xs text-red-600">{errors.jumlah}</span>
          )}
        </label>

        <label className="space-y-1 text-sm font-medium text-gray-700 sm:col-span-2">
          <span>Alasan</span>
          <select
            className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:border-amber-600"
            value={form.alasan}
            onChange={(event) => change("alasan", event.target.value)}
            disabled={saving}
          >
            {REASONS.map((reason) => (
              <option key={reason} value={reason}>
                {reason}
              </option>
            ))}
          </select>
          {errors.alasan && (
            <span className="text-xs text-red-600">{errors.alasan}</span>
          )}
        </label>
      </div>

      <label className="block space-y-1 text-sm font-medium text-gray-700">
        <span>Catatan (opsional)</span>
        <textarea
          className="min-h-24 w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:border-amber-600"
          value={form.keterangan}
          onChange={(event) => change("keterangan", event.target.value)}
          disabled={saving}
          placeholder="Contoh: hasil stock opname produk jadi"
        />
      </label>

      <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
        <strong>Perhatian:</strong> Penyesuaian hanya mengubah saldo stok
        produk jadi. Tidak mencatat pemasukan/pengeluaran kas dan tidak
        mengubah HPP resep.
      </div>

      <div className="flex justify-end gap-3">
        <Button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="bg-gray-200 text-gray-700 hover:bg-gray-300"
        >
          Batal
        </Button>
        <Button type="submit" disabled={saving || loading}>
          {saving ? "Menyimpan..." : "Simpan Penyesuaian"}
        </Button>
      </div>
    </form>
  );
}
