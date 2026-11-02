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
`tests/sql/accounting-lot-release-bootstrap.sql` membuat contoh public products/splits/stock hanya di database disposable. `tests/sql/accounting-lot-release-e2e.sql` memeriksa:
- Pengeluaran dua produk sekaligus, dengan produk pertama dibagi dari dua lot.
- Replay operation key tidak mengurangi stok dua kali.
- Overdraw stok pada produk kedua membatalkan perubahan produk pertama (atomic rollback).
- Owner nonaktif/Baker ditolak.
- Alokasi tidak tepat, lot duplikat, dan permintaan menyamarkan pengiriman sebagai penjualan ditolak.
- Mutasi lama yang melewati pencatatan lot menyebabkan divergensi dan memblokir pengeluaran berikutnya.
- Peran anon/authenticated tidak diberi akses langsung ke schema/fungsi privat; RLS diaktifkan.
- Semua skenario **tanpa menulis jurnal laba/HPP atau setoran kas**.

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