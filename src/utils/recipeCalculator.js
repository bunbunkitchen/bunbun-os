export function calculateRecipeCost(ingredients = []) {
  const totalCost = ingredients.reduce((total, item) => {
    return total + (item.jumlah * item.hargaPerSatuan);
  }, 0);

  return Number(totalCost.toFixed(2));
}

export function calculateCostPerYield(
  totalCost,
  yieldQty,
) {
  if (!yieldQty || yieldQty <= 0) {
    return 0;
  }

  return Number(
    (totalCost / yieldQty).toFixed(2)
  );
}