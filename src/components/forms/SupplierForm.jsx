import {
  useEffect,
  useState,
} from "react";

import Input from "../ui/Input";
import Button from "../ui/Button";

export default function SupplierForm({
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
    kontak:
      initialData?.kontak || "",
    telepon:
      initialData?.telepon || "",
    email:
      initialData?.email || "",
    alamat:
      initialData?.alamat || "",
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
      kontak:
        initialData.kontak || "",
      telepon:
        initialData.telepon || "",
      email:
        initialData.email || "",
      alamat:
        initialData.alamat || "",
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
        "Kode supplier wajib diisi";
    }

    if (!form.nama.trim()) {
      newErrors.nama =
        "Nama supplier wajib diisi";
    }

    if (!form.kontak.trim()) {
      newErrors.kontak =
        "Nama kontak wajib diisi";
    }

    if (!form.telepon.trim()) {
      newErrors.telepon =
        "Nomor telepon wajib diisi";
    }

    if (
      form.email.trim() &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
        form.email.trim()
      )
    ) {
      newErrors.email =
        "Format email tidak valid";
    }

    if (!form.alamat.trim()) {
      newErrors.alamat =
        "Alamat wajib diisi";
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
        kontak: form.kontak.trim(),
        telepon: form.telepon.trim(),
        email: form.email.trim(),
        alamat: form.alamat.trim(),
        status: form.status,
      });
    } catch (error) {
      console.error(
        "Gagal menyimpan supplier:",
        error
      );

      setFormError(
        error.message ||
          "Supplier gagal disimpan."
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
          ? "Edit Supplier"
          : "Tambah Supplier"}
      </h2>

      {formError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {formError}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <Input
            placeholder="Kode Supplier"
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
            placeholder="Nama Supplier"
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
            placeholder="Nama Kontak"
            value={form.kontak}
            onChange={(event) =>
              handleChange(
                "kontak",
                event.target.value
              )
            }
            disabled={saving}
          />

          {renderError("kontak")}
        </div>

        <div>
          <Input
            placeholder="Nomor Telepon"
            value={form.telepon}
            onChange={(event) =>
              handleChange(
                "telepon",
                event.target.value
              )
            }
            disabled={saving}
          />

          {renderError("telepon")}
        </div>

        <div>
          <Input
            type="email"
            placeholder="Email"
            value={form.email}
            onChange={(event) =>
              handleChange(
                "email",
                event.target.value
              )
            }
            disabled={saving}
          />

          {renderError("email")}
        </div>

        <div>
          <Input
            placeholder="Alamat"
            value={form.alamat}
            onChange={(event) =>
              handleChange(
                "alamat",
                event.target.value
              )
            }
            disabled={saving}
          />

          {renderError("alamat")}
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