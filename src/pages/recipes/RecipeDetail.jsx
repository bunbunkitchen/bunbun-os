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
    selectedItem,
    setSelectedItem,
  ] = useState(null);

  const [
    deleteItem,
    setDeleteItem,
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
        setLoading(true);
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

  /*
   * TOTAL HPP RECIPE
   *
   * Calculator sudah menangani:
   * - Bahan baku
   * - Sub-recipe
   */
  const totalCost = useMemo(
    () =>
      calculateRecipeCost(
        ingredients
      ),
    [ingredients]
  );

  /*
   * HPP PER YIELD
   */
  const costPerYield = useMemo(
    () =>
      calculateCostPerYield(
        totalCost,
        recipe?.yield || 0
      ),
    [
      totalCost,
      recipe?.yield,
    ]
  );

  /*
   * ID bahan baku yang sudah
   * digunakan di Recipe.
   */
  const usedIngredientIds =
    useMemo(
      () =>
        ingredients
          .filter(
            (item) =>
              item.ingredientId
          )
          .map(
            (item) =>
              item.ingredientId
          ),
      [ingredients]
    );

  /*
   * ID sub-recipe yang sudah
   * digunakan di Recipe.
   */
  const usedSubRecipeIds =
    useMemo(
      () =>
        ingredients
          .filter(
            (item) =>
              item.subRecipeId
          )
          .map(
            (item) =>
              item.subRecipeId
          ),
      [ingredients]
    );

  function openCreateForm() {
    setSelectedItem(null);
    setFormMode("create");
  }

  function openEditForm(item) {
    setSelectedItem(item);
    setFormMode("edit");
  }

  function closeForm() {
    if (saving) {
      return;
    }

    setSelectedItem(null);
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
        selectedItem
      ) {
        const updatedItem =
          await updateRecipeItem(
            selectedItem.id,
            values
          );

        setIngredients(
          (previous) =>
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
          "Item Recipe berhasil diperbarui."
        );
      } else {
        const savedItem =
          await createRecipeItem({
            ...values,
            recipeId:
              recipe.id,
          });

        setIngredients(
          (previous) =>
            [
              ...previous,
              savedItem,
            ].sort(
              (a, b) =>
                a.urutan -
                b.urutan
            )
        );

        toast.success(
          "Item berhasil ditambahkan ke Recipe."
        );
      }

      setSelectedItem(null);
      setFormMode(null);
    } catch (error) {
      console.error(
        "Gagal menyimpan Item Recipe:",
        error
      );

      const message =
        error.code === "23505"
          ? "Bahan atau Sub-Recipe tersebut sudah ada dalam Recipe."
          : error.message ||
            "Item Recipe gagal disimpan.";

      setPageError(message);
      toast.error(message);

      throw error;
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteItem() {
    if (
      !deleteItem ||
      deleting
    ) {
      return;
    }

    try {
      setDeleting(true);
      setPageError("");

      await softDeleteRecipeItem(
        deleteItem.id
      );

      setIngredients(
        (previous) =>
          previous.filter(
            (item) =>
              item.id !==
              deleteItem.id
          )
      );

      toast.success(
        "Item Recipe berhasil dihapus."
      );

      setDeleteItem(null);
    } catch (error) {
      console.error(
        "Gagal menghapus Item Recipe:",
        error
      );

      const message =
        error.message ||
        "Item Recipe gagal dihapus.";

      setPageError(message);
      toast.error(message);
    } finally {
      setDeleting(false);
    }
  }

  const columns = [
    {
      key: "nama",
      title: "Item",
      render: (item) => {
        if (item.subRecipeId) {
          return (
            <div>
              <p className="font-medium text-gray-800">
                {item.subRecipeKode}{" "}
                —{" "}
                {item.subRecipeNama}
              </p>

              <p className="text-xs text-gray-500">
                Sub-Recipe
              </p>
            </div>
          );
        }

        return (
          <div>
            <p className="font-medium text-gray-800">
              {item.ingredientKode}{" "}
              —{" "}
              {item.ingredientNama}
            </p>

            <p className="text-xs text-gray-500">
              Bahan Baku
            </p>
          </div>
        );
      },
    },

    {
      key: "jumlah",
      title: "Jumlah",
      render: (item) =>
        `${Number(
          item.jumlah || 0
        ).toLocaleString(
          "id-ID"
        )} ${item.satuan}`,
    },

    /*
     * HARGA PER SATUAN
     *
     * Sebelumnya Sub-Recipe
     * ditampilkan sebagai "—".
     *
     * Sekarang kita tampilkan
     * nilai yang diberikan oleh
     * recipe item.
     */
    {
      key: "hargaPerSatuan",
      title: "Harga per Satuan",
      render: (item) => (
        <Currency
          value={
            Number(
              item.hargaPerSatuan ||
                0
            )
          }
        />
      ),
    },

    /*
     * SUBTOTAL
     *
     * Sebelumnya Sub-Recipe
     * ditampilkan sebagai "—".
     *
     * Sekarang semua item
     * menggunakan:
     *
     * jumlah × hargaPerSatuan
     */
    {
      key: "subtotal",
      title: "Subtotal",
      render: (item) => (
        <Currency
          value={
            Number(
              item.jumlah || 0
            ) *
            Number(
              item.hargaPerSatuan ||
                0
            )
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
              saving ||
              deleting
            }
            className="bg-blue-600 hover:bg-blue-700"
          >
            Edit
          </Button>

          <Button
            onClick={() =>
              setDeleteItem(item)
            }
            disabled={
              saving ||
              deleting
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
      <LoadingState
        message="Memuat detail Recipe..."
      />
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
          yieldQty={
            recipe.yield
          }
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
            onClick={
              openCreateForm
            }
            disabled={
              saving ||
              deleting
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
              selectedItem?.id ||
              formMode
            }
            recipeId={
              recipe.id
            }
            initialData={
              formMode === "edit"
                ? selectedItem
                : null
            }
            usedIngredientIds={
              usedIngredientIds
            }
            usedSubRecipeIds={
              usedSubRecipeIds
            }
            nextOrder={
              ingredients.length +
              1
            }
            onSave={
              handleSaveIngredient
            }
            onCancel={
              closeForm
            }
            saving={saving}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(
          deleteItem
        )}
        title="Hapus Item Recipe"
        message={`Apakah Anda yakin ingin menghapus ${
          deleteItem?.subRecipeId
            ? deleteItem?.subRecipeNama ||
              "Sub-Recipe ini"
            : deleteItem?.ingredientNama ||
              "bahan ini"
        } dari Recipe? Total HPP akan dihitung ulang otomatis.`}
        confirmText="Ya, Hapus"
        loading={deleting}
        onConfirm={
          handleDeleteItem
        }
        onCancel={() => {
          if (!deleting) {
            setDeleteItem(null);
          }
        }}
      />
    </div>
  );
}