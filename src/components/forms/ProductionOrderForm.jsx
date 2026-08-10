import {
  useEffect,
  useMemo,
  useState,
} from "react";

import Input from "../ui/Input";
import Button from "../ui/Button";
import Currency from "../ui/Currency";

import {
  getAllRecipes,
  getRecipeItems,
} from "../../services/recipeService";

import {
  calculateProductionCost,
  scaleRecipeIngredients,
} from "../../utils/productionCalculator";

export default function ProductionOrderForm({
  onSave,
  onCancel,
}) {
  const [recipes, setRecipes] = useState([]);
  const [recipeItems, setRecipeItems] = useState([]);

  const [loadingRecipes, setLoadingRecipes] =
    useState(true);

  const [loadingItems, setLoadingItems] =
    useState(false);

  const [form, setForm] = useState({
    tanggal: "",
    recipeId: "",
    targetProduksi: "",
  });

  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");

  useEffect(() => {
    async function loadRecipes() {
      try {
        const data = await getAllRecipes();
        setRecipes(data);
      } catch (error) {
        console.error(
          "Gagal mengambil recipe:",
          error
        );

        setFormError(
          error.message ||
            "Daftar recipe gagal dimuat."
        );
      } finally {
        setLoadingRecipes(false);
      }
    }

    loadRecipes();
  }, []);

  const selectedRecipe = useMemo(
    () =>
      recipes.find(
        (recipe) =>
          recipe.id === Number(form.recipeId)
      ) ?? null,
    [recipes, form.recipeId]
  );

  useEffect(() => {
    async function loadRecipeItems() {
      if (!selectedRecipe) {
        setRecipeItems([]);
        return;
      }

      try {
        setLoadingItems(true);
        setFormError("");

        const data = await getRecipeItems(
          selectedRecipe.id
        );

        setRecipeItems(data);
      } catch (error) {
        console.error(
          "Gagal mengambil komposisi recipe:",
          error
        );

        setRecipeItems([]);

        setFormError(
          error.message ||
            "Komposisi recipe gagal dimuat."
        );
      } finally {
        setLoadingItems(false);
      }
    }

    loadRecipeItems();
  }, [selectedRecipe]);

  const scaledIngredients = useMemo(() => {
    if (
      !selectedRecipe ||
      !form.targetProduksi
    ) {
      return [];
    }

    return scaleRecipeIngredients(
      recipeItems,
      selectedRecipe.yield,
      Number(form.targetProduksi)
    );
  }, [
    recipeItems,
    selectedRecipe,
    form.targetProduksi,
  ]);

  const estimatedCost = useMemo(
    () =>
      calculateProductionCost(
        scaledIngredients
      ),
    [scaledIngredients]
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

  function validate() {
    const newErrors = {};

    if (!form.tanggal) {
      newErrors.tanggal =
        "Tanggal produksi wajib diisi";
    }

    if (!form.recipeId) {
      newErrors.recipeId =
        "Recipe wajib dipilih";
    }

    if (!form.targetProduksi) {
      newErrors.targetProduksi =
        "Target produksi wajib diisi";
    } else if (
      Number(form.targetProduksi) <= 0
    ) {
      newErrors.targetProduksi =
        "Target produksi harus lebih dari 0";
    }

    if (
      selectedRecipe &&
      recipeItems.length === 0
    ) {
      setFormError(
        "Recipe belum mempunyai komposisi bahan."
      );
    }

    setErrors(newErrors);

    return (
      Object.keys(newErrors).length === 0 &&
      recipeItems.length > 0
    );
  }

  function handleSubmit() {
    if (!validate() || !selectedRecipe) {
      return;
    }

    onSave({
      kode: `PO-${Date.now()}`,
      tanggal: form.tanggal,
      recipeId: selectedRecipe.id,
      recipeKode: selectedRecipe.kode,
      recipeNama: selectedRecipe.nama,
      targetProduksi: Number(
        form.targetProduksi
      ),
      satuan: selectedRecipe.satuanYield,
      estimasiBiaya: estimatedCost,
      status: "Draft",
      bahan: scaledIngredients,
    });
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
        Buat Production Order
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
          />

          {renderError("tanggal")}
        </div>

        <div>
          <select
            value={form.recipeId}
            onChange={(event) =>
              handleChange(
                "recipeId",
                event.target.value
              )
            }
            disabled={loadingRecipes}
            className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none transition focus:border-amber-600 disabled:bg-gray-100"
          >
            <option value="">
              {loadingRecipes
                ? "Memuat recipe..."
                : "Pilih recipe"}
            </option>

            {recipes.map((recipe) => (
              <option
                key={recipe.id}
                value={recipe.id}
              >
                {recipe.kode} — {recipe.nama}
              </option>
            ))}
          </select>

          {renderError("recipeId")}
        </div>

        <div>
          <Input
            type="number"
            min="1"
            placeholder="Target produksi"
            value={form.targetProduksi}
            onChange={(event) =>
              handleChange(
                "targetProduksi",
                event.target.value
              )
            }
          />

          {renderError("targetProduksi")}
        </div>
      </div>

      {selectedRecipe &&
        form.targetProduksi && (
          <div className="mt-6 rounded-xl bg-stone-100 p-4">
            <p className="text-sm text-gray-500">
              Recipe
            </p>

            <p className="mt-1 font-semibold text-gray-800">
              {selectedRecipe.nama}
            </p>

            <p className="mt-4 text-sm text-gray-500">
              Estimasi biaya produksi
            </p>

            <p className="mt-1 text-2xl font-bold text-amber-700">
              {loadingItems ? (
                "Menghitung..."
              ) : (
                <Currency
                  value={estimatedCost}
                />
              )}
            </p>

            <p className="mt-2 text-xs text-gray-500">
              Berdasarkan komposisi recipe dan target produksi.
            </p>
          </div>
        )}

      <div className="mt-6 flex justify-end gap-3">
        <Button onClick={onCancel}>
          Batal
        </Button>

        <Button
          onClick={handleSubmit}
          disabled={
            loadingRecipes ||
            loadingItems
          }
        >
          Simpan Order
        </Button>
      </div>
    </>
  );
}