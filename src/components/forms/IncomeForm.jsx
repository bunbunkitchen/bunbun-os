import {
  useEffect,
  useMemo,
  useState,
} from "react";

import Input from "../ui/Input";
import Button from "../ui/Button";
import Currency from "../ui/Currency";

import {
  getSettings,
} from "../../services/settingsService";

export default function IncomeForm({
  onSave,
  onCancel,
  initialData = null,
  saving = false,
}) {
  const isEditing = Boolean(initialData);

  const [form, setForm] = useState({
    tanggal:
      initialData?.tanggal || "",
    totalPenjualan:
      initialData?.totalPenjualan?.toString() ||
      "",
    keterangan:
      initialData?.keterangan ||
      "Penjualan harian",
  });

  const [settings, setSettings] =
    useState(null);

  const [
    loadingSettings,
    setLoadingSettings,
  ] = useState(true);

  const [formError, setFormError] =
    useState("");

  const [errors, setErrors] =
    useState({});

  useEffect(() => {
    async function loadSettings() {
      try {
        setFormError("");

        const data = await getSettings();

        setSettings(data);
      } catch (error) {
        console.error(
          "Gagal memuat settings pemasukan:",
          error
        );

        setFormError(
          error.message ||
            "Persentase bagian Bunbun gagal dimuat."
        );
      } finally {
        setLoadingSettings(false);
      }
    }

    loadSettings();
  }, []);

  useEffect(() => {
    if (!initialData) {
      return;
    }

    setForm({
      tanggal:
        initialData.tanggal || "",
      totalPenjualan:
        initialData.totalPenjualan?.toString() ||
        "",
      keterangan:
        initialData.keterangan ||
        "Penjualan harian",
    });
  }, [initialData]);

  const persentaseBunbun =
    settings?.bunbunPercentage ??
    initialData?.persentaseBunbun ??
    70;

  const pemasukanBunbun = useMemo(() => {
    const total =
      Number(form.totalPenjualan) || 0;

    return (
      total *
      (Number(persentaseBunbun) / 100)
    );
  }, [
    form.totalPenjualan,
    persentaseBunbun,
  ]);

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

    if (!form.totalPenjualan) {
      newErrors.totalPenjualan =
        "Total penjualan wajib diisi";
    } else if (
      Number(form.totalPenjualan) <= 0
    ) {
      newErrors.totalPenjualan =
        "Total penjualan harus lebih dari 0";
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

    if (!settings) {
      setFormError(
        "Pengaturan persentase Bunbun belum tersedia."
      );
      return;
    }

    try {
      setFormError("");

      await onSave({
        tanggal: form.tanggal,
        totalPenjualan: Number(
          form.totalPenjualan
        ),
        persentaseBunbun: Number(
          persentaseBunbun
        ),
        pemasukanBunbun,
        keterangan:
          form.keterangan.trim() ||
          "Penjualan harian",
      });
    } catch (error) {
      console.error(
        "Gagal menyimpan pemasukan:",
        error
      );

      setFormError(
        error.message ||
          "Pemasukan gagal disimpan."
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
          ? "Edit Pemasukan"
          : "Tambah Pemasukan"}
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
          <Input
            type="number"
            min="0"
            placeholder="Total Penjualan Cafe"
            value={form.totalPenjualan}
            onChange={(event) =>
              handleChange(
                "totalPenjualan",
                event.target.value
              )
            }
            disabled={saving}
          />

          {renderError(
            "totalPenjualan"
          )}
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

      <div className="mt-6 rounded-xl bg-stone-100 p-4">
        <p className="text-sm text-gray-500">
          Bagian Bunbun Kitchen
        </p>

        <p className="mt-1 text-sm font-semibold text-gray-700">
          {loadingSettings
            ? "Memuat persentase..."
            : `${persentaseBunbun}% dari total penjualan`}
        </p>

        <p className="mt-3 text-2xl font-bold text-amber-700">
          <Currency
            value={pemasukanBunbun}
          />
        </p>
      </div>

      <div className="mt-6 flex justify-end gap-3">
        <Button
          onClick={onCancel}
          disabled={
            loadingSettings || saving
          }
        >
          Batal
        </Button>

        <Button
          onClick={handleSubmit}
          disabled={
            loadingSettings ||
            !settings ||
            saving
          }
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