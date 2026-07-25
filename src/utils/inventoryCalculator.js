export function calculateStockByItem(
  movements = [],
  itemKode,
) {
  return movements
    .filter(
      (movement) =>
        movement.itemKode === itemKode
    )
    .reduce((stock, movement) => {
      const quantity =
        Number(movement.jumlah) || 0;

      if (movement.tipe === "IN") {
        return stock + quantity;
      }

      if (
        movement.tipe === "OUT" ||
        movement.tipe === "REJECT"
      ) {
        return stock - quantity;
      }

      return stock;
    }, 0);
}

export function buildStockSummary(
  movements = [],
) {
  const itemMap = new Map();

  movements.forEach((movement) => {
    if (!itemMap.has(movement.itemKode)) {
      itemMap.set(movement.itemKode, {
        itemKode: movement.itemKode,
        itemNama: movement.itemNama,
        satuan: movement.satuan,
      });
    }
  });

  return Array.from(itemMap.values()).map(
    (item) => ({
      ...item,
      stok: calculateStockByItem(
        movements,
        item.itemKode
      ),
    })
  );
}