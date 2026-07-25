import {
  useEffect,
  useMemo,
  useState,
} from "react";

import Input from "../ui/Input";
import Button from "../ui/Button";
import Currency from "../ui/Currency";

import {
  getAllSuppliers,
} from "../../services/supplierService";

import {
  getAllIngredients,
} from "../../services/ingredientService";

export default function PurchaseForm({
  onSave,
  onCancel,
  initialData = null,
  saving = false,
}) {
  const isEditing = Boolean(initialData);

  const [suppliers, setSuppliers] =
    useState([]);

  const [ingredients, setIngredients] =
    useState([]);

  const [loadingMaster, setLoadingMaster] =
    useState(true);

  const [formError, setFormError] =
    useState("");

  const [errors, setErrors] =
    useState({});

  const [form, setForm] = useState({
    tanggal:
      initialData?.tanggal || "",
    supplierId:
      initialData?.supplierId?.toString() ||
      "",
    ingredientId:
      initialData?.ingredientId?.toString() ||
      "",
    jumlah:
      initialData?.jumlah?.toString() ||
      "",
    satuan:
      initialData?.satuan || "",
    hargaSatuan:
      initialData?.hargaSatuan?.toString() ||
      "",
    keterangan:
      initialData?.keterangan || "",
  });

  useEffect(() => {
    async function loadMasterData() {
      try {
        setFormError("");

        const [
          supplierData,
          ingredientData,
        ] = await Promise.all([
          getAllSuppliers(),
          getAllIngredients(),
        ]);

        setSuppliers(supplierData);
        setIngredients(ingredientData);
      } catch (error) {
        console.error(
          "Gagal memuat master pembelian:",
          error
        );

        setFormError(
          error.message ||
            "Data supplier dan bahan baku gagal dimuat."
        );
      } finally {
        setLoadingMaster(false);
      }
    }

    loadMasterData();
  }, []);

  useEffect(() => {
    if (!initialData) {
      return;
    }

    setForm({
      tanggal:
        initialData.tanggal || "",
      supplierId:
        initialData.supplierId?.toString() ||
        "",
      ingredientId:
        initialData.ingredientId?.toString() ||
        "",
      jumlah:
        initialData.jumlah?.toString() ||
        "",
      satuan:
        initialData.satuan || "",
      hargaSatuan:
        initialData.hargaSatuan?.toString() ||
        "",
      keterangan:
        initialData.keterangan || "",
    });
  }, [initialData]);

  const selectedIngredient = useMemo(
    () =>
      ingredients.find(
        (item) =>
          item.id ===
          Number(form.ingredientId)
      ) ?? null,
    [ingredients, form.ingredientId]
  );

  const total = useMemo(() => {
    const jumlah =
      Number(form.jumlah) || 0;

    const hargaSatuan =
      Number(form.hargaSatuan) || 0;

    return jumlah * hargaSatuan;
  }, [
    form.jumlah,
    form.hargaSatuan,
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

  function handleIngredientChange(value) {
    const ingredient =
      ingredients.find(
        (item) =>
          item.id === Number(value)
      );

    setForm((previous) => ({
      ...previous,
      ingredientId: value,
      satuan:
        ingredient?.satuan || "",
      hargaSatuan:
        ingredient?.harga?.toString() ||
        "",
    }));

    setErrors((previous) => ({
      ...previous,
      ingredientId: "",
      satuan: "",
      hargaSatuan: "",
    }));

    setFormError("");
  }

  function validate() {
    const newErrors = {};

    if (!form.tanggal) {
      newErrors.tanggal =
        "Tanggal pembelian wajib diisi";
    }

    if (!form.ingredientId) {
      newErrors.ingredientId =
        "Bahan baku wajib dipilih";
    }

    if (!form.jumlah) {
      newErrors.jumlah =
        "Jumlah wajib diisi";
    } else if (
      Number(form.jumlah) <= 0
    ) {
      newErrors.jumlah =
        "Jumlah harus lebih dari 0";
    }

    if (!form.satuan.trim()) {
      newErrors.satuan =
        "Satuan wajib diisi";
    }

    if (
      form.hargaSatuan === ""
    ) {
      newErrors.hargaSatuan =
        "Harga satuan wajib diisi";
    } else if (
      Number(form.hargaSatuan) < 0
    ) {
      newErrors.hargaSatuan =
        "Harga satuan tidak boleh negatif";
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

        supplierId:
          form.supplierId
            ? Number(form.supplierId)
            : null,

        ingredientId: Number(
          form.ingredientId
        ),

        jumlah: Number(
          form.jumlah
        ),

        satuan:
          form.satuan.trim(),

        hargaSatuan: Number(
          form.hargaSatuan
        ),

        keterangan:
          form.keterangan.trim(),
      });
    } catch (error) {
      console.error(
        "Gagal menyimpan pembelian:",
        error
      );

      setFormError(
        error.message ||
          "Pembelian gagal disimpan."
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
          ? "Edit Pembelian"
          : "Tambah Pembelian"}
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
            value={form.supplierId}
            onChange={(event) =>
              handleChange(
                "supplierId",
                event.target.value
              )
            }
            disabled={
              loadingMaster || saving
            }
            className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none transition focus:border-amber-600 disabled:cursor-not-allowed disabled:bg-gray-100"
          >
            <option value="">
              Supplier opsional
            </option>

            {suppliers.map(
              (supplier) => (
                <option
                  key={supplier.id}
                  value={supplier.id}
                >
                  {supplier.kode} —{" "}
                  {supplier.nama}
                </option>
              )
            )}
          </select>
        </div>

        <div>
          <select
            value={form.ingredientId}
            onChange={(event) =>
              handleIngredientChange(
                event.target.value
              )
            }
            disabled={
              loadingMaster || saving
            }
            className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none transition focus:border-amber-600 disabled:cursor-not-allowed disabled:bg-gray-100"
          >
            <option value="">
              {loadingMaster
                ? "Memuat bahan baku..."
                : "Pilih bahan baku"}
            </option>

            {ingredients.map(
              (ingredient) => (
                <option
                  key={ingredient.id}
                  value={ingredient.id}
                >
                  {ingredient.kode} —{" "}
                  {ingredient.nama}
                </option>
              )
            )}
          </select>

          {renderError(
            "ingredientId"
          )}
        </div>

        <div>
          <Input
            type="number"
            min="0"
            step="0.001"
            placeholder="Jumlah"
            value={form.jumlah}
            onChange={(event) =>
              handleChange(
                "jumlah",
                event.target.value
              )
            }
            disabled={saving}
          />

          {renderError("jumlah")}
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
            placeholder="Harga per satuan"
            value={form.hargaSatuan}
            onChange={(event) =>
              handleChange(
                "hargaSatuan",
                event.target.value
              )
            }
            disabled={saving}
          />

          {renderError(
            "hargaSatuan"
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

      {selectedIngredient && (
        <div className="mt-6 rounded-xl bg-stone-100 p-4">
          <p className="text-sm text-gray-500">
            Total Pembelian
          </p>

          <p className="mt-1 text-2xl font-bold text-amber-700">
            <Currency value={total} />
          </p>
        </div>
      )}

      <div className="mt-6 flex justify-end gap-3">
        <Button
          onClick={onCancel}
          disabled={
            loadingMaster || saving
          }
        >
          Batal
        </Button>

        <Button
          onClick={handleSubmit}
          disabled={
            loadingMaster || saving
          }
        >
          {saving
            ? "Menyimpan..."
            : isEditing
            ? "Simpan Perubahan"
            : "Simpan Pembelian"}
        </Button>
      </div>
    </>
  );
}