export function generateBatchNumber(
  recipeCode,
  productionDate,
  sequence
) {
  const date = productionDate.replaceAll("-", "");

  const seq = String(sequence).padStart(3, "0");

  return `PB-${recipeCode}-${date}-${seq}`;
}