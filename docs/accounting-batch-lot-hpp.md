# Bunbun OS — HPP Aktual Batch & Penelusuran Nilai Lot

> **Status: DRAFT / STAGING ONLY / NO POSTING.** Modul di branch pengembangan untuk penelusuran stok dan simulasi HPP dari bukti yang direview, **belum** menghasilkan HPP aktual Bunbun dan belum melakukan perubahan pada Supabase produksi.

## Temuan struktur nyata (audit SQL baca-saja, 2 November 2026)
- `production_batches`: batch selesai memiliki `status='Finished'` dan `inventory_consumed=true`.
- `inventory_transactions` dengan `PRODUCTION_OUT` menunjukkan bahan yang telah dipakai dan `production_batch_id`; `unit_value` historis banyak kosong sehingga tidak aman dianggap 0 atau diisi otomatis dari harga master resep.
- `production_batch_splits`: root (`source_split_id IS NULL`) dapat `route='DIRECT'`, `route='FROZEN'`, atau `route='REJECT'`. Split turunan DIRECT dengan `source_split_id` menunjuk hasil pemanggangan stok frozen, **bukan produksi bahan baru**.
- `product_stock_movements`: `FINISHED_IN`, `FROZEN_IN`, `FROZEN_OUT` berhubungan dengan `batch_split_id`. `CAFE_OUT` umumnya tidak punya batch_split_id; per 2 Nov 2026 tidak boleh diasumsikan FIFO/HPP tanpa alokasi lot penjualan terverifikasi.
- Tidak ada perubahan terhadap data di atas; semua pemeriksaan menggunakan SELECT.

## Modul baru
- `src/utils/accountingLotValuation.js`: dua mesin pure, `buildBatchLotCostDraft` dan `traceLotCostDraft`.
- `buildBatchLotCostDraft` membutuhkan **setiap** penggunaan bahan dan nilai biaya perolehan yang telah direview, serta bukti biaya tenaga kerja, overhead, reject dan alokasi biaya untuk split asal. Total harus tepat sama: **bahan + tenaga kerja + overhead = alokasi lot layak jual + biaya reject**.
- Biaya alokasi untuk frozen dan direct menggunakan bukti per lot; tidak menggunakan tarif tetap Rp2.615/pcs sebagai nilai aktual. Tarif lama tetap boleh sebagai asumsi simulasi terpisah, tidak untuk posting.
- `FINISHED_IN`/`FROZEN_IN` root harus cocok persis dengan hasil produksi layak dan product_id. Split turunan `source_split_id` dikecualikan dari produksi bahan baru.
- Setiap lot hasilnya berisi quantity, tanggal release, source movement ID, lokasi awal, dan **nilai draft**, bukan HPP yang disahkan.
- `traceLotCostDraft`: memindahkan nilai persediaan beserta jumlah dari FROZEN→FINISHED→CAFE, retur CAFE→FINISHED, dan hanya mencatat COGS untuk `SOLD_AT_CAFE`/`DIRECT_SOLD` dengan bukti sale ID.
- Perhitungan proporsional biaya lot menggunakan perkalian BigInt atas nilai sen, dan menyisakan sen terakhir ke unit terakhir agar **total biaya awal = persediaan tersisa + HPP terjual** secara tepat.
- Mutasi dengan jumlah berlebih, sale ID duplikat dalam lot, tanggal sebelum release/urutan salah, bukti review kosong, atau transfer yang keliru diberi error; transaksi tidak ditulis.

## Penelusuran visual di Audit Biaya HPP
- `src/utils/accountingBatchLotAudit.js` menganalisis jumlah root, turunan frozen, release `FINISHED_IN`/`FROZEN_IN`, dan transfer `FROZEN_OUT`.
- `src/services/accountingBatchLotReadService.js` mengambil ulang seluruh movement batch-split secara read-only, dengan pagination dan error bila hasil terpotong.
- `src/services/batchCostingReadService.js` juga menolak hasil materials/splits yang tidak lengkap berdasarkan `count:'exact'`.
- `src/pages/finance/HppAudit.jsx`: informasi root/derived frozen, quantity release, kecocokan per split, jumlah bahan belum bernilai, serta daftar blocker terlihat ketika Owner memilih batch. Halaman tetap read-only.

## Kebijakan laporan laba
- Pembelian bahan → persediaan, bukan HPP.
- Pemakaian bahan → WIP; produk selesai → finished/frozen; kirim ke kafe → persediaan titipan.
- **Hanya barang yang benar-benar terjual** dapat diakui ke HPP berdasarkan lot terverifikasi.
- Reject, retur atau stock adjustment harus diklasifikasikan secara sah; tidak boleh diam-diam mengubah kas atau HPP resep.
- **Setoran dari kafe melunasi piutang** dan tidak menambah pendapatan dua kali.
- HPP actual memerlukan approved cutover, opening stocktake, real acquisition cost, release lot-to-sale evidence, labor/OH allocation, review dan journal POSTED.

## Pengaman dan keterbatasan saat ini
1. Bukti dengan `reviewed:true` dan `evidenceRef` dalam modul pure adalah **klaim input preview**, bukan bukti otorisasi Owner di server. Approval nyata masih perlu dibangun dengan backend JWT & audit trail.
2. Perpindahan stok yang digunakan oleh `traceLotCostDraft` saat ini berupa event **yang secara eksplisit dipasangkan ke lot**. Data `CAFE_OUT` lama tidak selalu memiliki split ID, sehingga tidak otomatis ditautkan ke lot atau sale.
3. Proyek Supabase staging terpisah belum tersedia; penggunaan data produksi yang sedang aktif sebagai sandbox tidak diizinkan.
4. Engine belum memposting `COGS`, dan belum menyambungkan lot yang diverifikasi ke jurnal dan dashboard aktual. `readyToPost:false`, `writesDatabase:false`, `actualCostOfGoodsSoldAvailable:false` tetap dipaksakan.
5. Biaya produksi, reject dan yield akhir memerlukan kebijakan akuntansi Owner dan bukti masing-masing; tidak ada pengisian angka yang hilang secara otomatis.

## Uji
- `tests/hppAccountingLotValuation.test.js`: konservasi biaya persediaan, pembagian sen, frozen→finished→kafe, COGS saat sold, retur, pengeluaran ganda, release sebelum cutover, reject, bukti material dan biaya operasional, dan larangan mengubah sumber.
- `tests/hppBatchLotAudit.test.js`: deteksi root/derived dan release yang cocok, nilai bahan hilang, stok duplikat/terhapus, tidak tersedia sumber batch.
- CI GitHub Actions memeriksa Node tests, ESLint, Vite build, Deno Edge typecheck, serta PostgreSQL E2E yang sudah ada.

**Tidak ada perubahan kas, HPP resep, stok aktual, Supabase produksi maupun website Bunbun OS aktif.**