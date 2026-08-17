import { useEffect, useState } from "react";

import Button from "../ui/Button";
import Input from "../ui/Input";

export default function MaintenanceItemForm({
  initialData = null,
  onSave,
  onCancel,
  saving = false,
}) {
  const [form, setForm] = useState({
    kode: "",
    nama: "",
    satuan: "",
    harga: "",
    minimumStok: "0",
  });

  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (!initialData) {
      return;
    }

    setForm({
      kode: initialData.kode || "",
      nama: initialData.nama || "",
      satuan: initialData.satuan || "",
      harga:
        initialData.harga !== undefined
          ? String(initialData.harga)
          : "",
      minimumStok:
        initialData.minimumStok !== undefined
          ? String(initialData.minimumStok)
          : "0",
    });
  }, [initialData]);

  function change(field, value) {
    setForm((previous) => ({
      ...previous,
      [field]: value,
    }));

    setErrors((previous) => ({
      ...previous,
      [field]: "",
    }));

    setFormError("");
  }

  function validate() {
    const next = {};

    if (!form.kode.trim()) {
      next.kode = "Kode wajib diisi";
    }

    if (!form.nama.trim()) {
      next.nama = "Nama barang wajib diisi";
    }

    if (!form.satuan.trim()) {
      next.satuan = "Satuan wajib diisi";
    }

    if (!(Number(form.harga) >= 0)) {
      next.harga = "Harga tidak valid";
    }

    if (!(Number(form.minimumStok) >= 0)) {
      next.minimumStok =
        "Minimum stok tidak valid";
    }

    setErrors(next);

    return Object.keys(next).length === 0;
  }

  async function submit(event) {
    event.preventDefault();

    if (saving || !validate()) {
      return;
    }

    try {
      setFormError("");

      await onSave({
        kode: form.kode.trim(),
        nama: form.nama.trim(),
        satuan: form.satuan.trim(),
        harga: Number(form.harga),
        minimumStok: Number(
          form.minimumStok
        ),
        isActive:
          initialData?.isActive !== false,
      });
    } catch (error) {
      setFormError(
        error.message ||
          "Data maintenance gagal disimpan."
      );
    }
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-5"
    >
      <div>
        <h2 className="text-xl font-semibold text-gray-800">
          {initialData
            ? "Edit Barang Maintenance"
            : "Tambah Barang Maintenance"}
        </h2>

        <p className="mt-1 text-sm text-gray-500">
          Barang operasional dapur yang
          tidak termasuk bahan baku resep.
        </p>
      </div>

      {formError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {formError}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1 text-sm font-medium text-gray-700">
          <span>Kode</span>

          <Input
            value={form.kode}
            onChange={(event) =>
              change(
                "kode",
                event.target.value
              )
            }
            disabled={saving}
            placeholder="Contoh: MNT-001"
          />

          {errors.kode && (
            <span className="text-xs text-red-600">
              {errors.kode}
            </span>
          )}
        </label>

        <label className="space-y-1 text-sm font-medium text-gray-700">
          <span>Nama Barang</span>

          <Input
            value={form.nama}
            onChange={(event) =>
              change(
                "nama",
                event.target.value
              )
            }
            disabled={saving}
            placeholder="Contoh: Sabun Cuci Piring"
          />

          {errors.nama && (
            <span className="text-xs text-red-600">
              {errors.nama}
            </span>
          )}
        </label>

        <label className="space-y-1 text-sm font-medium text-gray-700">
          <span>Satuan</span>

          <Input
            value={form.satuan}
            onChange={(event) =>
              change(
                "satuan",
                event.target.value
              )
            }
            disabled={saving}
            placeholder="pcs, botol, liter, pack"
          />

          {errors.satuan && (
            <span className="text-xs text-red-600">
              {errors.satuan}
            </span>
          )}
        </label>

        <label className="space-y-1 text-sm font-medium text-gray-700">
          <span>Harga Acuan</span>

          <Input
            type="number"
            min="0"
            step="1"
            value={form.harga}
            onChange={(event) =>
              change(
                "harga",
                event.target.value
              )
            }
            disabled={saving}
            placeholder="Contoh: 25000"
          />

          {errors.harga && (
            <span className="text-xs text-red-600">
              {errors.harga}
            </span>
          )}
        </label>

        <label className="space-y-1 text-sm font-medium text-gray-700">
          <span>Minimum Stok</span>

          <Input
            type="number"
            min="0"
            step="0.001"
            value={form.minimumStok}
            onChange={(event) =>
              change(
                "minimumStok",
                event.target.value
              )
            }
            disabled={saving}
            placeholder="Contoh: 2"
          />

          {errors.minimumStok && (
            <span className="text-xs text-red-600">
              {errors.minimumStok}
            </span>
          )}
        </label>
      </div>

      <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
        Barang di sini khusus kebutuhan
        operasional/maintenance dapur dan
        <strong> tidak masuk ke resep atau HPP
        bahan baku.</strong>
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

        <Button
          type="submit"
          disabled={saving}
        >
          {saving
            ? "Menyimpan..."
            : initialData
              ? "Simpan Perubahan"
              : "Simpan Barang"}
        </Button>
      </div>
    </form>
  );
}