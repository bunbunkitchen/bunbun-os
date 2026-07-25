import {
  useEffect,
  useMemo,
  useState,
} from "react";

import Input from "../ui/Input";
import Button from "../ui/Button";

import {
  getAllIngredients,
} from "../../services/ingredientService";

function getRecipeUnit(masterUnit) {
  const unit =
    String(masterUnit || "").toLowerCase();

  if (unit === "kg") {
    return "gram";
  }

  if (
    unit === "liter" ||
    unit === "l"
  ) {
    return "ml";
  }

  return masterUnit || "";
}

export default function RecipeIngredientForm({
  recipeId,
  onSave,
  onCancel,
  nextOrder = 1,
  initialData = null,
  usedIngredientIds = [],
  saving = false,
}) {
  const isEditing =
    Boolean(initialData);

  const [ingredients, setIngredients] =
    useState([]);

  const [
    loadingIngredients,
    setLoadingIngredients,
  ] = useState(true);

  const [form, setForm] = useState({
    ingredientId:
      initialData?.ingredientId?.toString() ||
      "",
    jumlah:
      initialData?.jumlah?.toString() ||
      "",
    satuan:
      initialData?.satuan || "",
  });

  const [errors, setErrors] =
    useState({});

  const [formError, setFormError] =
    useState("");

  useEffect(() => {
    async function loadIngredients() {
      try {
        setFormError("");

        const data =
          await getAllIngredients();

        setIngredients(
          data.filter((ingredient) => {
            const isCurrent =
              ingredient.id ===
              initialData?.ingredientId;

            const alreadyUsed =
              usedIngredientIds.includes(
                ingredient.id
              );

            return (
              isCurrent ||
              (
                ingredient.status ===
                  "Aktif" &&
                !alreadyUsed
              )
            );
          })
        );
      } catch (error) {
        console.error(
          "Gagal mengambil bahan baku:",
          error
        );

        setFormError(
          error.message ||
            "Daftar bahan baku gagal dimuat."
        );
      } finally {
        setLoadingIngredients(false);
      }
    }

    loadIngredients();
  }, [
    initialData,
    usedIngredientIds,
  ]);

  useEffect(() => {
    if (!initialData) {
      return;
    }

    setForm({
      ingredientId:
        initialData.ingredientId?.toString() ||
        "",
      jumlah:
        initialData.jumlah?.toString() ||
        "",
      satuan:
        initialData.satuan || "",
    });
  }, [initialData]);

  const selectedIngredient = useMemo(
    () =>
      ingredients.find(
        (ingredient) =>
          ingredient.id ===
          Number(form.ingredientId)
      ) ?? null,
    [
      ingredients,
      form.ingredientId,
    ]
  );

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
      satuan: getRecipeUnit(
        ingredient?.satuan
      ),
    }));

    setErrors((previous) => ({
      ...previous,
      ingredientId: "",
      satuan: "",
    }));

    setFormError("");
  }

  function validate() {
    const newErrors = {};

    if (!form.ingredientId) {
      newErrors.ingredientId =
        "Bahan baku wajib dipilih";
    }

    if (form.jumlah === "") {
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
        recipeId,
        ingredientId: Number(
          form.ingredientId
        ),
        jumlah: Number(form.jumlah),
        satuan: form.satuan.trim(),
        urutan:
          initialData?.urutan ||
          nextOrder,
      });
    } catch (error) {
      console.error(
        "Gagal menyimpan bahan Recipe:",
        error
      );

      const duplicate =
        error.code === "23505";

      setFormError(
        duplicate
          ? "Bahan tersebut sudah ada dalam Recipe."
          : error.message ||
              "Bahan Recipe gagal disimpan."
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
          ? "Edit Bahan Recipe"
          : "Tambah Bahan Recipe"}
      </h2>

      {formError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {formError}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <select
            value={form.ingredientId}
            onChange={(event) =>
              handleIngredientChange(
                event.target.value
              )
            }
            disabled={
              loadingIngredients ||
              saving
            }
            className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none transition focus:border-amber-600 disabled:cursor-not-allowed disabled:bg-gray-100"
          >
            <option value="">
              {loadingIngredients
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
      </div>

      {selectedIngredient && (
        <div className="mt-5 rounded-xl bg-stone-100 p-4 text-sm">
          <p className="text-gray-500">
            Bahan terpilih
          </p>

          <p className="mt-1 font-semibold text-gray-800">
            {selectedIngredient.nama}
          </p>

          <p className="mt-1 text-gray-500">
            Harga master menggunakan satuan{" "}
            {selectedIngredient.satuan}.
          </p>
        </div>
      )}

      <div className="mt-6 flex justify-end gap-3">
        <Button
          onClick={onCancel}
          disabled={saving}
        >
          Batal
        </Button>

        <Button
          onClick={handleSubmit}
          disabled={
            loadingIngredients ||
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