import { useCallback, useEffect, useState } from "react";

import BatchSplitForm from "../../components/forms/BatchSplitForm";
import ProductionResultForm from "../../components/forms/ProductionResultForm";
import Modal from "../../components/modal/Modal";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import LoadingState from "../../components/ui/LoadingState";
import PageTitle from "../../components/ui/PageTitle";
import StatusBadge from "../../components/ui/StatusBadge";
import { useToast } from "../../context/ToastContext";
import { createProductionOutMovements } from "../../services/inventoryService";
import { getAllIngredients } from "../../services/ingredientService";
import { getProductionBatchSplits, getProductStockErrorMessage } from "../../services/productStockService";
import {
  getAllProductionBatches,
  recordBakingResult,
  recordShapingSplit,
  updateProductionBatch,
} from "../../services/productionService";
import { getRecipeItems } from "../../services/recipeService";
import { scaleRecipeIngredients } from "../../utils/productionCalculator";

const stages = ["Waiting", "Mixing", "Shaping", "Split"];
const routeLabels = { FROZEN: "Frozen", DIRECT: "Lanjut langsung", REJECT: "Reject" };

function getLocalDate() {
  const now = new Date();
  const timezoneOffset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - timezoneOffset).toISOString().slice(0, 10);
}

export default function ProductionBatches() {
  const toast = useToast();
  const [batches, setBatches] = useState([]);
  const [splitsByBatch, setSplitsByBatch] = useState({});
  const [splitBatch, setSplitBatch] = useState(null);
  const [bakingSplit, setBakingSplit] = useState(null);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState(null);
  const [pageError, setPageError] = useState("");

  const loadData = useCallback(async () => {
    const batchData = await getAllProductionBatches();
    const splitEntries = await Promise.all(
      batchData.map(async (batch) => [batch.id, await getProductionBatchSplits(batch.id)])
    );
    setBatches(batchData);
    setSplitsByBatch(Object.fromEntries(splitEntries));
  }, []);

  useEffect(() => {
    loadData()
      .catch((error) => setPageError(error.message || "Production batch gagal dimuat."))
      .finally(() => setLoading(false));
  }, [loadData]);

  async function createInventoryConsumption(batch) {
    if (batch.inventoryConsumed) return;
    if (!batch.recipeId || !batch.recipeYield) {
      throw new Error("Recipe atau yield pada batch belum valid.");
    }

    const recipeItems = await getRecipeItems(batch.recipeId);
    if (!recipeItems.length) throw new Error("Recipe belum mempunyai komposisi bahan.");

    const ingredients = await getAllIngredients();
    const ingredientByName = new Map(
      ingredients.map((ingredient) => [
        ingredient.nama.trim().toLowerCase(),
        ingredient,
      ])
    );

    const resolvedItems = recipeItems.map((item) => {
      if (!item.subRecipeId) {
        return item;
      }

      const subRecipeName = String(item.subRecipeNama || "").trim();
      const linkedIngredient = ingredientByName.get(
        subRecipeName.toLowerCase()
      );

      if (!linkedIngredient) {
        throw new Error(
          `Sub-recipe ${subRecipeName || "tanpa nama"} belum memiliki bahan inventory dengan nama yang sama.`
        );
      }

      return {
        ...item,
        ingredientId: linkedIngredient.id,
        ingredientNama: linkedIngredient.nama,
      };
    });

    await createProductionOutMovements({
      tanggal: batch.tanggal,
      productionBatchId: batch.id,
      recipeId: batch.recipeId,
      ingredients: scaleRecipeIngredients(
        resolvedItems,
        batch.recipeYield,
        batch.target
      ),
    });
  }

  async function handleNextStage(batch) {
    const nextStatus = batch.status === "Waiting" ? "Mixing" : batch.status === "Mixing" ? "Shaping" : null;
    if (!nextStatus) return;
    try {
      setProcessingId(batch.id);
      setPageError("");
      let inventoryConsumed = batch.inventoryConsumed;
      if (nextStatus === "Mixing" && !inventoryConsumed) {
        await createInventoryConsumption(batch);
        inventoryConsumed = true;
      }
      await updateProductionBatch(batch.id, {
        selesai: batch.selesai,
        reject: batch.reject,
        status: nextStatus,
        inventoryConsumed,
      });
      await loadData();
      toast.success(nextStatus === "Mixing"
        ? "Produksi dimulai dan pemakaian bahan berhasil dicatat."
        : "Batch siap dicatat hasil shaping-nya.");
    } catch (error) {
      const message = error.message || "Tahap produksi gagal diperbarui.";
      setPageError(message);
      toast.error(message);
    } finally {
      setProcessingId(null);
    }
  }

  async function handleSaveSplit(values) {
    try {
      await recordShapingSplit({
        productionBatchId: splitBatch.id,
        productId: splitBatch.productId,
        frozenQty: values.frozen,
        directQty: values.direct,
        rejectQty: values.reject,
        frozenLotCode: values.frozenLotCode,
        movementDate: splitBatch.tanggal,
        operationKey: values.operationKey,
      });
      await loadData();
      setSplitBatch(null);
      toast.success("Hasil shaping berhasil dibagi.");
    } catch (error) {
      const message = getProductStockErrorMessage(error);
      setPageError(message);
      toast.error(message);
    }
  }

  async function handleSaveBaking(values) {
    try {
      await recordBakingResult({
        directSplitId: bakingSplit.id,
        bakedGoodQty: values.goodQty,
        bakedRejectQty: values.rejectQty,
        movementDate: getLocalDate(),
        operationKey: values.operationKey,
      });
      await loadData();
      setBakingSplit(null);
      toast.success("Hasil baking berhasil dicatat dan stok produk jadi bertambah.");
    } catch (error) {
      const message = getProductStockErrorMessage(error);
      setPageError(message);
      toast.error(message);
    }
  }

  if (loading) return <LoadingState message="Memuat production batch..." />;

  return (
    <div>
      <PageTitle title="Production Batch" subtitle="Pantau shaping, frozen, proofing, dan baking setiap batch" />
      {pageError && <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">{pageError}</div>}

      {!batches.length ? (
        <Card><p className="py-10 text-center text-gray-500">Belum ada production batch.</p></Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {batches.map((batch) => {
            const splits = splitsByBatch[batch.id] || [];
            const isProcessing = processingId === batch.id;
            return (
              <Card key={batch.id}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm text-gray-500">Batch</p>
                    <h2 className="mt-1 text-xl font-bold text-gray-900">{batch.kode}</h2>
                    {batch.productionOrderKode && <p className="mt-1 text-xs text-gray-500">Order: {batch.productionOrderKode}</p>}
                  </div>
                  <StatusBadge status={batch.status} />
                </div>

                <div className="mt-6 grid grid-cols-2 gap-4 text-sm">
                  <div><p className="text-gray-500">Recipe</p><p className="mt-1 font-semibold">{batch.recipe || "-"}</p></div>
                  <div><p className="text-gray-500">Target</p><p className="mt-1 font-semibold">{batch.target} pcs</p></div>
                  <div><p className="text-gray-500">Berhasil</p><p className="mt-1 font-semibold">{batch.selesai} pcs</p></div>
                  <div><p className="text-gray-500">Reject</p><p className="mt-1 font-semibold">{batch.reject} pcs</p></div>
                </div>

                {stages.includes(batch.status) && (
                  <div className="mt-6">
                    <p className="mb-3 text-sm text-gray-500">Tahap Produksi</p>
                    <div className="flex flex-wrap gap-2">
                      {stages.map((stage) => {
                        const current = stages.indexOf(batch.status);
                        const index = stages.indexOf(stage);
                        return <span key={stage} className={`rounded-full px-3 py-1 text-xs font-semibold ${index === current ? "bg-amber-700 text-white" : index < current ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>{stage}</span>;
                      })}
                    </div>
                  </div>
                )}

                {splits.length > 0 && (
                  <div className="mt-6 space-y-3">
                    <p className="text-sm font-semibold text-gray-700">Pecahan Batch</p>
                    {splits.map((split) => (
                      <div key={split.id} className="rounded-xl border border-stone-200 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold">{routeLabels[split.route] || split.route} · {split.qty} pcs</p>
                            {(split.lotCode || split.sourceLotCode) && <p className="mt-1 text-xs text-gray-500">Lot: {split.lotCode || split.sourceLotCode}</p>}
                            {split.status === "BAKED" && <p className="mt-1 text-xs text-gray-500">Berhasil {split.bakedGoodQty} · Reject {split.bakedRejectQty}</p>}
                          </div>
                          <StatusBadge status={split.status} />
                        </div>
                        {split.route === "DIRECT" && ["PROOFING", "BAKING"].includes(split.status) && (
                          <div className="mt-3 flex justify-end">
                            <Button onClick={() => setBakingSplit(split)}>Catat Hasil Baking</Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-6 flex justify-end gap-3">
                  {batch.status === "Shaping" && (
                    <Button onClick={() => setSplitBatch(batch)} disabled={!batch.productId}>Catat Hasil Shaping</Button>
                  )}
                  {["Waiting", "Mixing"].includes(batch.status) && (
                    <Button onClick={() => handleNextStage(batch)} disabled={isProcessing}>
                      {isProcessing ? "Memproses..." : batch.status === "Waiting" ? "Mulai Mixing" : "Lanjut Shaping"}
                    </Button>
                  )}
                </div>
                {batch.status === "Shaping" && !batch.productId && <p className="mt-3 text-sm text-red-600">Produk pada recipe belum terhubung.</p>}
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={Boolean(splitBatch)} onClose={() => setSplitBatch(null)}>
        {splitBatch && <BatchSplitForm batch={splitBatch} onSave={handleSaveSplit} onCancel={() => setSplitBatch(null)} />}
      </Modal>
      <Modal open={Boolean(bakingSplit)} onClose={() => setBakingSplit(null)}>
        {bakingSplit && <ProductionResultForm split={bakingSplit} onSave={handleSaveBaking} onCancel={() => setBakingSplit(null)} />}
      </Modal>
    </div>
  );
}
