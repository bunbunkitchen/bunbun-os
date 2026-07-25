import {
  useEffect,
  useState,
} from "react";

import PageTitle from "../../components/ui/PageTitle";
import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import StatusBadge from "../../components/ui/StatusBadge";
import Modal from "../../components/modal/Modal";
import LoadingState from "../../components/ui/LoadingState";

import ProductionResultForm from "../../components/forms/ProductionResultForm";

import {
  getAllProductionBatches,
  updateProductionBatch,
} from "../../services/productionService";

import {
  getRecipeItems,
} from "../../services/recipeService";

import {
  createProductionInMovement,
  createProductionOutMovements,
} from "../../services/inventoryService";

import {
  scaleRecipeIngredients,
} from "../../utils/productionCalculator";

import {
  useToast,
} from "../../context/ToastContext";

const stages = [
  "Waiting",
  "Mixing",
  "Proofing",
  "Baking",
  "Cooling",
  "Packing",
  "Finished",
];

export default function ProductionBatches() {
  const toast = useToast();

  const [batches, setBatches] =
    useState([]);

  const [
    selectedBatch,
    setSelectedBatch,
  ] = useState(null);

  const [loading, setLoading] =
    useState(true);

  const [
    processingId,
    setProcessingId,
  ] = useState(null);

  const [pageError, setPageError] =
    useState("");

  useEffect(() => {
    async function loadBatches() {
      try {
        setPageError("");

        const data =
          await getAllProductionBatches();

        setBatches(data);
      } catch (error) {
        console.error(
          "Gagal memuat production batch:",
          error
        );

        setPageError(
          error.message ||
            "Production batch gagal dimuat."
        );
      } finally {
        setLoading(false);
      }
    }

    loadBatches();
  }, []);

  async function createInventoryConsumption(
    batch
  ) {
    if (batch.inventoryConsumed) {
      return;
    }

    if (!batch.recipeId) {
      throw new Error(
        "Recipe pada batch tidak ditemukan."
      );
    }

    if (!batch.recipeYield) {
      throw new Error(
        "Yield Recipe belum valid."
      );
    }

    const recipeItems =
      await getRecipeItems(
        batch.recipeId
      );

    if (recipeItems.length === 0) {
      throw new Error(
        "Recipe belum mempunyai komposisi bahan."
      );
    }

    const scaledIngredients =
      scaleRecipeIngredients(
        recipeItems,
        batch.recipeYield,
        batch.target
      );

    await createProductionOutMovements({
      tanggal: batch.tanggal,
      productionBatchId: batch.id,
      recipeId: batch.recipeId,
      ingredients:
        scaledIngredients,
    });
  }

  async function createFinishedGoods(
    batch
  ) {
    if (!batch.recipeId) {
      throw new Error(
        "Recipe pada batch tidak ditemukan."
      );
    }

    if (
      Number(batch.selesai) <= 0
    ) {
      throw new Error(
        "Input jumlah hasil produksi sebelum menyelesaikan batch."
      );
    }

    await createProductionInMovement({
      tanggal: batch.tanggal,
      productionBatchId: batch.id,
      recipeId: batch.recipeId,
      finishedQty:
        Number(batch.selesai),
    });
  }

  async function handleNextStage(
    batch
  ) {
    const currentIndex =
      stages.indexOf(batch.status);

    if (
      currentIndex === -1 ||
      currentIndex ===
        stages.length - 1
    ) {
      return;
    }

    const nextStatus =
      stages[currentIndex + 1];

    try {
      setPageError("");
      setProcessingId(batch.id);

      let inventoryConsumed =
        batch.inventoryConsumed;

      if (
        batch.status === "Waiting" &&
        nextStatus === "Mixing" &&
        !batch.inventoryConsumed
      ) {
        await createInventoryConsumption(
          batch
        );

        inventoryConsumed = true;
      }

      if (
        nextStatus === "Finished"
      ) {
        await createFinishedGoods(
          batch
        );
      }

      const updatedBatch =
        await updateProductionBatch(
          batch.id,
          {
            selesai:
              batch.selesai,
            reject:
              batch.reject,
            status: nextStatus,
            inventoryConsumed,
          }
        );

      setBatches((previous) =>
        previous.map((item) =>
          item.id ===
          updatedBatch.id
            ? updatedBatch
            : item
        )
      );

      if (
        nextStatus === "Mixing"
      ) {
        toast.success(
          "Produksi dimulai dan pemakaian bahan berhasil dicatat."
        );
      } else if (
        nextStatus === "Finished"
      ) {
        toast.success(
          "Batch selesai dan hasil produksi berhasil dicatat."
        );
      } else {
        toast.success(
          `Tahap batch berubah menjadi ${nextStatus}.`
        );
      }
    } catch (error) {
      console.error(
        "Gagal memperbarui tahap batch:",
        error
      );

      const message =
        error.message ||
        "Tahap produksi gagal diperbarui.";

      setPageError(message);
      toast.error(message);
    } finally {
      setProcessingId(null);
    }
  }

  async function handleSaveResult(
    result
  ) {
    if (!selectedBatch) {
      return;
    }

    try {
      setPageError("");

      const updatedBatch =
        await updateProductionBatch(
          selectedBatch.id,
          {
            selesai:
              result.selesai,
            reject:
              result.reject,
            status:
              selectedBatch.status,
            inventoryConsumed:
              selectedBatch.inventoryConsumed,
          }
        );

      setBatches((previous) =>
        previous.map((item) =>
          item.id ===
          updatedBatch.id
            ? updatedBatch
            : item
        )
      );

      setSelectedBatch(null);

      toast.success(
        "Hasil produksi berhasil disimpan."
      );
    } catch (error) {
      console.error(
        "Gagal menyimpan hasil produksi:",
        error
      );

      const message =
        error.message ||
        "Hasil produksi gagal disimpan.";

      setPageError(message);
      toast.error(message);
    }
  }

  if (loading) {
    return (
      <LoadingState message="Memuat production batch..." />
    );
  }

  return (
    <div>
      <PageTitle
        title="Production Batch"
        subtitle="Pantau progres produksi setiap batch"
      />

      {pageError && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
          {pageError}
        </div>
      )}

      {batches.length === 0 ? (
        <Card>
          <p className="py-10 text-center text-gray-500">
            Belum ada production batch.
          </p>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {batches.map((batch) => {
            const isFinished =
              batch.status ===
              "Finished";

            const isProcessing =
              processingId ===
              batch.id;

            return (
              <Card key={batch.id}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm text-gray-500">
                      Batch
                    </p>

                    <h2 className="mt-1 text-xl font-bold text-gray-900">
                      {batch.kode}
                    </h2>

                    {batch.productionOrderKode && (
                      <p className="mt-1 text-xs text-gray-500">
                        Order:{" "}
                        {
                          batch.productionOrderKode
                        }
                      </p>
                    )}
                  </div>

                  <StatusBadge
                    status={
                      batch.status
                    }
                  />
                </div>

                <div className="mt-6 grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-500">
                      Recipe
                    </p>

                    <p className="mt-1 font-semibold text-gray-800">
                      {batch.recipe ||
                        "-"}
                    </p>
                  </div>

                  <div>
                    <p className="text-sm text-gray-500">
                      Target
                    </p>

                    <p className="mt-1 font-semibold text-gray-800">
                      {batch.target} pcs
                    </p>
                  </div>

                  <div>
                    <p className="text-sm text-gray-500">
                      Selesai
                    </p>

                    <p className="mt-1 font-semibold text-gray-800">
                      {batch.selesai} pcs
                    </p>
                  </div>

                  <div>
                    <p className="text-sm text-gray-500">
                      Reject
                    </p>

                    <p className="mt-1 font-semibold text-gray-800">
                      {batch.reject} pcs
                    </p>
                  </div>
                </div>

                <div className="mt-5 rounded-lg bg-stone-100 p-3 text-sm">
                  <span className="text-gray-500">
                    Pemakaian bahan:
                  </span>{" "}
                  <span
                    className={
                      batch.inventoryConsumed
                        ? "font-semibold text-green-700"
                        : "font-semibold text-amber-700"
                    }
                  >
                    {batch.inventoryConsumed
                      ? "Sudah dicatat"
                      : "Belum dicatat"}
                  </span>
                </div>

                <div className="mt-6">
                  <p className="mb-3 text-sm text-gray-500">
                    Tahap Produksi
                  </p>

                  <div className="flex flex-wrap gap-2">
                    {stages.map(
                      (stage) => {
                        const currentStageIndex =
                          stages.indexOf(
                            batch.status
                          );

                        const stageIndex =
                          stages.indexOf(
                            stage
                          );

                        const isCompleted =
                          stageIndex <
                          currentStageIndex;

                        const isCurrent =
                          stage ===
                          batch.status;

                        return (
                          <span
                            key={stage}
                            className={`rounded-full px-3 py-1 text-xs font-semibold ${
                              isCurrent
                                ? "bg-amber-700 text-white"
                                : isCompleted
                                ? "bg-green-100 text-green-700"
                                : "bg-gray-100 text-gray-500"
                            }`}
                          >
                            {stage}
                          </span>
                        );
                      }
                    )}
                  </div>
                </div>

                <div className="mt-6 flex flex-wrap justify-end gap-3">
                  <Button
                    onClick={() =>
                      setSelectedBatch(
                        batch
                      )
                    }
                    disabled={
                      isProcessing ||
                      isFinished
                    }
                  >
                    Input Hasil
                  </Button>

                  <Button
                    onClick={() =>
                      handleNextStage(
                        batch
                      )
                    }
                    disabled={
                      isFinished ||
                      isProcessing
                    }
                  >
                    {isProcessing
                      ? "Memproses..."
                      : isFinished
                      ? "Selesai"
                      : "Next Stage"}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        open={Boolean(
          selectedBatch
        )}
        onClose={() =>
          setSelectedBatch(null)
        }
      >
        {selectedBatch && (
          <ProductionResultForm
            batch={selectedBatch}
            onSave={
              handleSaveResult
            }
            onCancel={() =>
              setSelectedBatch(null)
            }
          />
        )}
      </Modal>
    </div>
  );
}