import Currency from "../ui/Currency";

const OPERATIONAL_COST_PER_YIELD = 2615;

export default function RecipeCostSummary({
  totalCost = 0,
  yieldQty = 0,
  yieldUnit = "pcs",
  costPerYield = 0,
}) {
  const totalHppPerYield =
    Number(costPerYield || 0) +
    OPERATIONAL_COST_PER_YIELD;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <p className="text-sm text-gray-500">
          Total Biaya Resep
        </p>

        <p className="mt-2 text-2xl font-bold text-gray-900">
          <Currency value={totalCost} />
        </p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <p className="text-sm text-gray-500">
          Yield
        </p>

        <p className="mt-2 text-2xl font-bold text-gray-900">
          {yieldQty} {yieldUnit}
        </p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <p className="text-sm text-gray-500">
          HPP Bahan Baku per {yieldUnit}
        </p>

        <p className="mt-2 text-2xl font-bold text-amber-700">
          <Currency value={costPerYield} />
        </p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <p className="text-sm text-gray-500">
          Biaya Operasional per {yieldUnit}
        </p>

        <p className="mt-2 text-2xl font-bold text-gray-700">
          <Currency value={OPERATIONAL_COST_PER_YIELD} />
        </p>
      </div>

      <div className="rounded-xl border border-amber-300 bg-amber-50 p-5">
        <p className="text-sm text-amber-700">
          Total HPP per {yieldUnit}
        </p>

        <p className="mt-2 text-2xl font-bold text-amber-800">
          <Currency value={totalHppPerYield} />
        </p>
      </div>
    </div>
  );
}