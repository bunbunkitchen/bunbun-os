import {
  useEffect,
  useState,
} from "react";

import Input from "../ui/Input";
import Button from "../ui/Button";

import {
  getAllCategories,
} from "../../services/categoryService";

export default function ProductForm({
  onSave,
  onCancel,
  initialData = null,
  saving = false,
}) {
  const isEditing =
    Boolean(initialData);

  const [categories, setCategories] =
    useState([]);

  const [loadingCategories, setLoadingCategories] =
    useState(true);

  const [form, setForm] = useState({
    sku: initialData?.sku || "",
    nama: initialData?.nama || "",
    categoryId:
      initialData?.categoryId?.toString() ||
      "",
    harga:
      initialData?.harga?.toString() ||
      "",
    status:
      initialData?.status || "Aktif",
  });

  const [errors, setErrors] =
    useState({});

  const [formError, setFormError] =
    useState("");

  useEffect(() => {
    async function loadCategories() {
      try {
        setFormError("");

        const data =
          await getAllCategories();

        setCategories(
          data.filter(
            (category) =>
              category.status === "Aktif" ||
              category.id ===
                initialData?.categoryId
          )
        );
      } catch (error) {
        console.error(
          "Gagal memuat kategori:",
          error
        );

        setFormError(
          error.message ||
            "Kategori gagal dimuat."
        );
      } finally {
        setLoadingCategories(false);
      }
    }

    loadCategories();
  }, [initialData]);

  useEffect(() => {
    if (!initialData) {
      return;
    }

    setForm({
      sku: initialData.sku || "",
      nama: initialData.nama || "",
      categoryId:
        initialData.categoryId?.toString() ||
        "",
      harga:
        initialData.harga?.toString() ||
        "",
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

    if (!form.sku.trim()) {
      newErrors.sku =
        "SKU wajib diisi";
    }

    if (!form.nama.trim()) {
      newErrors.nama =
        "Nama produk wajib diisi";
    }

    if (!form.categoryId) {
      newErrors.categoryId =
        "Kategori wajib dipilih";
    }

    if (form.harga === "") {
      newErrors.harga =
        "Harga jual wajib diisi";
    } else if (
      Number(form.harga) < 0
    ) {
      newErrors.harga =
        "Harga jual tidak boleh negatif";
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
        sku: form.sku.trim(),
        nama: form.nama.trim(),
        categoryId: Number(
          form.categoryId
        ),
        harga: Number(form.harga),
        status: form.status,
      });
    } catch (error) {
      console.error(
        "Gagal menyimpan produk:",
        error
      );

      setFormError(
        error.message ||
          "Produk gagal disimpan."
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
          ? "Edit Produk"
          : "Tambah Produk"}
      </h2>

      {formError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {formError}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <Input
            placeholder="SKU"
            value={form.sku}
            onChange={(event) =>
              handleChange(
                "sku",
                event.target.value
              )
            }
            disabled={saving}
          />

          {renderError("sku")}
        </div>

        <div>
          <Input
            placeholder="Nama Produk"
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
          <select
            value={form.categoryId}
            onChange={(event) =>
              handleChange(
                "categoryId",
                event.target.value
              )
            }
            disabled={
              loadingCategories || saving
            }
            className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none transition focus:border-amber-600 disabled:cursor-not-allowed disabled:bg-gray-100"
          >
            <option value="">
              {loadingCategories
                ? "Memuat kategori..."
                : "Pilih kategori"}
            </option>

            {categories.map(
              (category) => (
                <option
                  key={category.id}
                  value={category.id}
                >
                  {category.kode} —{" "}
                  {category.nama}
                </option>
              )
            )}
          </select>

          {renderError("categoryId")}
        </div>

        <div>
          <Input
            type="number"
            min="0"
            step="0.01"
            placeholder="Harga Jual"
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
            loadingCategories || saving
          }
        >
          Batal
        </Button>

        <Button
          onClick={handleSubmit}
          disabled={
            loadingCategories || saving
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