import {
  useEffect,
  useMemo,
  useState,
} from "react";

import FormField from "../ui/FormField";
import Button from "../ui/Button";

import {
  getAllIngredients,
} from "../../services/ingredientService";

import {
  getAllMaintenanceItems,
} from "../../services/maintenanceService";

import {
  getAllSuppliers,
} from "../../services/supplierService";

const INITIAL_FORM = {
  tanggal: new Date()
    .toISOString()
    .slice(0, 10),

  purchaseType: "INGREDIENT",

  ingredientId: "",
  maintenanceItemId: "",
  supplierId: "",

  // Bahan baku
  jumlahSediaan: "",
  isiPerSediaan: "",
  satuanSediaan: "",

  // Maintenance / kompatibilitas data lama
  jumlah: "",
  satuan: "",

  hargaSatuan: "",
  keterangan: "",
};

function normalizeUnit(unit) {
  return String(unit || "")
    .trim()
    .toLowerCase();
}

function toBaseQuantity(
  quantity,
  unit
) {
  const value = Number(quantity || 0);
  const normalized = normalizeUnit(unit);

  if (
    normalized === "kg"
  ) {
    return value * 1000;
  }

  if (
    normalized === "liter" ||
    normalized === "l"
  ) {
    return value * 1000;
  }

  return value;
}

function fromBaseQuantity(
  quantity,
  unit
) {
  const value = Number(quantity || 0);
  const normalized = normalizeUnit(unit);

  if (
    normalized === "kg"
  ) {
    return value / 1000;
  }

  if (
    normalized === "liter" ||
    normalized === "l"
  ) {
    return value / 1000;
  }

  return value;
}

