import { useCallback, useEffect, useState } from "react";

import FrozenReleaseForm from "../../components/forms/FrozenReleaseForm";
import FinishedProductReleaseForm from "../../components/forms/FinishedProductReleaseForm";
import ProductionResultForm from "../../components/forms/ProductionResultForm";
import Modal from "../../components/modal/Modal";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import LoadingState from "../../components/ui/LoadingState";
import PageTitle from "../../components/ui/PageTitle";
import StatusBadge from "../../components/ui/StatusBadge";
import { useToast } from "../../context/ToastContext";
import {
  getAvailableFrozenLots,
  getFinishedProductBalances,
  getFrozenProcessingSplits,
  getProductStockErrorMessage,
  recordMultiProductRelease,
} from "../../services/productStockService";
import { getFrozenProductBalances } from "../../services/frozenStockService";
import {
  recordBakingResult,
  releaseFrozenStockForProofing,
} from "../../services/productionService";

function getLocalDate() {
  const now = new Date();
  const timezoneOffset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - timezoneOffset).toISOString().slice(0, 10);
}

export default function ProductStock() {
  const toast = useToast();
  const [frozenLots, setFrozenLots] = useState([]);
  const [frozenBalances, setFrozenBalances] = useState([]);
  const [processingSplits, setProcessingSplits] = useState([]);
  const [finishedBalances, setFinishedBalances] = useState([]);
  const [releaseLot, setReleaseLot] = useState(null);
  const [bakingSplit, setBakingSplit] = useState(null);
  const [showFinishedRelease, setShowFinishedRelease] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");

  const loadData = useCallback(async () => {
    const [lots, frozen, processing, finished] = await Promise.all([
      getAvailableFrozenLots(),
      getFrozenProductBalances(),
      getFrozenProcessingSplits(),
      getFinishedProductBalances(),
    ]);
    setFrozenLots(lots);
    setFrozenBalances(frozen);
    setProcessingSplits(processing);
    setFinishedBalances(finished.filter((item) => item.saldo !== 0));
  }, []);

  useEffect(() => {
    loadData()
      .catch((error) => setPageError(getProductStockErrorMessage(error)))
      .finally(() => setLoading(false));
  }, [loadData]);

  async function handleRelease(values) {
    try {
      await releaseFrozenStockForProofing({
        frozenSplitId: releaseLot.lotId,
        qty: values.qty,
        movementDate: values.movementDate || getLocalDate(),
        operationKey: values.operationKey,
      });
      await loadData();
      setReleaseLot(null);
      toast.success("Frozen berhasil dikeluarkan ke proofing.");
    } catch (error) {
      const message = getProductStockErrorMessage(error);
      setPageError(message);
      toast.error(message);
    }
  }

  async function handleBaking(values) {
    try {
      await recordBakingResult({
        directSplitId: bakingSplit.id,
        bakedGoodQty: values.goodQty,
        bakedRejectQty: values.rejectQty,
        movementDate: values.movementDate || getLocalDate(),
        operationKey: values.operationKey,
      });
      await loadData();
      setBakingSplit(null);
      toast.success("Hasil baking tersimpan dan stok produk jadi bertambah.");
    } catch (error) {
      const message = getProductStockErrorMessage(error);
      setPageError(message);
      toast.error(message);
    }
  }

  async function handleFinishedRelease(values) {
    try {
      await recordMultiProductRelease({
        movementDate: values.movementDate || getLocalDate(),
        destination: values.destination,
        notes: values.notes,
        items: values.items,
        operationKey: values.operationKey,
      });
      await loadData();
      setShowFinishedRelease(false);
      toast.success(`${values.items.length} jenis produk berhasil dikeluarkan.`);
    } catch (error) {
      const message = getProductStockErrorMessage(error);
      setPageError(message);
      toast.error(message);
    }
  }

  if (loading) return <LoadingState message="Memuat stok produk..." />;

  return (
    <div>
      <PageTitle
        title="Stok Produk"
        subtitle="Kelola stok frozen, proses proofing, dan produk jadi"
      />

      {pageError && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
          {pageError}
        </div>
      )}

      <section className="mb-8">
        <div className="mb-4">
          <h2 className="text-xl font-bold text-gray-900">Stok Frozen</h2>
          <p className="mt-1 text-sm text-gray-500">Saldo total setiap jenis frozen yang tersedia.</p>
        </div>

        {!frozenBalances.length ? (
          <Card><p className="py-6 text-center text-gray-500">Belum ada stok frozen.</p></Card>
        ) : (
          <Card>
            <div className="divide-y divide-gray-100">
              {frozenBalances.map((item) => (
                <div key={item.productId} className="flex items-center justify-between gap-4 py-4 first:pt-1 last:pb-1">
                  <div className="min-w-0">
                    <p className="text-xs text-gray-500">{item.productSku || "Produk"}</p>
                    <p className="font-semibold text-gray-900">{item.productNama}</p>
                  </div>
                  <p className="shrink-0 text-lg font-bold text-amber-700">{item.saldo} pcs</p>
                </div>
              ))}
            </div>
          </Card>
        )}

        {frozenLots.length > 0 && (
          <div className="mt-4 flex justify-end">
            <p className="text-xs text-gray-500">Pengeluaran frozen tetap dilakukan berdasarkan lot untuk menjaga traceability.</p>
          </div>
        )}
      </section>

      <section className="mb-8">
        <h2 className="mb-4 text-xl font-bold text-gray-900">Sedang Proofing</h2>
        {!processingSplits.length ? (
          <Card><p className="py-6 text-center text-gray-500">Tidak ada frozen yang sedang diproses.</p></Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {processingSplits.map((split) => (
              <Card key={split.id}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-bold text-gray-900">{split.productNama}</h3>
                    <p className="mt-1 text-sm text-gray-500">Lot {split.sourceLotCode || split.lotCode}</p>
                    <p className="mt-3 font-semibold">{split.qty} pcs</p>
                  </div>
                  <StatusBadge status={split.status} />
                </div>
                <div className="mt-5 flex justify-end">
                  <Button onClick={() => setBakingSplit(split)}>Catat Hasil Baking</Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Stok Produk Jadi</h2>
            <p className="mt-1 text-sm text-gray-500">Saldo total setiap jenis produk yang tersedia.</p>
          </div>
          <Button onClick={() => setShowFinishedRelease(true)} disabled={!finishedBalances.length}>
            Keluarkan Produk
          </Button>
        </div>

        {!finishedBalances.length ? (
          <Card><p className="py-6 text-center text-gray-500">Belum ada stok produk jadi.</p></Card>
        ) : (
          <Card>
            <div className="divide-y divide-gray-100">
              {finishedBalances.map((item) => (
                <div key={item.productId} className="flex items-center justify-between gap-4 py-4 first:pt-1 last:pb-1">
                  <div className="min-w-0">
                    <p className="text-xs text-gray-500">{item.productSku || "Produk"}</p>
                    <p className="font-semibold text-gray-900">{item.productNama}</p>
                  </div>
                  <p className="shrink-0 text-lg font-bold text-green-700">{item.saldo} pcs</p>
                </div>
              ))}
            </div>
          </Card>
        )}
      </section>

      <Modal open={Boolean(releaseLot)} onClose={() => setReleaseLot(null)}>
        {releaseLot && <FrozenReleaseForm lot={releaseLot} onSave={handleRelease} onCancel={() => setReleaseLot(null)} />}
      </Modal>
      <Modal open={Boolean(bakingSplit)} onClose={() => setBakingSplit(null)}>
        {bakingSplit && <ProductionResultForm split={bakingSplit} onSave={handleBaking} onCancel={() => setBakingSplit(null)} />}
      </Modal>
      <Modal open={showFinishedRelease} onClose={() => setShowFinishedRelease(false)}>
        <FinishedProductReleaseForm
          products={finishedBalances}
          onSave={handleFinishedRelease}
          onCancel={() => setShowFinishedRelease(false)}
        />
      </Modal>
    </div>
  );
}
