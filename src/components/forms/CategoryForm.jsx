import {
  useEffect,
  useState,
} from "react";

import Input from "../ui/Input";
import Button from "../ui/Button";

export default function CategoryForm({
  onSave,
  onCancel,
  initialData = null,
  saving = false,
}) {
  const isEditing =
    Boolean(initialData);

  const [form, setForm] = useState({
    kode:
      initialData?.kode || "",
    nama:
      initialData?.nama || "",
    status:
      initialData?.status || "Aktif",
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
      kode:
        initialData.kode || "",
      nama:
        initialData.nama || "",
      status:
        initialData.status || "Aktif",
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

    if (!form.kode.trim()) {
      newErrors.kode =
        "Kode kategori wajib diisi";
    }

    if (!form.nama.trim()) {
      newErrors.nama =
        "Nama kategori wajib diisi";
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
        kode: form.kode.trim(),
        nama: form.nama.trim(),
        status: form.status,
      });
    } catch (error) {
      console.error(
        "Gagal menyimpan kategori:",
        error
      );

      setFormError(
        error.message ||
          "Kategori gagal disimpan."
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
          ? "Edit Kategori"
          : "Tambah Kategori"}
      </h2>

      {formError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {formError}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <Input
            placeholder="Kode Kategori"
            value={form.kode}
            onChange={(event) =>
              handleChange(
                "kode",
                event.target.value
              )
            }
            disabled={saving}
          />

          {renderError("kode")}
        </div>

        <div>
          <Input
            placeholder="Nama Kategori"
            value={form.nama}
            onChange={(event) =>
              handleChange(
                "nama",
                event.target.value
              )
            }
            disabled={saving}
          />

          {renderError("nama")}
        </div>

        {isEditing && (
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Status
            </label>

            <select
              value={form.status}
              onChange={(event) =>
                handleChange(
                  "status",
                  event.target.value
                )
              }
              disabled={saving}
              className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none transition focus:border-amber-600 disabled:cursor-not-allowed disabled:bg-gray-100"
            >
              <option value="Aktif">
                Aktif
              </option>

              <option value="Nonaktif">
                Nonaktif
              </option>
            </select>
          </div>
        )}
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