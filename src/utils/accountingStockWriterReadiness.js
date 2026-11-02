/** READ-ONLY engineering readiness matrix. Never authorizes production cutover. */
export const STOCK_WRITER_COVERAGE = Object.freeze([
  {
    "rpc": "record_shaping_split",
    "description": "Frozen masuk dari shaping",
    "movementTypes": [
      "FROZEN_IN"
    ],
    "status": "NOT_INTEGRATED"
  },
  {
    "rpc": "release_frozen_stock",
    "description": "Frozen keluar untuk pemanggangan",
    "movementTypes": [
      "FROZEN_OUT"
    ],
    "status": "PROTOTYPE_ONLY"
  },
  {
    "rpc": "record_baking_result",
    "description": "Produk selesai baking",
    "movementTypes": [
      "FINISHED_IN"
    ],
    "status": "PROTOTYPE_ONLY"
  },
  {
    "rpc": "record_cafe_deposit",
    "description": "Kirim satu produk ke kafe",
    "movementTypes": [
      "CAFE_OUT"
    ],
    "status": "NOT_INTEGRATED"
  },
  {
    "rpc": "record_multi_product_release",
    "description": "Kirim beberapa produk ke kafe/event",
    "movementTypes": [
      "CAFE_OUT"
    ],
    "status": "PROTOTYPE_ONLY"
  },
  {
    "rpc": "record_sale_transaction",
    "description": "Penjualan otomatis",
    "movementTypes": [
      "CAFE_OUT"
    ],
    "status": "NOT_INTEGRATED"
  },
  {
    "rpc": "update_sale_transaction",
    "description": "Edit penjualan/retur dan jual ulang",
    "movementTypes": [
      "CAFE_IN",
      "CAFE_OUT"
    ],
    "status": "NOT_INTEGRATED"
  },
  {
    "rpc": "delete_sale_transaction",
    "description": "Batalkan penjualan",
    "movementTypes": [
      "CAFE_IN"
    ],
    "status": "NOT_INTEGRATED"
  },
  {
    "rpc": "record_product_stock_adjustment",
    "description": "Penyesuaian stok produk jadi",
    "movementTypes": [
      "ADJUSTMENT_IN",
      "ADJUSTMENT_OUT"
    ],
    "status": "NOT_INTEGRATED"
  }
]);
export function inspectStockWriterReadiness(){return {status:"BLOCKED_PRE_CUTOVER",totalWriters:STOCK_WRITER_COVERAGE.length,prototypeWriters:STOCK_WRITER_COVERAGE.filter(x=>x.status==="PROTOTYPE_ONLY").length,liveIntegratedWriters:0,writers:STOCK_WRITER_COVERAGE.map(x=>({...x,movementTypes:[...x.movementTypes],liveIntegrated:false})),blockers:["Prosedur stok lama belum terhubung ke pembukuan lot atomik.","Saldo awal fisik dan nilai persediaan belum disahkan Owner.","Autentikasi Owner dan seluruh jalur stok belum diuji di Supabase staging terpisah."],cutoverMayBeActivated:false,writesDatabase:false};}
