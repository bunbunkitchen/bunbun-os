# Bunbun OS — Shaping Root, Frozen Lot & Status Batch Induk (PG16 CI Only)

**Status: DESIGN + PROTOTYPE TESTED — NOT DEPLOYABLE.** Seluruh eksekusi SQL berlangsung di PostgreSQL 16 ephemeral yang dibuat oleh GitHub Actions, bukan Supabase Bunbun aktif. Tak ada posting jurnal laba, cashflow, atau produksi nyata.

## Mengapa perlu modul ini
- Pencatatan lama `record_shaping_split` membagi satu production_batch menjadi root FROZEN, DIRECT, REJECT dan menerbitkan FROZEN_IN; `release_frozen_stock` membuat split DIRECT **turunan**, tidak menambah target asli; `record_baking_result` menghitung produk jadi/reject.
- Risiko yang ditutup di test: split turunan dihitung dua kali sebagai produksi baru; batch ditandai Finished padahal masih ada frozen atau DIRECT belum baked; saldo frozen berbeda dengan mutasi, lot/code source tak sah, penyusupan material belum dipakai.

## Perubahan baru di Draft PR
- `docs/sql/accounting-shaping-batch-staging.sql`: menambah private immutable `shaping_operations` satu per batch, fungsi `record_tracked_shaping_staging` dengan validasi Owner aktif di DB uji, sumber recipe→product dan `inventory_consumed`, target integer, jumlah root, bukti, dan operation UUID. Semua root split + FROZEN_IN + frozen_lot_positions + shaping header dibuat dalam **satu transaksi** dan digagalkan seluruhnya jika validasi gagal.
- Fungsi `refresh_tracked_batch_progress` menghitung hasil dari root split (target frozen+direct+reject), seluruh DIRECT hasil baking termasuk turunan, dan saldo FROZEN dari ledger, menolak selisih sumber. `status='Finished'` hanya jika tidak ada DIRECT yang belum baked dan tidak ada sisa frozen. Jumlah finished/reject sinkron pada parent `production_batches`.
- `AFTER INSERT` recorded shaping dan baking operation memanggil refresh status parent; jika perhitungan gagal, transaksi dibatalkan. Split turunan dari frozen tidak menambah angka target lagi.
- Writer gate CI diisolasi diperluas untuk FROZEN_IN. Deferred check membuktikan `FROZEN_IN` mempunyai shaping header, split root frozen yang benar dan posisi frozen yang nilainya memenuhi **original frozen = sisa frozen + total konversi**. Ini penting jika shaping/frozen conversion/baking diperiksa di transaction commit.
- Pengujian SQL `tests/sql/accounting-shaping-batch-e2e.sql`: campuran target 10 (frozen 6, direct 3, reject shaping 1) → direct baked 2 good+1 reject; frozen diolah 4→3 good+1 reject; sisa 2 frozen→2 good; final 7 good+3 reject=10, status Finished. Direct-only, frozen-only, reject-only, wrong recipe, no material consumption, idempotent replay juga diuji.
- **Tes race dua sesi PostgreSQL** `tests/sql/accounting-shaping-race.*`: dua user mencoba melakukan shaping batch yang sama dengan isi berbeda. Baris parent dikunci dan hanya satu operasi bisa merekam split dan stok FROZEN_IN; tidak ada lot ganda atau operasi gagal yang tertinggal.
- `src/utils/accountingStockWriterReadiness.js`: shaping kini prototipe keempat dari 9 writer. `tests/hppStockWriterReadiness.test.js` membuktikan status kesiapan masih **0 live integrations**, cutover remains blocked. Halaman Owner persiapan saldo awal membaca daftar yang sama dan tidak memiliki tombol aktivasi.

## Pengujian terbukti
- GitHub Actions isolated PostgreSQL 16 multi-stage lifecycle + two-session shaping competition: PASS.
- Existing SQL accounting reports, lot release, writer gate, frozen conversion, baking, and two-session freezer concurrency: PASS.
- **281/281 JavaScript tests PASS**, eslint, Vite production build, Deno Edge check PASS.
- Run validasi: https://github.com/bunbunkitchen/bunbun-os/actions/runs/41398807660
- Run accounting ledger: https://github.com/bunbunkitchen/bunbun-os/actions/runs/41398807937

## Masih menghalangi go-live
1. Source data perolehan bahan/historical inventory dan pengesahan opening balance belum lengkap; `inventory_consumed=true` dalam tes adalah flag sintetis, **bukan bukti HPP aktual**.
2. `record_tracked_shaping_staging`/baking/frozen dibuat dengan argumen `actor_id` dan wajib dibungkus trusted backend yang memverifikasi JWT/session Owner secara nyata dan re-fetch bukti. Jangan memberi akses langsung ke client.
3. Modul shaping/baking baru belum tersambung ke UI operasional atau RPC existing, belum uji Supabase Auth/RLS nyata. Belum ada staging cloud independen.
4. Model saat ini masih prototype untuk record_shaping_split, release_frozen_stock, record_baking_result dan record_multi_product_release. Penjualan otomatis, pembatalan/edit, retur, stock adjustment, pengeluaran satu produk dan kemungkinan writer via UI lain **belum terintegrasi**.
5. Pengakuan biaya frozen/reject/produksi ke buku besar masih membutuhkan dokumen aktual dan approval. Tidak boleh ada jurnal HPP/pendapatan hanya karena produk dikirim ke kafe.
6. Gate `ON` **dilarang pada Supabase produksi** sampai setiap stock writer dan invarians lama telah terintegrasi, diuji, dan cutover Owner resmi disahkan.

**Tidak ada perubahan pada `main`, Supabase production atau saldo stok aktif selama pengerjaan ini.**