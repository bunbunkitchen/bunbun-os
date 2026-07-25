import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  useParams,
} from "react-router-dom";

import PageTitle from "../../components/ui/PageTitle";
import Card from "../../components/ui/Card";
import DataTable from "../../components/ui/DataTable";
import Currency from "../../components/ui/Currency";
import Button from "../../components/ui/Button";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import Modal from "../../components/modal/Modal";
import LoadingState from "../../components/ui/LoadingState";

import RecipeCostSummary from "../../components/recipe/RecipeCostSummary";
import RecipeIngredientForm from "../../components/forms/RecipeIngredientForm";

import {
  createRecipeItem,
  getRecipeByCode,
  getRecipeItems,
  softDeleteRecipeItem,
  updateRecipeItem,
} from "../../services/recipeService";

import {
  calculateRecipeCost,
  calculateCostPerYield,
} from "../../utils/recipeCalculator";

import {
  useToast,
} from "../../context/ToastContext";

export default function RecipeDetail() {
  const { recipeKode } =
    useParams();

  const toast = useToast();

  const [recipe, setRecipe] =
    useState(null);

  const [
    ingredients,
    setIngredients,
  ] = useState([]);

  const [formMode, setFormMode] =
    useState(null);

  const [
    selectedIngredient,
    setSelectedIngredient,
  ] = useState(null);

  const [
    deleteIngredient,
    setDeleteIngredient,
  ] = useState(null);

  const [saving, setSaving] =
    useState(false);

  const [deleting, setDeleting] =
    useState(false);

  const [loading, setLoading] =
    useState(true);

  const [pageError, setPageError] =
    useState("");

  useEffect(() => {
    async function loadRecipeDetail() {
      try {
        setPageError("");

        const recipeData =
          await getRecipeByCode(
            recipeKode
          );

        const recipeItems =
          await getRecipeItems(
            recipeData.id
          );

        setRecipe(recipeData);
        setIngredients(recipeItems);
      } catch (error) {
        console.error(
          "Gagal memuat detail Recipe:",
          error
        );

        setPageError(
          error.message ||
            "Detail Recipe gagal dimuat."
        );
      } finally {
        setLoading(false);
      }
    }

    loadRecipeDetail();
  }, [recipeKode]);

  const totalCost = useMemo(
    () =>
      calculateRecipeCost(
        ingredients
      ),
    [ingredients]
  );

  const costPerYield = useMemo(
    () =>
      calculateCostPerYield(
        totalCost,
        recipe?.yield || 0
      ),
    [
      totalCost,
      recipe,
    ]
  );

  const usedIngredientIds =
    useMemo(
      () =>
        ingredients.map(
          (item) =>
            item.ingredientId
        ),
      [ingredients]
    );

  function openCreateForm() {
    setSelectedIngredient(null);
    setFormMode("create");
  }

  function openEditForm(item) {
    setSelectedIngredient(item);
    setFormMode("edit");
  }

  function closeForm() {
    if (saving) {
      return;
    }

    setSelectedIngredient(null);
    setFormMode(null);
  }

  async function handleSaveIngredient(
    values
  ) {
    if (!recipe || saving) {
      return;
    }

    try {
      setSaving(true);
      setPageError("");

      if (
        formMode === "edit" &&
        selectedIngredient
      ) {
        const updatedItem =
          await updateRecipeItem(
            selectedIngredient.id,
            values
          );

        setIngredients((previous) =>
          previous
            .map((item) =>
              item.id ===
              updatedItem.id
                ? updatedItem
                : item
            )
            .sort(
              (a, b) =>
                a.urutan -
                b.urutan
            )
        );

        toast.success(
          "Bahan Recipe berhasil diperbarui."
        );
      } else {
        const savedItem =
          await createRecipeItem({
            ...values,
            recipeId: recipe.id,
          });

        setIngredients((previous) =>
          [...previous, savedItem].sort(
            (a, b) =>
              a.urutan -
              b.urutan
          )
        );

        toast.success(
          "Bahan berhasil ditambahkan ke Recipe."
        );
      }

      setSelectedIngredient(null);
      setFormMode(null);
    } catch (error) {
      console.error(
        "Gagal menyimpan bahan Recipe:",
        error
      );

      const message =
        error.code === "23505"
          ? "Bahan tersebut sudah ada dalam Recipe."
          : error.message ||
            "Bahan Recipe gagal disimpan.";

      setPageError(message);
      toast.error(message);

      throw error;
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteIngredient() {
    if (
      !deleteIngredient ||
      deleting
    ) {
      return;
    }

    try {
      setDeleting(true);
      setPageError("");

      await softDeleteRecipeItem(
        deleteIngredient.id
      );

      setIngredients((previous) =>
        previous.filter(
          (item) =>
            item.id !==
            deleteIngredient.id
        )
      );

      toast.success(
        "Bahan Recipe berhasil dihapus."
      );

      setDeleteIngredient(null);
    } catch (error) {
      console.error(
        "Gagal menghapus bahan Recipe:",
        error
      );

      const message =
        error.message ||
        "Bahan Recipe gagal dihapus.";

      setPageError(message);
      toast.error(message);
    } finally {
      setDeleting(false);
    }
  }

  const columns = [
    {
      key: "ingredientNama",
      title: "Bahan",
      render: (item) =>
        `${item.ingredientKode} — ${item.ingredientNama}`,
    },
    {
      key: "jumlah",
      title: "Jumlah",
      render: (item) =>
        `${item.jumlah.toLocaleString(
          "id-ID"
        )} ${item.satuan}`,
    },
    {
      key: "hargaPerSatuan",
      title: "Harga per Satuan",
      render: (item) => (
        <Currency
          value={
            item.hargaPerSatuan
          }
        />
      ),
    },
    {
      key: "subtotal",
      title: "Subtotal",
      render: (item) => (
        <Currency
          value={
            item.jumlah *
            item.hargaPerSatuan
          }
        />
      ),
    },
    {
      key: "aksi",
      title: "Aksi",
      render: (item) => (
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() =>
              openEditForm(item)
            }
            disabled={
              saving || deleting
            }
            className="bg-blue-600 hover:bg-blue-700"
          >
            Edit
          </Button>

          <Button
            onClick={() =>
              setDeleteIngredient(
                item
              )
            }
            disabled={
              saving || deleting
            }
            className="bg-red-600 hover:bg-red-700"
          >
            Hapus
          </Button>
        </div>
      ),
    },
  ];

  if (loading) {
    return (
      <LoadingState message="Memuat detail Recipe..." />
    );
  }

  if (!recipe) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">
        {pageError ||
          "Recipe tidak ditemukan."}
      </div>
    );
  }

  return (
    <div>
      <PageTitle
        title={recipe.nama}
        subtitle={`${recipe.kode} · ${
          recipe.productNama ||
          recipe.kategori ||
          "Belum terhubung ke produk"
        }`}
      />

      {pageError && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
          {pageError}
        </div>
      )}

      <div className="mb-6">
        <RecipeCostSummary
          totalCost={totalCost}
          yieldQty={recipe.yield}
          yieldUnit={
            recipe.satuanYield
          }
          costPerYield={
            costPerYield
          }
        />
      </div>

      <Card>
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-800">
              Komposisi Bahan
            </h2>

            <p className="mt-1 text-sm text-gray-500">
              Daftar bahan dan biaya untuk satu batch Recipe
            </p>
          </div>

          <Button
            onClick={openCreateForm}
            disabled={
              saving || deleting
            }
          >
            + Tambah Bahan
          </Button>
        </div>

        <DataTable
          columns={columns}
          data={ingredients}
          emptyMessage="Belum ada bahan pada Recipe ini"
        />
      </Card>

      <Modal
        open={Boolean(formMode)}
        onClose={closeForm}
      >
        {formMode && (
          <RecipeIngredientForm
            key={
              selectedIngredient?.id ||
              formMode
            }
            recipeId={recipe.id}
            initialData={
              formMode === "edit"
                ? selectedIngredient
                : null
            }
            usedIngredientIds={
              usedIngredientIds
            }
            nextOrder={
              ingredients.length + 1
            }
            onSave={
              handleSaveIngredient
            }
            onCancel={closeForm}
            saving={saving}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(
          deleteIngredient
        )}
        title="Hapus Bahan Recipe"
        message={`Apakah Anda yakin ingin menghapus ${
          deleteIngredient?.ingredientNama ||
          "bahan ini"
        } dari Recipe? Total HPP akan dihitung ulang otomatis.`}
        confirmText="Ya, Hapus"
        loading={deleting}
        onConfirm={
          handleDeleteIngredient
        }
        onCancel={() => {
          if (!deleting) {
            setDeleteIngredient(null);
          }
        }}
      />
    </div>
  );
}