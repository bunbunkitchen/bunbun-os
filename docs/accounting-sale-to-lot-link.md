# Bunbun OS — Audit Penjualan → Stok → Lot → HPP (Belum Posting)

**Status:** branch feature/hpp-actual-staging, Draft PR #1. Audit transaksi produksi menggunakan SELECT, **tanpa** perubahan DB produksi atau website aktif. Preview COGS tetap simulasi berbasis bukti yang diinput, belum aktual.

## Mengapa laporan laba masih ditahan?
Kode rumus bukan satu-satunya syarat. Laba harus memiliki bukti pendapatan hak Bunbun dan harga pokok **unit yang benar-benar terjual**. Schema `sale_items` sudah menghubungkan produk ke `sales`; `product_stock_movements` menghubungkan `CAFE_OUT` ke `sales` melalui `sale_id`. Tetapi **CAFE_OUT penjualan belum memiliki `batch_split_id`**, sehingga tidak ada bukti batch/lot yang digunakan. Ditambah lagi `inventory_transactions.PRODUCTION_OUT.unit_value` historis banyak kosong. Owner belum menyetujui tanggal cutover, stok fisik per lokasi, nilai persediaan, dan bukti biaya produksi (bahan, tenaga kerja, overhead, reject).

### Temuan read-only Supabase Oktober 2026
- 711 penjualan PUBLIC_HUB.
- 1.023 baris item produk penjualan dan 1.023 mutasi CAFE_OUT yang tertaut `sale_id` di periode tersebut.
- **1.023 dari 1.023 kelompok sale_id + product_id mempunyai jumlah item = jumlah mutasi CAFE_OUT**; tidak ada gap kuantitas pada perbandingan SQL agregat tersebut.
- 1.023 mutasi CAFE_OUT tertaut itu **tidak memiliki batch_split_id**, sehingga belum bisa diikat ke lot asal untuk menghitung HPP sesuai perolehan nyata.
- 711 transaksi penjualan mempunyai rincian produk dan total subtotal item cocok dengan total sale.
- Kecocokan stok penjualan bukan bukti bahwa setoran kafe sudah masuk atau sudah benar menjadi hak Bunbun; setoran dan piutang lintas bulan tetap diaudit terpisah.

## Yang G buat
- `src/utils/accountingSaleStockReconciliation.js`: memeriksa `sales`, `sale_items`, dan `product_stock_movements` berdasarkan ID SALE + product_id, jumlah SKU, tanggal, subtotal vs total, dan `CAFE_OUT` tanpa sale_id. Tidak otomatis menghubungkan berdasarkan produk/tanggal saja.
- `src/services/accountingSaleStockAuditService.js`: SELECT terpaginasikan, dengan count exact dan batas aman. Query sumber item/mutasi memakai `sale_id` dan dapat mempertahankan mutasi lintas tanggal, sedangkan orphan terfilter tanggal per bulan. Menolak data parsial dan kesalahan sumber.
- `src/pages/finance/SaleLotTraceAudit.jsx`: halaman khusus Owner bernama **Audit Penjualan & Lot** (`/finance/sale-lot-audit`), menampilkan transaksi cocok vs perlu ditinjau, ringkasan jumlah item/stock, dan transaksi tanpa sale ID. Tidak ada angka HPP yang diisi sebagai estimasi.
- `src/utils/accountingSaleLotAllocation.js`: fungsi `previewSaleToLotCogs` **mengharuskan referensi ekspilisit** dari movement stock ke event lot yang terjual, product ID cocok, sale ID cocok, tanggal cocok, qty tepat, bukti review eksplisit. Banyak lot boleh mengisi satu item/movement. Lot yang tidak teralokasi menjadi blocker, bukan nilai nol.
- `previewSaleToLotCogs` hanya dapat menampilkan **DRAFT** Dr HPP (5010)/Cr titipan kafe (1240) dari `proposeSoldLotCogsDrafts`; tidak melakukan posting. Dilarang membuat COGS dari SHIP_TO_CAFE, frozen transfer, retur, atau stock-out yang belum ada sale.
- `tests/hppSaleStockReconciliation.test.js` dan `tests/hppSaleLotAllocation.test.js`: menolak duplikat, ID palsu, perbedaan jumlah, salah produk, salah tanggal, event dipakai dua kali, dan sumber tidak lengkap.

## Kenapa masih memerlukan pengecekan Owner
1. **Sumber pencatatan lot tidak tersedia pada mutasi penjualan historis.** G tidak boleh memilih batch asal hanya karena nama produk sama. Jika ditambahkan sembarangan, stok atau HPP bisa berubah salah.
2. **Biaya persediaan historis tidak lengkap** dan sumber biaya actual harus menggunakan pembelian/penilaian yang direkonsiliasi, bukan master HPP resep atau tarif Rp2.615/pcs.
3. **Saldo awal dan tanggal cutover** harus berdasarkan stok opname serta bukti bank/utang/piutang dan ditandatangani Owner.
4. **Posting ledger terautentikasi** perlu Supabase staging terpisah, review Owner nyata, anti-duplikat dan uji RLS. Belum ada deployment staging/production.
5. **Setoran dari kafe tetap pemasukan bersih Bunbun** yang tercatat; penghitungan tidak memotong lagi 30%. Pengiriman barang ke kafe dan penerimaan setoran adalah dua kejadian berbeda.

## Batasan pengerjaan tahap ini
- Tidak ada update/delete transaksi, stock adjustment, penambahan jurnal, pembelian, atau perubahan harga master resep.
- `reviewed:true` dalam pratinjau hanya nilai input yang belum diverifikasi backend. Data laporan tetap `actualHppAvailable:false`, `readyToPost:false`, `writesDatabase:false`.
- UI Audit Penjualan & Lot menggunakan data transaksional lama dan tidak menampilkan draft value HPP yang membutuhkan verifikasi lot. Engine draft dengan alokasi lot tersedia untuk integrasi backend tahap berikutnya.
- `main` tidak berubah, Draft PR #1 belum digabung; CI menjalankan unit, lint, Vite build, Edge Deno check dan PostgreSQL E2E isolated.

## Tahap berikutnya (bergantung pada data nyata)
Bangun workflow Owner untuk memverifikasi pemetaan movement→lot pada transaksi yang belum punya lot, bukti penjualan kafe dan nilai perolehan lot pasca cutover, tanpa mengarang data historis. Baru setelah itu posting jurnal dalam transaksi DB terisolasi dan tampilkan laba aktual. Jika sumber historis tidak bisa dibuktikan, mulailah pelacakan lot untuk transaksi BARU setelah cutover yang telah disahkan; jangan memaksa rekonstruksi asal lot lama.