export function scaleRecipeIngredients(
  ingredients = [],
  recipeYield = 1,
  targetProduction = 1,
) {
  if (recipeYield <= 0) {
    return [];
  }

  const factor =
    targetProduction / recipeYield;

  return ingredients.map((item) => ({
    ...item,
    kebutuhan: Number(
      (item.jumlah * factor).toFixed(2)
    ),
    subtotal: Number(
      (
        item.jumlah *
        factor *
        item.hargaPerSatuan
      ).toFixed(2)
    ),
  }));
}

export function calculateProductionCost(
  ingredients = [],
) {
  return Number(
    ingredients
      .reduce(
        (total, item) =>
          total + item.subtotal,
        0
      )
      .toFixed(2)
  );
}