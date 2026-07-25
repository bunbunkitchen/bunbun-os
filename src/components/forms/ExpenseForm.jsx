import {
  useEffect,
  useState,
} from "react";

import Input from "../ui/Input";
import Button from "../ui/Button";

const categories = [
  "Gaji",
  "Bahan Baku",
  "Maintenance",
];

export default function ExpenseForm({
  onSave,
  onCancel,
  initialData = null,
  saving = false,
}) {
  const isEditing =
    Boolean(initialData);

  const [form, setForm] = useState({
    tanggal:
      initialData?.tanggal || "",
    kategori:
      initialData?.kategori ||
      "Bahan Baku",
    nominal:
      initialData?.nominal?.toString() ||
      "",
    keterangan:
      initialData?.keterangan || "",
  });

  const [errors, setErrors] =
    useState({});

  const [formError, setFormError] =
    useState("");

  useEffect(() => {
    if (!initialData) {
      return;
    }

    setForm({
      tanggal:
        initialData.tanggal || "",
      kategori:
        initialData.kategori ||
        "Bahan Baku",
      nominal:
        initialData.nominal?.toString() ||
        "",
      keterangan:
        initialData.keterangan || "",
    });
  }, [initialData]);

  function handleChange(field, value) {
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
    const newErrors = {};

    if (!form.tanggal) {
      newErrors.tanggal =
        "Tanggal wajib diisi";
    }

    if (!form.kategori) {
      newErrors.kategori =
        "Kategori wajib dipilih";
    }

    if (!form.nominal) {
      newErrors.nominal =
        "Nominal wajib diisi";
    } else if (
      Number(form.nominal) <= 0
    ) {
      newErrors.nominal =
        "Nominal harus lebih dari 0";
    }

    setErrors(newErrors);

    return (
      Object.keys(newErrors).length === 0
    );
  }

  async function handleSubmit() {
    if (!validate()) {
      return;
    }

    try {
      setFormError("");

      await onSave({
        tanggal: form.tanggal,
        kategori: form.kategori,
        nominal: Number(form.nominal),
        keterangan:
          form.keterangan.trim(),
      });
    } catch (error) {
      console.error(
        "Gagal menyimpan pengeluaran:",
        error
      );

      setFormError(
        error.message ||
          "Pengeluaran gagal disimpan."
      );
    }
  }

  function renderError(field) {
    if (!errors[field]) {
      return null;
    }

    return (
      <p className="mt-1 text-sm text-red-500">
        {errors[field]}
      </p>
    );
  }

  return (
    <>
      <h2 className="mb-6 text-2xl font-bold">
        {isEditing
          ? "Edit Pengeluaran"
          : "Tambah Pengeluaran"}
      </h2>

      {formError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {formError}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <Input
            type="date"
            value={form.tanggal}
            onChange={(event) =>
              handleChange(
                "tanggal",
                event.target.value
              )
            }
            disabled={saving}
          />

          {renderError("tanggal")}
        </div>

        <div>
          <select
            value={form.kategori}
            onChange={(event) =>
              handleChange(
                "kategori",
                event.target.value
              )
            }
            disabled={saving}
            className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none transition focus:border-amber-700 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500"
          >
            {categories.map(
              (category) => (
                <option
                  key={category}
                  value={category}
                >
                  {category}
                </option>
              )
            )}
          </select>

          {renderError("kategori")}
        </div>

        <div>
          <Input
            type="number"
            min="0"
            step="1"
            placeholder="Nominal"
            value={form.nominal}
            onChange={(event) =>
              handleChange(
                "nominal",
                event.target.value
              )
            }
            disabled={saving}
          />

          {renderError("nominal")}
        </div>

        <div>
          <Input
            placeholder="Keterangan"
            value={form.keterangan}
            onChange={(event) =>
              handleChange(
                "keterangan",
                event.target.value
              )
            }
            disabled={saving}
          />
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-3">
        <Button
          onClick={onCancel}
          disabled={saving}
        >
          Batal
        </Button>

        <Button
          onClick={handleSubmit}
          disabled={saving}
        >
          {saving
            ? "Menyimpan..."
            : isEditing
            ? "Simpan Perubahan"
            : "Simpan"}
        </Button>
      </div>
    </>
  );
}