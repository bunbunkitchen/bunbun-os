import {
  useEffect,
  useState,
} from "react";

import Input from "../ui/Input";
import Button from "../ui/Button";

import {
  getAllProducts,
} from "../../services/productService";

export default function RecipeForm({
  onSave,
  onCancel,
  initialData = null,
  saving = false,
}) {
  const isEditing =
    Boolean(initialData);

  const [products, setProducts] =
    useState([]);

  const [
    loadingProducts,
    setLoadingProducts,
  ] = useState(true);

  const [form, setForm] = useState({
    kode:
      initialData?.kode || "",
    nama:
      initialData?.nama || "",
    productId:
      initialData?.productId?.toString() ||
      "",
    kategori:
      initialData?.kategori || "",
    yield:
      initialData?.yield?.toString() ||
      "",
    satuanYield:
      initialData?.satuanYield ||
      "pcs",
    status:
      initialData?.status || "Aktif",
  });

  const [errors, setErrors] =
    useState({});

  const [formError, setFormError] =
    useState("");

  useEffect(() => {
    async function loadProducts() {
      try {
        setFormError("");

        const data =
          await getAllProducts();

        setProducts(
          data.filter(
            (product) =>
              product.status ===
                "Aktif" ||
              product.id ===
                initialData?.productId
          )
        );
      } catch (error) {
        console.error(
          "Gagal memuat produk:",
          error
        );

        setFormError(
          error.message ||
            "Daftar produk gagal dimuat."
        );
      } finally {
        setLoadingProducts(false);
      }
    }

    loadProducts();
  }, [initialData]);

  useEffect(() => {
    if (!initialData) {
      return;
    }

    setForm({
      kode:
        initialData.kode || "",
      nama:
        initialData.nama || "",
      productId:
        initialData.productId?.toString() ||
        "",
      kategori:
        initialData.kategori || "",
      yield:
        initialData.yield?.toString() ||
        "",
      satuanYield:
        initialData.satuanYield ||
        "pcs",
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

  function handleProductChange(value) {
    const selectedProduct =
      products.find(
        (product) =>
          product.id === Number(value)
      );

    setForm((previous) => ({
      ...previous,
      productId: value,
      nama:
        previous.nama ||
        selectedProduct?.nama ||
        "",
      kategori:
        selectedProduct?.kategori ||
        previous.kategori,
    }));

    setErrors((previous) => ({
      ...previous,
      productId: "",
    }));

    setFormError("");
  }

  function validate() {
    const newErrors = {};

    if (!form.kode.trim()) {
      newErrors.kode =
        "Kode Recipe wajib diisi";
    }

    if (!form.nama.trim()) {
      newErrors.nama =
        "Nama Recipe wajib diisi";
    }

    if (!form.productId) {
      newErrors.productId =
        "Produk wajib dipilih";
    }

    if (form.yield === "") {
      newErrors.yield =
        "Yield wajib diisi";
    } else if (
      Number(form.yield) <= 0
    ) {
      newErrors.yield =
        "Yield harus lebih dari 0";
    }

    if (!form.satuanYield.trim()) {
      newErrors.satuanYield =
        "Satuan Yield wajib diisi";
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
        productId: Number(
          form.productId
        ),
        kategori:
          form.kategori.trim(),
        yield: Number(form.yield),
        satuanYield:
          form.satuanYield.trim(),
        status: form.status,
      });
    } catch (error) {
      console.error(
        "Gagal menyimpan Recipe:",
        error
      );

      setFormError(
        error.message ||
          "Recipe gagal disimpan."
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
          ? "Edit Recipe"
          : "Tambah Recipe"}
      </h2>

      {formError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {formError}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <Input
            placeholder="Kode Recipe"
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
          <select
            value={form.productId}
            onChange={(event) =>
              handleProductChange(
                event.target.value
              )
            }
            disabled={
              loadingProducts || saving
            }
            className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none transition focus:border-amber-600 disabled:cursor-not-allowed disabled:bg-gray-100"
          >
            <option value="">
              {loadingProducts
                ? "Memuat produk..."
                : "Pilih produk"}
            </option>

            {products.map((product) => (
              <option
                key={product.id}
                value={product.id}
              >
                {product.sku} —{" "}
                {product.nama}
              </option>
            ))}
          </select>

          {renderError("productId")}
        </div>

        <div>
          <Input
            placeholder="Nama Recipe"
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
            disabled
          />
        </div>

        <div>
          <Input
            type="number"
            min="0"
            step="0.001"
            placeholder="Yield"
            value={form.yield}
            onChange={(event) =>
              handleChange(
                "yield",
                event.target.value
              )
            }
            disabled={saving}
          />

          {renderError("yield")}
        </div>

        <div>
          <Input
            placeholder="Satuan Yield"
            value={form.satuanYield}
            onChange={(event) =>
              handleChange(
                "satuanYield",
                event.target.value
              )
            }
            disabled={saving}
          />

          {renderError(
            "satuanYield"
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
          disabled={
            loadingProducts || saving
          }
        >
          Batal
        </Button>

        <Button
          onClick={handleSubmit}
          disabled={
            loadingProducts || saving
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