export default function PurchaseForm({
  initialData = null,
  onSave,
  onUpdate,
  onCancel,
  saving = false,
}) {
  const [form, setForm] =
    useState(INITIAL_FORM);

  const [ingredients, setIngredients] =
    useState([]);

  const [
    maintenanceItems,
    setMaintenanceItems,
  ] = useState([]);

  const [suppliers, setSuppliers] =
    useState([]);

  const [
    loadingMaster,
    setLoadingMaster,
  ] = useState(true);

  const [error, setError] =
    useState("");

  const isEdit =
    Boolean(initialData);

  useEffect(() => {
    async function loadMasterData() {
      try {
        setLoadingMaster(true);
        setError("");

        const [
          ingredientData,
          maintenanceData,
          supplierData,
        ] = await Promise.all([
          getAllIngredients(),
          getAllMaintenanceItems(),
          getAllSuppliers(),
        ]);

        setIngredients(
          ingredientData ?? []
        );

        setMaintenanceItems(
          maintenanceData ?? []
        );

        setSuppliers(
          supplierData ?? []
        );
      } catch (err) {
        console.error(
          "Gagal memuat master purchasing:",
          err
        );

        setError(
          err.message ||
            "Master data gagal dimuat."
        );
      } finally {
        setLoadingMaster(false);
      }
    }

    void loadMasterData();
  }, []);

  useEffect(() => {
    if (!initialData) {
      setForm(INITIAL_FORM);
      return;
    }

    const isMaintenance =
      initialData.purchaseType ===
      "MAINTENANCE";

    /*
     * Data purchasing lama belum
     * memiliki informasi sediaan.
     *
     * Supaya tetap bisa diedit,
     * kita perlakukan sebagai:
     *
     * jumlah sediaan = jumlah lama
     * isi sediaan = 1
     * satuan sediaan = satuan lama
     */
    const legacyJumlah =
      initialData.jumlah ?? "";

    const legacySatuan =
      initialData.satuan || "";

    setForm({
      tanggal:
        initialData.tanggal ||
        new Date()
          .toISOString()
          .slice(0, 10),

      purchaseType:
        initialData.purchaseType ||
        "INGREDIENT",

      ingredientId:
        initialData.ingredientId
          ? String(
              initialData.ingredientId
            )
          : "",

      maintenanceItemId:
        initialData.maintenanceItemId
          ? String(
              initialData.maintenanceItemId
            )
          : "",

      supplierId:
        initialData.supplierId
          ? String(
              initialData.supplierId
            )
          : "",

      jumlahSediaan:
        !isMaintenance &&
        initialData.jumlahSediaan != null
          ? initialData.jumlahSediaan
          : !isMaintenance
          ? legacyJumlah
          : "",

      isiPerSediaan:
        !isMaintenance &&
        initialData.isiPerSediaan != null
          ? initialData.isiPerSediaan
          : !isMaintenance
          ? 1
          : "",

      satuanSediaan:
        !isMaintenance &&
        initialData.satuanSediaan
          ? initialData.satuanSediaan
          : !isMaintenance
          ? legacySatuan
          : "",

      jumlah:
        isMaintenance
          ? legacyJumlah
          : "",

      satuan:
        initialData.satuan || "",

      hargaSatuan:
        initialData.hargaSatuan ?? "",

      keterangan:
        initialData.keterangan || "",
    });
  }, [initialData]);

  const selectedIngredient =
    useMemo(
      () =>
        ingredients.find(
          (item) =>
            String(item.id) ===
            String(
              form.ingredientId
            )
        ),
      [
        ingredients,
        form.ingredientId,
      ]
    );

  const selectedMaintenance =
    useMemo(
      () =>
        maintenanceItems.find(
          (item) =>
            String(item.id) ===
            String(
              form.maintenanceItemId
            )
        ),
      [
        maintenanceItems,
        form.maintenanceItemId,
      ]
    );

  /*
   * Total pembelian:
   *
   * Bahan baku:
   * jumlah sediaan × harga/sediaan
   *
   * Maintenance:
   * jumlah × harga satuan
   */
  const total = useMemo(() => {
    if (
      form.purchaseType ===
      "INGREDIENT"
    ) {
      return (
        Number(
          form.jumlahSediaan || 0
        ) *
        Number(
          form.hargaSatuan || 0
        )
      );
    }

    return (
      Number(form.jumlah || 0) *
      Number(
        form.hargaSatuan || 0
      )
    );
  }, [
    form.purchaseType,
    form.jumlahSediaan,
    form.jumlah,
    form.hargaSatuan,
  ]);

  /*
   * Hitung stok yang benar-benar
   * masuk inventory.
   */
  const stockIncoming =
    useMemo(() => {
      if (
        form.purchaseType !==
          "INGREDIENT" ||
        !form.jumlahSediaan ||
        !form.isiPerSediaan ||
        !form.satuanSediaan ||
        !form.satuan
      ) {
        return 0;
      }

      const totalBase =
        toBaseQuantity(
          Number(
            form.jumlahSediaan
          ) *
            Number(
              form.isiPerSediaan
            ),
          form.satuanSediaan
        );

      return fromBaseQuantity(
        totalBase,
        form.satuan
      );
    }, [
      form.purchaseType,
      form.jumlahSediaan,
      form.isiPerSediaan,
      form.satuanSediaan,
      form.satuan,
    ]);

  function updateField(
    name,
    value
  ) {
    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));
  }

  function handlePurchaseTypeChange(
    value
  ) {
    setForm((previous) => ({
      ...previous,

      purchaseType: value,

      ingredientId:
        value === "INGREDIENT"
          ? previous.ingredientId
          : "",

      maintenanceItemId:
        value === "MAINTENANCE"
          ? previous.maintenanceItemId
          : "",

      satuan:
        value === "INGREDIENT"
          ? selectedIngredient?.satuan ||
            ""
          : selectedMaintenance?.satuan ||
            "",

      hargaSatuan:
        value === "INGREDIENT"
          ? ""
          : selectedMaintenance?.harga ||
            "",

      jumlahSediaan:
        value === "INGREDIENT"
          ? previous.jumlahSediaan
          : "",

      isiPerSediaan:
        value === "INGREDIENT"
          ? previous.isiPerSediaan
          : "",

      satuanSediaan:
        value === "INGREDIENT"
          ? previous.satuanSediaan
          : "",

      jumlah:
        value === "MAINTENANCE"
          ? previous.jumlah
          : "",
    }));
  }

  function handleItemChange(
    value
  ) {
    if (
      form.purchaseType ===
      "INGREDIENT"
    ) {
      const ingredient =
        ingredients.find(
          (item) =>
            String(item.id) ===
            String(value)
        );

      setForm((previous) => ({
        ...previous,

        ingredientId: value,

        maintenanceItemId: "",

        satuan:
          ingredient?.satuan ||
          "",

        /*
         * Harga MASTER TIDAK
         * masuk ke Purchasing.
         *
         * Harga ini wajib diisi
         * sesuai harga aktual.
         */
        hargaSatuan: "",

        satuanSediaan:
          ingredient?.satuan ||
          "",
      }));

      return;
    }

    const maintenance =
      maintenanceItems.find(
        (item) =>
          String(item.id) ===
          String(value)
      );

    setForm((previous) => ({
      ...previous,

      ingredientId: "",

      maintenanceItemId: value,

      satuan:
        maintenance?.satuan ||
        "",

      hargaSatuan:
        maintenance?.harga || "",
    }));
  }

  async function handleSubmit(
    event
  ) {
    event.preventDefault();

    setError("");

    if (!form.tanggal) {
      setError(
        "Tanggal pembelian wajib diisi."
      );
      return;
    }

    if (
      form.purchaseType ===
      "INGREDIENT"
    ) {
      if (!form.ingredientId) {
        setError(
          "Bahan baku wajib dipilih."
        );
        return;
      }

      if (
        !form.jumlahSediaan ||
        Number(
          form.jumlahSediaan
        ) <= 0
      ) {
        setError(
          "Jumlah sediaan harus lebih dari 0."
        );
        return;
      }

      if (
        !form.isiPerSediaan ||
        Number(
          form.isiPerSediaan
        ) <= 0
      ) {
        setError(
          "Isi per sediaan harus lebih dari 0."
        );
        return;
      }

      if (
        !form.satuanSediaan.trim()
      ) {
        setError(
          "Satuan sediaan wajib diisi."
        );
        return;
      }
    }

    if (
      form.purchaseType ===
      "MAINTENANCE"
    ) {
      if (
        !form.maintenanceItemId
      ) {
        setError(
          "Barang maintenance wajib dipilih."
        );
        return;
      }

      if (
        !form.jumlah ||
        Number(form.jumlah) <= 0
      ) {
        setError(
          "Jumlah pembelian harus lebih dari 0."
        );
        return;
      }
    }

    if (
      !form.hargaSatuan ||
      Number(form.hargaSatuan) < 0
    ) {
      setError(
        "Harga pembelian tidak valid."
      );
      return;
    }

    const payload = {
      tanggal:
        form.tanggal,

      purchaseType:
        form.purchaseType,

      ingredientId:
        form.purchaseType ===
        "INGREDIENT"
          ? Number(
              form.ingredientId
            )
          : null,

      maintenanceItemId:
        form.purchaseType ===
        "MAINTENANCE"
          ? Number(
              form.maintenanceItemId
            )
          : null,

      supplierId:
        form.supplierId
          ? Number(
              form.supplierId
            )
          : null,

      /*
       * Bahan baku
       */
      jumlahSediaan:
        form.purchaseType ===
        "INGREDIENT"
          ? Number(
              form.jumlahSediaan
            )
          : null,

      isiPerSediaan:
        form.purchaseType ===
        "INGREDIENT"
          ? Number(
              form.isiPerSediaan
            )
          : null,

      satuanSediaan:
        form.purchaseType ===
        "INGREDIENT"
          ? form.satuanSediaan.trim()
          : null,

      /*
       * jumlah + satuan adalah
       * quantity inventory.
       *
       * Service akan menghitung
       * otomatis untuk ingredient.
       */
      jumlah:
        form.purchaseType ===
        "MAINTENANCE"
          ? Number(form.jumlah)
          : null,

      satuan:
        form.satuan,

      hargaSatuan:
        Number(
          form.hargaSatuan
        ),

      keterangan:
        form.keterangan.trim(),
    };

    try {
      if (isEdit) {
        await onUpdate(
          initialData,
          payload
        );
      } else {
        await onSave(payload);
      }
    } catch (err) {
      setError(
        err.message ||
          "Pembelian gagal disimpan."
      );
    }
  }

  if (loadingMaster) {
    return (
      <div className="p-6 text-sm text-gray-500">
        Memuat master purchasing...
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-5"
    >
      <div>
        <h2 className="text-xl font-semibold text-gray-800">
          {isEdit
            ? "Edit Pembelian"
            : "Tambah Pembelian"}
        </h2>

        <p className="mt-1 text-sm text-gray-500">
          Catat pembelian bahan baku
          atau kebutuhan maintenance
          dapur.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <FormField
        label="Tanggal"
        type="date"
        value={form.tanggal}
        onChange={(event) =>
          updateField(
            "tanggal",
            event.target.value
          )
        }
        required
      />

      <div>
        <label className="mb-2 block text-sm font-medium text-gray-700">
          Jenis Pembelian
        </label>

        <select
          value={
            form.purchaseType
          }
          onChange={(event) =>
            handlePurchaseTypeChange(
              event.target.value
            )
          }
          disabled={isEdit}
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-100 disabled:bg-gray-100"
        >
          <option value="INGREDIENT">
            Bahan Baku
          </option>

          <option value="MAINTENANCE">
            Maintenance
          </option>
        </select>

        {isEdit && (
          <p className="mt-1 text-xs text-gray-500">
            Jenis pembelian tidak dapat
            diubah saat edit.
          </p>
        )}
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-gray-700">
          {form.purchaseType ===
          "INGREDIENT"
            ? "Bahan Baku"
            : "Barang Maintenance"}
        </label>

        <select
          value={
            form.purchaseType ===
            "INGREDIENT"
              ? form.ingredientId
              : form.maintenanceItemId
          }
          onChange={(event) =>
            handleItemChange(
              event.target.value
            )
          }
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-100"
          required
        >
          <option value="">
            -- Pilih{" "}
            {form.purchaseType ===
            "INGREDIENT"
              ? "bahan baku"
              : "barang maintenance"}{" "}
            --
          </option>

          {form.purchaseType ===
            "INGREDIENT" &&
            ingredients.map(
              (item) => (
                <option
                  key={item.id}
                  value={item.id}
                >
                  {item.kode} —{" "}
                  {item.nama}
                </option>
              )
            )}

          {form.purchaseType ===
            "MAINTENANCE" &&
            maintenanceItems.map(
              (item) => (
                <option
                  key={item.id}
                  value={item.id}
                >
                  {item.kode} —{" "}
                  {item.nama}
                </option>
              )
            )}
        </select>
      </div>

      <FormField
        label="Supplier"
        type="select"
        value={form.supplierId}
        onChange={(event) =>
          updateField(
            "supplierId",
            event.target.value
          )
        }
      >
        <option value="">
          -- Pilih supplier --
        </option>

        {suppliers.map(
          (supplier) => (
            <option
              key={supplier.id}
              value={supplier.id}
            >
              {supplier.nama}
            </option>
          )
        )}
      </FormField>

      {form.purchaseType ===
        "INGREDIENT" && (
        <>
          <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
            <p className="text-sm font-medium text-gray-700">
              Sediaan Pembelian
            </p>

            <p className="mt-1 text-xs text-gray-500">
              Isi sesuai kemasan yang
              benar-benar kamu beli.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label="Jumlah Sediaan"
              type="number"
              value={
                form.jumlahSediaan
              }
              onChange={(event) =>
                updateField(
                  "jumlahSediaan",
                  event.target.value
                )
              }
              min="0"
              step="0.001"
              placeholder="Contoh: 4"
              required
            />

            <FormField
              label="Isi per Sediaan"
              type="number"
              value={
                form.isiPerSediaan
              }
              onChange={(event) =>
                updateField(
                  "isiPerSediaan",
                  event.target.value
                )
              }
              min="0"
              step="0.001"
              placeholder="Contoh: 250"
              required
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label="Satuan Isi"
              type="select"
              value={
                form.satuanSediaan
              }
              onChange={(event) =>
                updateField(
                  "satuanSediaan",
                  event.target.value
                )
              }
              required
            >
              <option value="">
                -- Pilih satuan --
              </option>

              <option value="gram">
                gram
              </option>

              <option value="kg">
                kg
              </option>

              <option value="ml">
                ml
              </option>

              <option value="liter">
                liter
              </option>

              <option value="pcs">
                pcs
              </option>
            </FormField>

            <FormField
              label="Satuan Inventory"
              value={form.satuan}
              onChange={(event) =>
                updateField(
                  "satuan",
                  event.target.value
                )
              }
              disabled
            />
          </div>

          <FormField
            label="Harga per Sediaan"
            type="number"
            value={
              form.hargaSatuan
            }
            onChange={(event) =>
              updateField(
                "hargaSatuan",
                event.target.value
              )
            }
            min="0"
            step="1"
            placeholder="Contoh: 7000"
            required
          />

          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
            <p className="text-sm font-medium text-blue-800">
              Stok yang Masuk
            </p>

            <p className="mt-1 text-2xl font-bold text-blue-700">
              {stockIncoming.toLocaleString(
                "id-ID",
                {
                  maximumFractionDigits: 3,
                }
              )}{" "}
              {form.satuan}
            </p>
          </div>
        </>
      )}

      {form.purchaseType ===
        "MAINTENANCE" && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label="Jumlah"
              type="number"
              value={form.jumlah}
              onChange={(event) =>
                updateField(
                  "jumlah",
                  event.target.value
                )
              }
              min="0"
              step="0.001"
              required
            />

            <FormField
              label="Satuan"
              value={form.satuan}
              onChange={(event) =>
                updateField(
                  "satuan",
                  event.target.value
                )
              }
              required
            />
          </div>

          <FormField
            label="Harga Satuan"
            type="number"
            value={
              form.hargaSatuan
            }
            onChange={(event) =>
              updateField(
                "hargaSatuan",
                event.target.value
              )
            }
            min="0"
            step="1"
            required
          />
        </>
      )}

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm font-medium text-amber-800">
          Total Pembelian
        </p>

        <p className="mt-1 text-2xl font-bold text-amber-700">
          Rp{" "}
          {total.toLocaleString(
            "id-ID"
          )}
        </p>
      </div>

      <FormField
        label="Keterangan"
        value={form.keterangan}
        onChange={(event) =>
          updateField(
            "keterangan",
            event.target.value
          )
        }
        placeholder="Opsional"
      />

      <div className="flex justify-end gap-3 pt-2">
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          disabled={saving}
        >
          Batal
        </Button>

        <Button
          type="submit"
          disabled={saving}
        >
          {saving
            ? "Menyimpan..."
            : isEdit
            ? "Simpan Perubahan"
            : "Simpan Pembelian"}
        </Button>
      </div>
    </form>
  );
}