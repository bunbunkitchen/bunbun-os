const UNIT_ALIASES = {
  kg: "kg",
  kilogram: "kg",

  gram: "gram",
  gr: "gram",
  g: "gram",

  liter: "liter",
  litre: "liter",
  l: "liter",

  ml: "ml",
  milliliter: "ml",
  mililiter: "ml",

  pcs: "pcs",
  pc: "pcs",
  piece: "pcs",
  pieces: "pcs",

  pack: "pack",
  packs: "pack",

  box: "box",
  boxes: "box",
};

/**
 * Menyeragamkan penulisan satuan.
 *
 * Contoh:
 * gr, g, gram -> gram
 * kilogram, kg -> kg
 */
export function normalizeUnit(unit) {
  const normalized = String(unit || "")
    .trim()
    .toLowerCase();

  return UNIT_ALIASES[normalized] || normalized;
}

/**
 * Mengubah quantity menjadi satuan dasar.
 *
 * Satuan dasar:
 * - berat: gram
 * - cairan: ml
 * - satuan hitung: pcs, pack, box tetap
 */
export function toBaseUnit(qty, unit) {
  const value = Number(qty || 0);
  const normalizedUnit = normalizeUnit(unit);

  switch (normalizedUnit) {
    case "kg":
      return value * 1000;

    case "gram":
      return value;

    case "liter":
      return value * 1000;

    case "ml":
      return value;

    default:
      return value;
  }
}

/**
 * Mengubah quantity dari satuan dasar ke satuan tujuan.
 *
 * Contoh:
 * 5000 gram -> 5 kg
 * 2000 ml -> 2 liter
 */
export function fromBaseUnit(
  qty,
  targetUnit
) {
  const value = Number(qty || 0);

  const normalizedUnit =
    normalizeUnit(targetUnit);

  switch (normalizedUnit) {
    case "kg":
      return value / 1000;

    case "gram":
      return value;

    case "liter":
      return value / 1000;

    case "ml":
      return value;

    default:
      return value;
  }
}

/**
 * Mengonversi quantity dari satu unit ke unit lain.
 *
 * Contoh:
 * convertUnit(2, "kg", "gram") -> 2000
 */
export function convertUnit(
  qty,
  fromUnit,
  toUnit
) {
  const normalizedFrom =
    normalizeUnit(fromUnit);

  const normalizedTo =
    normalizeUnit(toUnit);

  if (normalizedFrom === normalizedTo) {
    return Number(qty || 0);
  }

  const baseValue = toBaseUnit(
    qty,
    normalizedFrom
  );

  return fromBaseUnit(
    baseValue,
    normalizedTo
  );
}

/**
 * Memeriksa apakah dua unit kompatibel.
 *
 * kg kompatibel dengan gram.
 * liter kompatibel dengan ml.
 * pcs hanya kompatibel dengan pcs.
 */
export function areUnitsCompatible(
  firstUnit,
  secondUnit
) {
  const first = normalizeUnit(firstUnit);
  const second = normalizeUnit(secondUnit);

  if (first === second) {
    return true;
  }

  const weightUnits = ["kg", "gram"];
  const volumeUnits = ["liter", "ml"];

  if (
    weightUnits.includes(first) &&
    weightUnits.includes(second)
  ) {
    return true;
  }

  if (
    volumeUnits.includes(first) &&
    volumeUnits.includes(second)
  ) {
    return true;
  }

  return false;
}

/**
 * Menghitung harga per satuan dasar.
 *
 * Contoh:
 * total Rp180.000 untuk 10 kg
 * hasil = Rp18 per gram.
 */
export function calculateBaseUnitPrice(
  totalPrice,
  qty,
  unit
) {
  const total = Number(totalPrice || 0);

  const baseQty = toBaseUnit(
    qty,
    unit
  );

  if (baseQty <= 0) {
    return 0;
  }

  return total / baseQty;
}

/**
 * Menghitung biaya berdasarkan kebutuhan bahan.
 *
 * Contoh:
 * harga dasar Rp18/gram
 * kebutuhan 5000 gram
 * hasil Rp90.000.
 */
export function calculateIngredientCost(
  requiredQty,
  requiredUnit,
  baseUnitPrice
) {
  const requiredBaseQty = toBaseUnit(
    requiredQty,
    requiredUnit
  );

  return (
    requiredBaseQty *
    Number(baseUnitPrice || 0)
  );
}

/**
 * Menentukan satuan dasar berdasarkan unit.
 */
export function getBaseUnit(unit) {
  const normalizedUnit =
    normalizeUnit(unit);

  if (
    normalizedUnit === "kg" ||
    normalizedUnit === "gram"
  ) {
    return "gram";
  }

  if (
    normalizedUnit === "liter" ||
    normalizedUnit === "ml"
  ) {
    return "ml";
  }

  return normalizedUnit;
}

/**
 * Menampilkan stok dengan unit yang lebih mudah dibaca.
 *
 * Contoh:
 * 70000 gram -> 70 kg
 * 750 gram -> 750 gram
 */
export function formatBaseQuantity(
  qty,
  baseUnit
) {
  const value = Number(qty || 0);
  const normalizedUnit =
    normalizeUnit(baseUnit);

  if (
    normalizedUnit === "gram" &&
    Math.abs(value) >= 1000
  ) {
    return {
      qty: value / 1000,
      unit: "kg",
    };
  }

  if (
    normalizedUnit === "ml" &&
    Math.abs(value) >= 1000
  ) {
    return {
      qty: value / 1000,
      unit: "liter",
    };
  }

  return {
    qty: value,
    unit: normalizedUnit,
  };
}

export function roundQuantity(
  value,
  decimals = 6
) {
  const number = Number(value || 0);

  if (!Number.isFinite(number)) {
    return 0;
  }

  const factor = 10 ** decimals;

  return Math.round(
    (number + Number.EPSILON) * factor
  ) / factor;
}