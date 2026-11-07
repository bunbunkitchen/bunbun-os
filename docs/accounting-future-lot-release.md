# Bunbun OS — Pencatatan Lot pada Pengeluaran Produk Baru

**Status: PROTOTYPE STAGING, BELUM DEPLOY / BELUM MERGE.** Tidak ada perubahan pada transaksi produksi, stok atau Supabase aktif. Perhitungan HPP/laba actual tetap dikunci.

## Mengapa dibutuhkan
Pada Bunbun OS sekarang, **Finished Product Release** menyimpan jenis produk + qty + tujuan lewat `record_multi_product_release`, membuat `CAFE_OUT` tanpa `batch_split_id` dan tanpa `sale_id`. Penjualan otomatis melalui `record_sale_transaction` juga membuat `CAFE_OUT`, tetapi dengan `sale_id` dan tanpa lot. Keduanya sama-sama mengurangi saldo produk jadi.

Batch produksi sudah memiliki `production_batch_splits.lot_code`, namun satu kode lot yang sama boleh dipakai untuk beberapa split dalam satu batch. Identitas fisik yang tepat untuk accounting harus memakai **ID split asal atau split turunan**, bukan hanya teks lot_code.

## Arsitektur baru yang sudah disiapkan
### A. Rencana alokasi lot pure JS (belum memengaruhi stok)
`src/utils/accountingNewLotReleasePlan.js`: `previewNewLotRelease` menerima `cutoverDate`, `releaseDate`, UUID `operationKey`, jenis tujuan, bukti pengeluaran, produk yang akan dikeluarkan, serta daftar **lot yang diklaim tersedia**.

Contoh satu jenis Original Salt Bread dibawa ke The Public Coffee sebanyak 8 pcs:
- 5 pcs dari `split:101` (batch awal produk jadi).
- 3 pcs dari `split:102` (hasil pengolahan frozen, biaya mengikuti lot frozen asal).
- Total alokasi = 8 pcs. Jika salah satu lot kurang, belum dirilis, tidak sesuai produk, jumlahnya pecahan, atau dipakai dua kali, rencana DITOLAK.

Selalu `writesDatabase:false`, `readyToPost:false`, `sourceBalanceVerified:false`, `ownerApprovalVerified:false`, `createsSale:false`, `createsCogs:false`. **Data availableQty yang diinput browser belum bukti fisik/approval.**

### A2. Penghubung rencana lot ke backend tepercaya (tanpa request jaringan)
`src/utils/accountingLotReleaseTransport.js` (`buildLotReleaseServerRequest`) mengubah rencana lot menjadi payload yang kompatibel dengan prosedur atomik: tanggal, tujuan, operation key, productId, qty dan alokasi lot. Adapter memvalidasi ulang total/duplikasi dan **tidak pernah menyertakan** `actor_id`, harga, kas atau status persetujuan. Karena ini hanya adapter pure JS, ia **tidak memanggil Supabase** dan tidak membuat pengeluaran stok. Backend harus melakukan pengecekan login, saldo fisik, cutover dan sumber lot ulang.

### B. Prototype PostgreSQL atomik, private dan tertutup
`docs/sql/accounting-lot-release-staging.sql` adalah **desain SQL yang berjalan hanya pada container PostgreSQL sementara di GitHub Actions**, bukan migrasi Supabase siap deploy.

Tabel privat:
- `bunbun_accounting.finished_lot_positions`: lot per split/approved opening, produk, lokasi, qty awal, qty tersedia dan referensi bukti.
- `bunbun_accounting.lot_release_operations`: header transaksi pengeluaran dengan UUID operation key, fingerprint payload, jenis tujuan dan Owner actor.
- `bunbun_accounting.lot_release_allocations`: penghubung setiap baris mutasi stok produk jadi ke lot sumber dan qty.

