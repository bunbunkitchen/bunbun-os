const INCOMING_TRANSACTION_TYPES = [
  "PURCHASE",
  "PRODUCTION_IN",
  "ADJUSTMENT_IN",
  "ADJUSTMENT",
];

const OUTGOING_TRANSACTION_TYPES = [
  "PRODUCTION_OUT",
  "SALE",
  "ADJUSTMENT_OUT",
];

export function isIncomingTransactionType(type) {
  return INCOMING_TRANSACTION_TYPES.includes(type);
}

export function isOutgoingTransactionType(type) {
  return OUTGOING_TRANSACTION_TYPES.includes(type);
}

export function calculateStockBase(
  transactions = [],
  toBaseUnit
) {
  return transactions.reduce(
    (stock, transaction) => {
      const quantityBase = toBaseUnit(
        transaction.qty,
        transaction.unit
      );

      if (
        isIncomingTransactionType(
          transaction.transaction_type
        )
      ) {
        return stock + quantityBase;
      }

      if (
        isOutgoingTransactionType(
          transaction.transaction_type
        )
      ) {
        return stock - quantityBase;
      }

      return stock;
    },
    0
  );
}