# Bunbun OS — Prototype Alur Frozen → Proofing → Baking → Finished (PG16 CI)

**DRAFT ONLY, tidak di-merge dan tidak dideploy ke Supabase produksi.** Semua pengujian dilakukan pada database PostgreSQL 16 sementara dengan data sintetis. Komponen ini bukan persetujuan HPP aktual, bukan fitur kas, dan bukan pengaktifan lot tracking di website Bunbun yang digunakan harian.

## Pemeriksaan alur lama (kode asli)
- `record_shaping_split` membuat split root `FROZEN`, `DIRECT`, `REJECT`, dan menulis `FROZEN_IN` bila ada produk frozen.
- `release_frozen_stock` mengurangi stok dari split frozen root melalui `FROZEN_OUT` dan membuat split turunan `DIRECT` dengan `source_split_id` menunjuk root frozen.
- `record_baking_result` mencatat jumlah good/reject pada split `DIRECT`, membuat `FINISHED_IN` hanya dari yang good, lalu memperbarui agregat hasil serta status batch induk.
- Pada model lama, mutasi frozen dan finished punya `batch_split_id`; mutasi pengeluaran ke kafe/penjualan sering tidak punya ID split (itulah alasan cost lot sales historis belum bisa diakui otomatis).

## Perubahan kode di branch pengembangan
- `tests/sql/accounting-frozen-baking-bootstrap.sql` memperluas fixture dengan jumlah/status split, relasi derived, sumber `FROZEN_IN`, dan posisi finished awal yang sudah cocok secara sintetis.
- `docs/sql/accounting-frozen-baking-staging.sql` adalah prototype tambahan **di private schema**. Tabel `frozen_lot_positions` mencatat qty frozen per split root; `frozen_conversion_operations` mengikat `FROZEN_OUT` dan split turunan; `baking_operations` mengikat `FINISHED_IN`, jumlah good/reject dan split asal.
- `record_frozen_to_direct_staging`: cek Owner aktif yang dibawa backend, cutover ON **di database uji**, kunci baris produk/split/frozen posisi secara berurutan, verifikasi `FROZEN_IN` root sumber yang benar, pastikan stok frozen ledger sama dengan posisi lot, buat split turunan dan `FROZEN_OUT`, lalu kurangi posisi frozen dalam satu transaksi. Replay operation key dan payload sama tidak membentuk dua split; berbeda ditolak.
- `record_tracked_baking_staging`: cek split `DIRECT` belum baked, good+reject tepat sama dengan qty split, untuk split turunan cek operasi frozen asal, buat `FINISHED_IN` dan posisi finished **hanya untuk qty good**, catat reject sebagai jumlah hasil tidak layak, dan buat operasi baking yang write-once. Total reject tidak dimasukkan persediaan siap jual.
- Writer gate private **diperluas khusus untuk DB uji ini**, dari pengeluaran lot `CAFE_OUT` menjadi `FROZEN_OUT` dan `FINISHED_IN` yang mempunyai operasi tepercaya; validasi deferred memastikan operasi, sumber split, produk, qty, status, lineage, dan posisi lot cocok saat transaksi disimpan.
- Sesudah stok jadi bertambah, `record_lot_assigned_release` yang sudah ada tetap dapat mengurangi lot derived yang sama untuk titipan ke kafe tanpa membuat penjualan/HPP baru.
- `src/utils/accountingStockWriterReadiness.js`: status **3 dari 9 prototipe SQL teruji**, **0 dari 9 jalur siap dipakai di produksi**, gate cutover tetap blocked. Halaman Owner Persiapan Saldo Awal hanya menunjukkan status ini (read-only).

## Contoh sintetis dalam uji E2E
- Root frozen `split:200` mula-mula 8 pcs. Konversi 4 pcs menghasilkan `FROZEN_OUT` 4, sisa frozen 4, serta satu split `DIRECT` turunan dengan sumber `split:200`.
- Hasil baking turunan: 3 pcs layak + 1 reject. **Hanya 3 pcs** menjadi `FINISHED_IN` dan posisi finished derived yang baru.
- Root `DIRECT` lain dipanggang 2 pcs layak + 1 reject; mempunyai lot finished berbeda.
- Pengiriman 2 pcs dari lot derived mengurangi posisi finished 2, bukan membuat HPP terjual. Seluruh finished stock ledger vs total posisi lot harus sama.
- Seluruh reject 2 dari 2 unit menghasilkan **nol** penambahan stok produk jadi.
- Bukti sumber frozen palsu, jumlah frozen melebihi stok, hasil baking tidak sama dengan input, dan penulisan ulang dengan operation key yang sama namun isi berubah harus ditolak.
- Skrip tes dua sesi (`accounting-frozen-race.sh`): bila frozen tersisa 8 pcs, dua sesi masing-masing mencoba mengambil 6 pcs. Hanya satu diterima, kedua ditolak, tidak ada split turunan atau `FROZEN_OUT` yatim dari transaksi gagal.

## Penting: masih BELUM memenuhi syarat go-live
1. Prototipe ini **belum mengganti RPC aplikasi** `record_shaping_split`, `release_frozen_stock`, `record_baking_result`, atau memperbarui `production_batches.selesai/reject/status` seperti prosedur asli. Integrasi seluruh status dan alur approval produksi adalah pekerjaan berikutnya.
2. Sumber frozen root `FROZEN_IN` dan saldo pembuka pada test fixture masih dibuat secara sintetis, bukan berasal dari operasi shaping terintegrasi, opname nyata, atau rekening biaya yang diverifikasi.
3. Identitas Owner yang dipakai SQL prototype masih berupa parameter `actor_id`, yang **hanya boleh** diikat setelah backend memverifikasi JWT dan session aktif Owner secara independen. Flag `reviewed` atau dokumen yang dikirim browser bukan persetujuan nyata.
4. Nilai biaya frozen→finished masih harus mengikuti **asal lot yang sama**, dan reject wajib mendapat alokasi nilai biaya yang direview. Uji ini hanya menjaga **kuantitas dan provenance**; tidak mengeluarkan HPP aktual atau laporan laba aktual.
5. Writer lain (penjualan otomatis, edit/batal penjualan, adjustment, retur, frozen root dari shaping) belum terintegrasi. Gate ON pada OS aktif akan memblokir mereka, sehingga **dilarang mengaktifkan** gate di Supabase produksi.
6. Proyek Supabase staging terpisah belum tersedia; review security/permissions/RLS yang sebenarnya, snapshot cutover resmi, integrasi status batch dan seluruh writer, serta rollback drill wajib dilakukan sebelum deployment nyata.

**Semua kode berada di `feature/hpp-actual-staging`, Draft PR #1. Tidak ada perubahan terhadap saldo, transaksi, harga resep, atau database Bunbun aktif.**