Fungsi privat `bunbun_accounting.record_lot_assigned_release` (SECURITY INVOKER, bukan fungsi public) melakukan SATU transaksi:
1. Pemeriksaan panggilan server service_role + Owner aktif, tanggal dan validitas operation key.
2. Menolak pengeluaran bertipe 'SOLD_AT_CAFE' dari form pengeluaran; kirim ke kafe = **titipan** yang belum terbukti dijual.
3. Mengunci baris produk dan seluruh posisi lot produk (`FOR UPDATE`); memeriksa saldo lot = saldo stok produk jadi yang tercatat.
4. Mencocokkan qty setiap produk dengan total seluruh lot yang dipilih, menolak qty berlebih, lot berbeda produk, stok minus, duplikat.
5. Membuat `CAFE_OUT` stok produk **dan** setiap alokasi lot yang tepat dalam transaksi SQL yang sama, lalu mengurangi posisi lot. Jika salah satu langkah gagal, seluruh transaksi batal otomatis.
6. `operation_key` yang sama dengan fingerprint dan Owner yang sama mengembalikan hasil lama; bila payload berubah, ditolak. Recorded release dan alokasi tidak boleh diedit/hapus diam-diam.

### C. Pengujian CI isolated
`tests/hppNewLotReleasePlan.test.js` menguji alokasi dua lot per produk, rencana stok minus, tanggal/cutover, duplikasi, dan larangan menganggap kiriman sebagai penjualan. `tests/hppLotReleaseTransport.test.js` menguji request mapping serta penolakan spoofing/approval palsu.

`tests/sql/accounting-lot-release-bootstrap.sql` membuat contoh public products/splits/stock hanya di database disposable. `tests/sql/accounting-lot-release-e2e.sql` memeriksa:
- Pengeluaran dua produk sekaligus, dengan produk pertama dibagi dari dua lot.
- Replay operation key tidak mengurangi stok dua kali.
- **Tes concurrency dua sesi PostgreSQL nyata:** transaksi A mengunci baris produk 1, transaksi B mencoba mengambil 6 unit dari lot yang sama ketika A masih memegang lock. Setelah A sukses, B harus tertolak; hanya satu `CAFE_OUT`, tidak ada lot minus, dan tidak ada operasi kedua yang tertinggal.
- Skrip `tests/sql/accounting-lot-concurrency.sh`, `accounting-lot-concurrency-a.sql`, `accounting-lot-concurrency-b.sql` menjalankan pengujian dalam database disposable terpisah dari tes rollback biasa.
- Overdraw stok pada produk kedua membatalkan perubahan produk pertama (atomic rollback).
- Owner nonaktif/Baker ditolak.
- Alokasi tidak tepat, lot duplikat, dan permintaan menyamarkan pengiriman sebagai penjualan ditolak.
- Mutasi lama yang melewati pencatatan lot menyebabkan divergensi dan memblokir pengeluaran berikutnya.
- Peran anon/authenticated tidak diberi akses langsung ke schema/fungsi privat; RLS diaktifkan.
- Semua skenario **tanpa menulis jurnal laba/HPP atau setoran kas**.

