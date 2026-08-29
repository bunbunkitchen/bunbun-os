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

  jumlahSediaan: "",
  isiPerSediaan: "",
  satuanSediaan: "",

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

function calculateIncomingStock({
  jumlahSediaan,
  isiPerSediaan,
  satuanSediaan,
  satuanInventory,
}) {
  const totalIsi =
    Number(jumlahSediaan || 0) *
    Number(isiPerSediaan || 0);

  if (
    !totalIsi ||
    !satuanSediaan ||
    !satuanInventory
  ) {
    return 0;
  }

  const baseQuantity =
    toBaseQuantity(
      totalIsi,
      satuanSediaan
    );

  return fromBaseQuantity(
    baseQuantity,
    satuanInventory
  );
}

export default function PurchaseForm({
  initialData = null,
  onSave,
  onCancel,
  saving = false,
}) {
  const [form, setForm] =
    useState(INITIAL_FORM);

  const [
    ingredients,
    setIngredients,
  ] = useState([]);

  const [
    maintenanceItems,
    setMaintenanceItems,
  ] = useState([]);

  const [
    suppliers,
    setSuppliers,
  ] = useState([]);

  const [
    loadingMaster,
    setLoadingMaster,
  ] = useState(true);

  const [error, setError] =
    useState("");

  const isEdit =
    Boolean(initialData);

  /*
   * ============================
   * LOAD MASTER DATA
   * ============================
   */

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

  /*
   * ============================
   * LOAD DATA SAAT EDIT
   * ============================
   */

  useEffect(() => {
    if (!initialData) {
      setForm({
        ...INITIAL_FORM,
        tanggal: new Date()
          .toISOString()
          .slice(0, 10),
      });

      setError("");
      return;
    }

    const isMaintenance =
      initialData.purchaseType ===
      "MAINTENANCE";

    /*
     * Data lama maintenance
     * masih mungkin hanya mempunyai
     * jumlah dan satuan.
     *
     * Kita tetap support agar
     * data lama tidak rusak.
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

      /*
       * SEDIAAN
       *
       * Berlaku untuk:
       * - Bahan Baku
       * - Maintenance baru
       */

      jumlahSediaan:
        initialData.jumlahSediaan != null
          ? initialData.jumlahSediaan
          : legacyJumlah,

      isiPerSediaan:
        initialData.isiPerSediaan != null
          ? initialData.isiPerSediaan
          : 1,

      satuanSediaan:
        initialData.satuanSediaan
          ? initialData.satuanSediaan
          : legacySatuan,

      satuan:
        initialData.satuan || "",

      hargaSatuan:
        initialData.hargaSatuan ?? "",

      keterangan:
        initialData.keterangan || "",
    });

    setError("");
  }, [initialData]);

  /*
   * ============================
   * SELECTED MASTER
   * ============================
   */

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
   * ============================
   * TOTAL PEMBELIAN
   * ============================
   *
   * Untuk KEDUANYA:
   *
   * Jumlah Sediaan
   * ×
   * Harga per Sediaan
   */

  const total = useMemo(() => {
    return (
      Number(
        form.jumlahSediaan || 0
      ) *
      Number(
        form.hargaSatuan || 0
      )
    );
  }, [
    form.jumlahSediaan,
    form.hargaSatuan,
  ]);

  /*
   * ============================
   * STOK YANG MASUK
   * ============================
   */

  const stockIncoming =
    useMemo(() => {
      return calculateIncomingStock({
        jumlahSediaan:
          form.jumlahSediaan,

        isiPerSediaan:
          form.isiPerSediaan,

        satuanSediaan:
          form.satuanSediaan,

        satuanInventory:
          form.satuan,
      });
    }, [
      form.jumlahSediaan,
      form.isiPerSediaan,
      form.satuanSediaan,
      form.satuan,
    ]);

  /*
   * ============================
   * UPDATE FIELD
   * ============================
   */

  function updateField(
    name,
    value
  ) {
    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));
  }

  /*
   * ============================
   * CHANGE PURCHASE TYPE
   * ============================
   */

  function handlePurchaseTypeChange(
    value
  ) {
    setForm((previous) => ({
      ...previous,

      purchaseType: value,

      ingredientId: "",

      maintenanceItemId: "",

      jumlahSediaan: "",

      isiPerSediaan: "",

      satuanSediaan: "",

      satuan: "",

      hargaSatuan: "",
    }));
  }

  /*
   * ============================
   * CHANGE ITEM
   * ============================
   */

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

        satuanSediaan:
          ingredient?.satuan ||
          "",

        hargaSatuan: "",
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

      satuanSediaan:
        maintenance?.satuan ||
        "",

      hargaSatuan:
        maintenance?.harga ?? "",
    }));
  }

  /*
   * ============================
   * SUBMIT
   * ============================
   */

  async function handleSubmit(
    event
  ) {
    event.preventDefault();

    setError("");

    /*
     * TANGGAL
     */

    if (!form.tanggal) {
      setError(
        "Tanggal pembelian wajib diisi."
      );
      return;
    }

    /*
     * ITEM
     */

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
    } else {
      if (
        !form.maintenanceItemId
      ) {
        setError(
          "Barang maintenance wajib dipilih."
        );
        return;
      }
    }

    /*
     * JUMLAH SEDIAAN
     */

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

    /*
     * ISI PER SEDIAAN
     */

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

    /*
     * SATUAN ISI
     */

    if (
      !form.satuanSediaan ||
      !form.satuanSediaan.trim()
    ) {
      setError(
        "Satuan isi wajib dipilih."
      );
      return;
    }

    /*
     * SATUAN INVENTORY
     */

    if (
      !form.satuan ||
      !form.satuan.trim()
    ) {
      setError(
        "Satuan inventory tidak ditemukan."
      );
      return;
    }

    /*
     * HARGA
     */

    if (
      form.hargaSatuan === "" ||
      form.hargaSatuan === null ||
      Number(
        form.hargaSatuan
      ) < 0
    ) {
      setError(
        "Harga per sediaan tidak valid."
      );
      return;
    }

    /*
     * ============================
     * PAYLOAD
     * ============================
     */

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
       * SEDIAAN
       */

      jumlahSediaan:
        Number(
          form.jumlahSediaan
        ),

      isiPerSediaan:
        Number(
          form.isiPerSediaan
        ),

      satuanSediaan:
        form.satuanSediaan.trim(),

      /*
       * Inventory
       *
       * Nilai ini adalah hasil
       * konversi total isi sediaan.
       */

      jumlah:
        stockIncoming,

      satuan:
        form.satuan,

      /*
       * Harga untuk 1 sediaan.
       */

      hargaSatuan:
        Number(
          form.hargaSatuan
        ),

      /*
       * Total:
       *
       * jumlah sediaan
       * ×
       * harga per sediaan
       */

      keterangan:
        form.keterangan.trim(),
    };

    try {
      await onSave(payload);
    } catch (err) {
      console.error(
        "PurchaseForm submit error:",
        err
      );

      setError(
        err.message ||
          "Pembelian gagal disimpan."
      );

      throw err;
    }
  }

  /*
   * ============================
   * LOADING
   * ============================
   */

  if (loadingMaster) {
    return (
      <div className="p-6 text-sm text-gray-500">
        Memuat master purchasing...
      </div>
    );
  }

  /*
   * ============================
   * RENDER
   * ============================
   */

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