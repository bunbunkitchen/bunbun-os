import Card from "../ui/Card";
import Currency from "../ui/Currency";

function RejectBadge({ rate = 0 }) {
  let color =
    "text-green-700 bg-green-100";

  if (rate >= 5) {
    color =
      "text-red-700 bg-red-100";
  } else if (rate >= 2) {
    color =
      "text-amber-700 bg-amber-100";
  }

  return (
    <span
      className={`rounded-full px-3 py-1 text-sm font-semibold ${color}`}
    >
      {Number(rate).toFixed(2)} %
    </span>
  );
}

export default function BusinessIntelligence({
  data,
  showFinance = false,
}) {
  if (!data) {
    return null;
  }

  return (
    <div>
      <h2 className="mb-5 text-2xl font-bold">
        Business Intelligence
      </h2>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h3 className="mb-5 text-lg font-semibold">
            {showFinance
              ? "Insight Bulan Ini"
              : "Insight Produksi"}
          </h3>

          <div className="space-y-4">
            {showFinance && (
              <>
                <div className="flex justify-between">
                  <span>Income</span>

                  <strong>
                    <Currency
                      value={
                        data.monthlyIncome
                      }
                    />
                  </strong>
                </div>

                <div className="flex justify-between">
                  <span>Expense</span>

                  <strong>
                    <Currency
                      value={
                        data.monthlyExpense
                      }
                    />
                  </strong>
                </div>

                <div className="flex justify-between">
                  <span>Profit</span>

                  <strong className="text-green-700">
                    <Currency
                      value={
                        data.monthlyProfit
                      }
                    />
                  </strong>
                </div>
              </>
            )}

            <div className="flex justify-between">
              <span>
                Produksi Bulan Ini
              </span>

              <strong>
                {Number(
                  data.monthlyFinished || 0
                ).toLocaleString(
                  "id-ID"
                )}{" "}
                pcs
              </strong>
            </div>

            <div className="flex items-center justify-between">
              <span>
                Reject Rate Hari Ini
              </span>

              <RejectBadge
                rate={
                  data.rejectRate || 0
                }
              />
            </div>

            <div className="flex justify-between">
              <span>
                Stok Rendah
              </span>

              <strong>
                {data.lowStockCount || 0}
              </strong>
            </div>
          </div>
        </Card>

        <Card>
          <h3 className="mb-5 text-lg font-semibold">
            Top Produk Bulan Ini
          </h3>

          {!data.productionByRecipe ||
          data.productionByRecipe.length ===
            0 ? (
            <p className="text-gray-500">
              Belum ada produksi.
            </p>
          ) : (
            <div className="space-y-3">
              {data.productionByRecipe
                .slice(0, 5)
                .map((recipe) => {
                  const max =
                    data
                      .productionByRecipe[0]
                      ?.selesai || 1;

                  const percent =
                    (recipe.selesai /
                      max) *
                    100;

                  return (
                    <div
                      key={recipe.kode}
                    >
                      <div className="flex justify-between text-sm">
                        <span>
                          {recipe.nama}
                        </span>

                        <strong>
                          {recipe.selesai}
                        </strong>
                      </div>

                      <div className="mt-1 h-2 rounded bg-gray-200">
                        <div
                          className="h-2 rounded bg-amber-500"
                          style={{
                            width: `${percent}%`,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <h3 className="mb-4 text-lg font-semibold">
            Batch Sedang Berjalan
          </h3>

          {!data.activeBatchItems ||
          data.activeBatchItems.length ===
            0 ? (
            <p className="text-green-700">
              Tidak ada batch aktif.
            </p>
          ) : (
            <div className="space-y-3">
              {data.activeBatchItems.map(
                (batch) => (
                  <div
                    key={batch.id}
                    className="rounded-lg border p-3"
                  >
                    <div className="font-semibold">
                      {batch.kode}
                    </div>

                    <div className="text-sm text-gray-500">
                      {batch.recipeNama}
                    </div>

                    <div className="mt-2 flex justify-between text-sm">
                      <span>
                        {batch.status}
                      </span>

                      <span>
                        {batch.selesai} /{" "}
                        {batch.target}
                      </span>
                    </div>
                  </div>
                )
              )}
            </div>
          )}
        </Card>

        <Card>
          <h3 className="mb-4 text-lg font-semibold">
            Bahan Hampir Habis
          </h3>

          {data.lowStockCount ===
          0 ? (
            <p className="text-green-700">
              Semua stok aman.
            </p>
          ) : (
            <div className="space-y-3">
              {data.lowStockItems?.map(
                (item) => (
                  <div
                    key={item.id}
                    className="flex justify-between rounded-lg bg-red-50 p-3"
                  >
                    <div>
                      <div className="font-semibold">
                        {item.nama}
                      </div>

                      <div className="text-sm text-gray-500">
                        Minimum{" "}
                        {
                          item.minimumStok
                        }{" "}
                        {item.satuan}
                      </div>
                    </div>

                    <strong className="text-red-700">
                      {item.stok}{" "}
                      {item.satuan}
                    </strong>
                  </div>
                )
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}