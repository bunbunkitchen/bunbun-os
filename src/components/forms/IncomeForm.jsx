import { useEffect, useState } from "react";

import Input from "../ui/Input";
import Button from "../ui/Button";
import { getAvailableIncomeLots } from "../../services/incomeService";

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
    asalSetoran:
      initialData?.asalSetoran || "",
    kodeLot:
      initialData?.kodeLot || "",
    keterangan:
      initialData?.keterangan || "",
  });

  const [formError, setFormError] =
    useState("");

  const [lotOptions, setLotOptions] =
    useState([]);

  const [loadingLots, setLoadingLots] =
    useState(true);

  const [errors, setErrors] =
    useState({});

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
      asalSetoran:
        initialData.asalSetoran || "",
      kodeLot:
        initialData.kodeLot || "",
      keterangan:
        initialData.keterangan || "",
    });
  }, [initialData]);

  useEffect(() => {
    let active = true;

    async function loadLots() {
      try {
        const lots = await getAvailableIncomeLots();

        if (active) {
          setLotOptions(lots);
        }
      } catch (error) {
        console.error("Gagal mengambil pilihan lot:", error);

        if (active) {
          setFormError(
            "Pilihan kode lot gagal dimuat. Tutup form lalu coba lagi."
          );
        }
      } finally {
        if (active) {
          setLoadingLots(false);
        }
      }
    }

    loadLots();

    return () => {
      active = false;
    };
  }, []);

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
        "Nominal setoran wajib diisi";
    } else if (
      Number(form.totalPenjualan) <= 0
    ) {
      newErrors.totalPenjualan =
        "Nominal setoran harus lebih dari 0";
    }

    if (!form.asalSetoran.trim()) {
      newErrors.asalSetoran =
        "Asal setoran wajib diisi";
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
        totalPenjualan: Number(
          form.totalPenjualan
        ),
        persentaseBunbun: 100,
        pemasukanBunbun: Number(
          form.totalPenjualan
        ),
        asalSetoran: form.asalSetoran.trim(),
        kodeLot: form.kodeLot.trim(),
        keterangan:
          form.keterangan.trim() ||
          "-",
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
            placeholder="Nominal Setoran Diterima"
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
            placeholder="Asal Setoran (contoh: Sewangi Cafe / Event RS)"
            value={form.asalSetoran}
            onChange={(event) =>
              handleChange(
                "asalSetoran",
                event.target.value
              )
            }
            disabled={saving}
          />

          {renderError("asalSetoran")}
        </div>

        <div>
          <select
            value={form.kodeLot}
            onChange={(event) =>
              handleChange(
                "kodeLot",
                event.target.value
              )
            }
            disabled={saving || loadingLots}
            className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none transition focus:border-amber-700 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500"
          >
            <option value="">
              {loadingLots
                ? "Memuat kode lot..."
                : "Pilih kode lot (opsional)"}
            </option>

            {lotOptions.map((lot) => (
              <option
                key={lot.kodeLot}
                value={lot.kodeLot}
              >
                {lot.kodeLot}
                {lot.productNama
                  ? ` — ${lot.productNama}`
                  : ""}
              </option>
            ))}
          </select>
        </div>

        <div>
          <Input
            placeholder="Catatan (opsional)"
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
