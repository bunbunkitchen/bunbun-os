export function calculateRecipeCost(items = []) {
  const totalCost = items.reduce(
    (total, item) => {
      const jumlah = Number(
        item.jumlah || 0
      );

      const hargaPerSatuan = Number(
        item.hargaPerSatuan || 0
      );

      return (
        total +
        jumlah * hargaPerSatuan
      );
    },
    0
  );

  return Number(
    totalCost.toFixed(2)
  );
}

export function calculateCostPerYield(
  totalCost,
  yieldQty
) {
  if (
    !yieldQty ||
    Number(yieldQty) <= 0
  ) {
    return 0;
  }

  return Number(
    (
      Number(totalCost || 0) /
      Number(yieldQty)
    ).toFixed(2)
  );
}