## TAHAP BARU: writer gate default-OFF dan audit semua prosedur stok
- `docs/sql/accounting-lot-writer-gate-staging.sql` menambah **lot_tracking_control** dalam private schema, default `OFF`. Dalam mode OFF, prosedur mutasi stok lama tidak dibatasi oleh trigger baru. Ini hanya desain untuk isolated PostgreSQL, **bukan migrasi produksi**.
- Saat mode `ON` pada database UJI, trigger di `public.product_stock_movements` memblokir mutasi yang tidak berasal dari transaksi lot atomik yang dapat diaudit; update/delete lama termasuk soft delete ditolak. Hanya source `CAFE_OUT` dari routine private yang sudah ditest dapat lewat. Dengan demikian ON **belum bisa dipakai untuk baking, frozen, sales, returns, adjustment**: semua writers tersebut tetap diblokir sampai benar-benar diintegrasikan.
- Constraint trigger **DEFERRABLE INITIALLY DEFERRED** memeriksa di akhir transaksi: setiap `CAFE_OUT` harus cocok 100% dengan alokasi `lot_release_allocations`, header `RECORDED`, produk yang benar, serta total `original_qty - available_qty` yang sama dengan seluruh qty penggunaan lot. Hanya memberi marker pada session SQL tidak cukup untuk memalsukan sumber atau jumlah.
- Tidak ada hak `UPDATE` `lot_tracking_control` bagi `service_role` biasa. Pengaktifan hanya direncanakan melalui proses cutover terpisah dengan persetujuan Owner, bukan tombol browser atau fitur sementara.
- `tests/sql/accounting-lot-writer-gate-e2e.sql`: mengecek OFF tetap menerima mekanisme lama; ON menolak mutasi tanpa lot (`FINISHED_IN`, `FROZEN_OUT`, `CAFE_IN`, `ADJUSTMENT_OUT`, `CAFE_OUT`); menolak penonaktifan gate, percobaan marker tanpa header, pemalsuan header+alokasi tanpa pengurangan saldo, modifikasi/soft-delete, dan memastikan multi-product lot release benar masih lolos.
- `src/utils/accountingStockWriterReadiness.js` dan `tests/hppStockWriterReadiness.test.js` mendaftarkan 9 prosedur penulis stok (frozen, baking, pengiriman, penjualan, edit/batal, adjustment). Hanya pengeluaran multi-produk punya prototipe SQL diuji; **0 prosedur sudah terhubung ke Bunbun aktif**. Halaman Owner `Persiapan Saldo Awal` menampilkan matriks ini tanpa tombol aktivasi.
- Audit SELECT saja di Supabase aktif menunjukkan trigger `trg_refresh_finished_product_stock_balance` sudah memperbarui ringkasan stok setiap `INSERT/UPDATE/DELETE`, ditambah `prevent_sub_recipe_finished_stock_before_insert`. Pengujian baru harus tetap mempertahankan kerja trigger ini saat database staging aktual tersedia.
- **Keberhasilan gate ON dalam unit test BUKAN izin mengaktifkan gate pada sistem saat ini**: layanan produksi pasti berhenti ketika baking, penjualan, adjustment atau frozen masih belum memakai lot baru.

## TAHAP TAMBAHAN: asal frozen dan hasil baking (PostgreSQL 16 khusus CI)
- Rincian dan pembatas: `docs/accounting-frozen-baking-lot-flow.md`.
- `docs/sql/accounting-frozen-baking-staging.sql` memperluas prototipe `writer gate` **hanya pada database uji**: fungsi privat mencatat `FROZEN_OUT` dengan source split frozen root, menciptakan split turunan `DIRECT`, lalu hanya hasil baking layak yang menjadi `FINISHED_IN` dan lot finished.
- Saldo frozen dan finished, hasil reject, referensi sumber `FROZEN_IN`, idempotensi, kuantitas, dan kasus dua sesi simultan diuji sampai rekonsiliasi posisi lot. Menitipkan hasil ke kafe tetap bukan pengakuan penjualan.
- Status teknik sekarang **3 dari 9 jalur mempunyai prototipe**, **0 dari 9 terintegrasi ke aplikasi aktif**. Pembuatan frozen root dari shaping, pembaruan status/akumulasi batch induk, penjualan, pembatalan, retur, penyesuaian stok, biaya aktual dan saldo awal resmi masih perlu integrasi.
- Ini bukan migrasi Supabase siap pakai dan bukan aktivasi gate; dokumen `writer gate` dasar sebelumnya hanya mengizinkan `CAFE_OUT`, sedangkan extension ini memperluas pengecualian `FROZEN_OUT` dan `FINISHED_IN` **pada database pengujian yang terpisah**.

