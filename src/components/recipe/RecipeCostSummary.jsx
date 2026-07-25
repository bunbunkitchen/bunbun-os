import Currency from "../ui/Currency";

export default function RecipeCostSummary({
  totalCost = 0,
  yieldQty = 0,
  yieldUnit = "pcs",
  costPerYield = 0,
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
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
          HPP per {yieldUnit}
        </p>

        <p className="mt-2 text-2xl font-bold text-amber-700">
          <Currency value={costPerYield} />
        </p>
      </div>
    </div>
  );
}