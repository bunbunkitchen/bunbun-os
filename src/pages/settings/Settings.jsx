import {
  useEffect,
  useState,
} from "react";

import PageTitle from "../../components/ui/PageTitle";
import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import Input from "../../components/ui/Input";
import LoadingState from "../../components/ui/LoadingState";

import {
  getSettings,
  updateSettings,
} from "../../services/settingsService";

export default function Settings() {
  const [form, setForm] = useState({
    businessName: "",
    businessAddress: "",
    businessPhone: "",
    businessEmail: "",
    bunbunPercentage: 70,
    currencyCode: "IDR",
  });

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [pageError, setPageError] =
    useState("");

  const [successMessage, setSuccessMessage] =
    useState("");

  useEffect(() => {
    async function loadSettings() {
      try {
        setPageError("");

        const data = await getSettings();

        setForm({
          businessName:
            data.businessName,
          businessAddress:
            data.businessAddress,
          businessPhone:
            data.businessPhone,
          businessEmail:
            data.businessEmail,
          bunbunPercentage:
            data.bunbunPercentage,
          currencyCode:
            data.currencyCode,
        });
      } catch (error) {
        console.error(
          "Gagal memuat settings:",
          error
        );

        setPageError(
          error.message ||
            "Pengaturan gagal dimuat."
        );
      } finally {
        setLoading(false);
      }
    }

    loadSettings();
  }, []);

  function handleChange(field, value) {
    setForm((previous) => ({
      ...previous,
      [field]: value,
    }));

    setPageError("");
    setSuccessMessage("");
  }

  function validate() {
    if (!form.businessName.trim()) {
      setPageError(
        "Nama usaha wajib diisi."
      );
      return false;
    }

    const percentage = Number(
      form.bunbunPercentage
    );

    if (
      Number.isNaN(percentage) ||
      percentage < 0 ||
      percentage > 100
    ) {
      setPageError(
        "Persentase Bunbun harus antara 0 sampai 100."
      );
      return false;
    }

    if (!form.currencyCode.trim()) {
      setPageError(
        "Kode mata uang wajib diisi."
      );
      return false;
    }

    return true;
  }

  async function handleSave() {
    if (!validate()) {
      return;
    }

    try {
      setSaving(true);
      setPageError("");
      setSuccessMessage("");

      const updated =
        await updateSettings({
          businessName:
            form.businessName.trim(),
          businessAddress:
            form.businessAddress.trim(),
          businessPhone:
            form.businessPhone.trim(),
          businessEmail:
            form.businessEmail.trim(),
          bunbunPercentage: Number(
            form.bunbunPercentage
          ),
          currencyCode:
            form.currencyCode.trim(),
        });

      setForm({
        businessName:
          updated.businessName,
        businessAddress:
          updated.businessAddress,
        businessPhone:
          updated.businessPhone,
        businessEmail:
          updated.businessEmail,
        bunbunPercentage:
          updated.bunbunPercentage,
        currencyCode:
          updated.currencyCode,
      });

      setSuccessMessage(
        "Pengaturan berhasil disimpan."
      );
    } catch (error) {
      console.error(
        "Gagal menyimpan settings:",
        error
      );

      setPageError(
        error.message ||
          "Pengaturan gagal disimpan."
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
  return (
    <LoadingState message="Memuat dashboard..." />
  );
}

  return (
    <div>
      <PageTitle
        title="Settings"
        subtitle="Pengaturan profil Bunbun Kitchen"
      />

      {pageError && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
          {pageError}
        </div>
      )}

      {successMessage && (
        <div className="mb-6 rounded-xl border border-green-200 bg-green-50 p-4 text-green-700">
          {successMessage}
        </div>
      )}

      <Card>
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-gray-800">
            Profil Usaha
          </h2>

          <p className="mt-1 text-sm text-gray-500">
            Data utama yang digunakan Bunbun OS
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Nama Usaha
            </label>

            <Input
              value={form.businessName}
              onChange={(event) =>
                handleChange(
                  "businessName",
                  event.target.value
                )
              }
              placeholder="Bunbun Kitchen"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Telepon
            </label>

            <Input
              value={form.businessPhone}
              onChange={(event) =>
                handleChange(
                  "businessPhone",
                  event.target.value
                )
              }
              placeholder="Nomor telepon usaha"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Email
            </label>

            <Input
              type="email"
              value={form.businessEmail}
              onChange={(event) =>
                handleChange(
                  "businessEmail",
                  event.target.value
                )
              }
              placeholder="Email usaha"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Mata Uang
            </label>

            <select
              value={form.currencyCode}
              onChange={(event) =>
                handleChange(
                  "currencyCode",
                  event.target.value
                )
              }
              className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:border-amber-600"
            >
              <option value="IDR">
                IDR — Rupiah
              </option>
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Persentase Bagian Bunbun
            </label>

            <Input
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={form.bunbunPercentage}
              onChange={(event) =>
                handleChange(
                  "bunbunPercentage",
                  event.target.value
                )
              }
              placeholder="70"
            />

            <p className="mt-2 text-xs text-gray-500">
              Digunakan untuk menghitung bagian Bunbun dari total penjualan.
            </p>
          </div>

          <div className="md:col-span-2">
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Alamat
            </label>

            <textarea
              value={form.businessAddress}
              onChange={(event) =>
                handleChange(
                  "businessAddress",
                  event.target.value
                )
              }
              rows={4}
              placeholder="Alamat Bunbun Kitchen"
              className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:border-amber-600"
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <Button
            onClick={handleSave}
            disabled={saving}
          >
            {saving
              ? "Menyimpan..."
              : "Simpan Pengaturan"}
          </Button>
        </div>
      </Card>
    </div>
  );
}