## TAHAP TERBARU — 9/9 PROTOTIPE, BUKAN 9/9 INTEGRASI
- `docs/accounting-cafe-and-adjustment-lots.md`: pengeluaran satu produk ke kafe menggunakan writer multi-lot yang sama; Stock Adjustment OUT/IN menggunakan ledger lot tersendiri dengan jejak sumber dan bukti. Penyesuaian IN untuk sementara hanya membalik OUT sebelumnya yang sama persis; surplus stok tanpa asal tervalidasi masih diblokir.
- `tests/sql/accounting-single-cafe-lot-e2e.sql` dan `tests/sql/accounting-product-adjustment-e2e.sql` menguji stok, provenance, idempotensi, penolakan alokasi salah, biaya dan kas tidak diubah.
- `tests/sql/accounting-adjustment-race.sh` menguji 2 operator berebut 4 pcs dari satu lot berisi 6 pcs; transaksi kedua tertolak tanpa orphan record.
- **Kesiapan versi prototipe kini 9 dari 9 jalur**, namun **0 jalur terintegrasi ke aplikasi atau Supabase yang sedang aktif**. Semua SQL prototype masih berada di berbagai database disposable CI dengan beberapa definisi writer gate alternatif; **belum menjadi satu migrasi aman**.
- Pernyataan angka prototipe 3/9 atau 4/9 pada bagian *riwayat milestone sebelumnya* di bawah adalah status historis, bukan status terbaru.

## Pengaman sebelum boleh dipasang ke OS aktif
**Jangan menjalankan SQL di Supabase produksi.** Secara khusus:
1. Saat ini prosedur SQL memakai tanggal **2026-11-01 hanya sebagai batas minimum data UJI**. Itu bukan cutover yang disetujui Owner, dan HARUS diganti dengan pembacaan immutable `opening_snapshots` yang telah disahkan sebelum deploy mana pun.
2. Pembuatan `finished_lot_positions` saat ini disimulasikan dengan data lot sintetis. Production-ready code harus memverifikasi real source split, `FINISHED_IN`, `FROZEN_OUT`, stok fisik pembuka, serta biaya perolehan sebelum menyebut lot disetujui.
3. Semua jalur stok keluar (form pengeluaran, automatic sale RPC, edit/hapus sale, stock adjustment, frozen conversion, returns) HARUS terintegrasi satu sistem lot atomik. Jika jalur lama masih aktif dan melewati lot tracking, sistem akan macet atau membuat selisih.
4. Backend terpercaya harus memvalidasi JWT/session Owner sebenarnya dan tidak menerima `actor_id` atau nominal dari browser sebagai otorisasi. Kunci service_role tidak boleh ada dalam bundle Vite.
5. Reverse/cancel dari pengeluaran lot memerlukan jurnal dan mutasi balik yang ditinjau, bukan UPDATE DELETE source/lot yang telah recorded.
6. Wajib uji persaingan transaksi nyata dua operator, batas kuota stok, RLS, security advisor dan rollback dalam **Supabase staging terpisah** sebelum rilis.
7. `CAFE_OUT` yang memang sudah dipakai oleh sales otomatis bukan bukti otomatis setoran kafe atau bahwa produk sebelumnya dititipkan. Penjualan tidak boleh mengurangi lot titipan sekaligus lot finished dengan cara ganda.
8. Keputusan laba, bonus, atau ekspansi menunggu laporan dari jurnal POSTED setelah cutover serta audit stok dan pendapatan selesai.

## Kesimpulan yang sudah bisa dilakukan
Struktur untuk **menentukan dari lot mana satu pengeluaran produk berasal** dan **menyimpan pengeluaran dengan stok secara atomik** telah ada sebagai prototipe teruji dalam isolated CI. Fitur ini belum dapat dipakai pada website aktif tanpa data saldo awal dan penggantian/penyesuaian seluruh RPC writer stok di staging.