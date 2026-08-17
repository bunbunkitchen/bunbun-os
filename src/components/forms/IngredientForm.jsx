import {
  useEffect,
  useState,
} from "react";

import Input from "../ui/Input";
import Button from "../ui/Button";

export default function IngredientForm({
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
    kategori:
      initialData?.kategori || "",
    satuan:
      initialData?.satuan || "",
    harga:
      initialData?.harga?.toString() ||
      "",
    minimumStok:
      initialData?.minimumStok?.toString() ||
      "",
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
      kategori:
        initialData.kategori || "",
      satuan:
        initialData.satuan || "",
      harga:
        initialData.harga?.toString() ||
        "",
      minimumStok:
        initialData.minimumStok?.toString() ||
        "",
      status:
        initialData.status ||
        "Aktif",
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
        "Kode bahan wajib diisi";
    }

    if (!form.nama.trim()) {
      newErrors.nama =
        "Nama bahan wajib diisi";
    }

    if (!form.kategori.trim()) {
      newErrors.kategori =
        "Kategori wajib diisi";
    }

    if (!form.satuan.trim()) {
      newErrors.satuan =
        "Satuan wajib diisi";
    }

    if (form.harga === "") {
      newErrors.harga =
        "Harga beli wajib diisi";
    } else if (
      Number(form.harga) <= 0
    ) {
      newErrors.harga =
        "Harga beli harus lebih dari 0";
    }

    if (
      form.minimumStok === ""
    ) {
      newErrors.minimumStok =
        "Minimum stok wajib diisi";
    } else if (
      Number(form.minimumStok) < 0
    ) {
      newErrors.minimumStok =
        "Minimum stok tidak boleh negatif";
    }

    setErrors(newErrors);

    return (
      Object.keys(newErrors).length ===
      0
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
        kategori:
          form.kategori.trim(),
        satuan:
          form.satuan.trim(),
        harga: Number(form.harga),
        minimumStok: Number(
          form.minimumStok
        ),
        status: form.status,
      });
    } catch (error) {
      console.error(
        "Gagal menyimpan bahan baku:",
        error
      );

      setFormError(
        error.message ||
          "Bahan baku gagal disimpan."
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
          ? "Edit Bahan Baku"
          : "Tambah Bahan Baku"}
      </h2>

      {formError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {formError}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <Input
            placeholder="Kode Bahan"
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
            placeholder="Nama Bahan"
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

        <div>
          <Input
            placeholder="Kategori"
            value={form.kategori}
            onChange={(event) =>
              handleChange(
                "kategori",
                event.target.value
              )
            }
            disabled={saving}
          />

          {renderError("kategori")}
        </div>

        <div>
          <Input
            placeholder="Satuan"
            value={form.satuan}
            onChange={(event) =>
              handleChange(
                "satuan",
                event.target.value
              )
            }
            disabled={saving}
          />

          {renderError("satuan")}
        </div>

        <div>
          <Input
            type="number"
            min="0"
            step="0.01"
            placeholder="Harga Beli"
            value={form.harga}
            onChange={(event) =>
              handleChange(
                "harga",
                event.target.value
              )
            }
            disabled={saving}
          />

          {renderError("harga")}
        </div>

        <div>
          <Input
            type="number"
            min="0"
            step="0.001"
            placeholder="Minimum Stok"
            value={form.minimumStok}
            onChange={(event) =>
              handleChange(
                "minimumStok",
                event.target.value
              )
            }
            disabled={saving}
          />

          {renderError(
            "minimumStok"
          )}
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
          className="!bg-[#F3E2DF] !text-[#9A625B] !border !border-[#E7CFCA] hover:!bg-[#EAD3CF] hover:!text-[#87534D]"
        >
          Batal
        </Button>

        <Button
          onClick={handleSubmit}
          disabled={saving}
          className="!bg-[#E8EDE2] !text-[#5F6F4F] !border !border-[#D5DDCA] hover:!bg-[#DCE4D3] hover:!text-[#4F5F42]"
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