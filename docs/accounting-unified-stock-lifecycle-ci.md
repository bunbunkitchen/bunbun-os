> Pembaruan 2026-11-02: staging independen telah aktif dan pengujian real-schema ledger serta sembilan stock writers lulus dalam transaksi rollback. Status mutakhir: [runbook](accounting-staging-implementation-runbook.md). Uraian keterbatasan staging belum ada di bawah adalah riwayat tahap CI, bukan kondisi sekarang. Belum ada aktivasi produksi atau HPP aktual.

# Bunbun OS — Integrated 9-Writer Stock Lifecycle (PostgreSQL CI, NOT Production)

**Klasifikasi: SQL integration design + disposable PostgreSQL 16 tests. TIDAK BOLEH DEPLOY LANGSUNG.**

## Tujuan
Menjalankan seluruh jalur stok Bunbun dalam **satu instance database yang sama**, dengan satu peraturan untuk `INSERT` stok dan satu **deferred constraint** yang memeriksa mutasi, alokasi lot dan saldo sebelum transaksi COMMIT. Prototipe sebelumnya diuji terpisah dan mendefinisikan ulang fungsi gate yang sama, sehingga belum boleh dianggap terintegrasi.

## Komponen yang disatukan
- `docs/sql/accounting-unified-stock-gate-staging.sql`: **satu** fungsi `enforce_lot_stock_writer()` (sebelum mutasi) serta **satu** deferred constraint trigger pada `public.product_stock_movements` bernama `verify_unified_lot_movement_commit`. SQL melepaskan dua constraint trigger lama dari prototipe terpisah dan memasang pengganti yang mendukung semua tujuh movement types: `FROZEN_IN`, `FROZEN_OUT`, `FINISHED_IN`, `CAFE_OUT`, `CAFE_IN`, `ADJUSTMENT_OUT`, `ADJUSTMENT_IN`.
- `docs/sql/accounting-unified-position-protection-staging.sql`: pengaman tambahan pada tabel `finished_lot_positions` dan `frozen_lot_positions`. Setelah cutover simulasi, metadata provenance/lot awal immutable, DELETE dilarang, tidak dapat menambah lot opening palsu, dan setiap perubahan saldo lot diverifikasi kembali pada commit. Langkah ini menjaga agar write langsung ke posisi lot tanpa movement/allocation tidak lolos.
- `tests/sql/accounting-unified-sales-bootstrap.sql`: menggabungkan sales/schema sintetis dengan fixture baking/frozen **tanpa mengisi posisi lot existing dua kali**.
- `tests/sql/accounting-unified-lifecycle-e2e.sql`: menjalankan satu rangkaian lengkap mulai produksi sampai adjustment pada **database yang sama**, memakai fungsi pribadi dan gate yang sama. Mencakup retry, direct write forgery, lot provenance dan hak baca fungsi.
- `tests/sql/accounting-unified-sale-adjustment-race.sh` + file SQL sesi A/B: dua koneksi PostgreSQL sungguhan memperebutkan stok produk identik, **satu melalui sale, satu melalui adjustment**; hanya transaksi yang memiliki saldo cukup boleh berhasil. Ini cross-writer race, bukan sekadar dua transaksi jenis sama.
- `.github/workflows/hpp-staging-checks.yml`: dua job database ephemeral baru (full lifecycle + cross-writer concurrency), tanpa koneksi ke Supabase asli.

## Sembilan keluarga prosedur yang diuji
| Prosedur asal di Bunbun | Jalur movement | Prototipe private di isolated CI |
|---|---|---|
| `record_shaping_split` | FROZEN_IN | `record_tracked_shaping_staging` |
| `release_frozen_stock` | FROZEN_OUT | `record_frozen_to_direct_staging` |
| `record_baking_result` | FINISHED_IN | `record_tracked_baking_staging` |
| `record_cafe_deposit` | CAFE_OUT | `record_single_cafe_release_staging` (delegasi satu mesin multi-lot) |
| `record_multi_product_release` | CAFE_OUT | `record_lot_assigned_release` |
| `record_sale_transaction` | CAFE_OUT + sale_id | `record_sale_with_lots_staging` |
| `update_sale_transaction` | CAFE_IN + CAFE_OUT | `replace_lot_sale_staging` (old ID + new ID) |
| `delete_sale_transaction` | CAFE_IN | `cancel_lot_sale_staging` dengan fisik return |
| `record_product_stock_adjustment` | ADJUSTMENT_OUT + ADJUSTMENT_IN | `record_product_lot_adjustment_staging` |

**9/9 tested source writer families is NOT 9/9 activated OS paths. 0/9 live integrations.** Route-level code masih perlu disambung ke real production UI/RPC, Auth, stocktake, permission dan proper approval.

## Contoh synthetic integration testcase
- Awal fixture Original = 10 finished, produk kedua = 7 finished. Batch produksi contoh target = **10 pcs** yang dibagi menjadi frozen 6, direct 3 dan reject shaping 1.
- Direct dipanggang: 2 layak + 1 reject. Enam frozen dikeluarkan dan baked: 5 layak + 1 reject. Total batch akhir **7 layak + 3 reject = 10**, parent batch `Finished`, dan split turunan frozen tidak menambah target awal.
- Stok awal Original 10 + baking good 7 = 17. Single cafe release 2 → 15. Multi cafe release 1 Original + 1 produk lain → Original 14.
- Sale 3 Original → 11. Cancel dengan bukti pengembalian fisik lot asal → 14. Sale baru 2 Original + 1 produk kedua → Original 12; edit/refund fisik + replacement menjadi 1 Original + 2 produk kedua → Original 13.
- Stock Adjustment OUT 2 Original dari satu lot → 11; IN *reversal* 2 ke lot asal dengan bukti → **Original 13**. Produk kedua berakhir **4**.
- Setiap checkpoint membuktikan `saldo produk = jumlah available_qty seluruh lot`; ledger per lot juga memeriksa `original_qty − available_qty = manual out + sold − sale return + adjustment out − adjustment in`. Frozen source balance harus cocok dengan `FROZEN_IN − FROZEN_OUT` dan jumlah yang sudah dikonversi.
- Penolakan diuji: refund tanpa fisik return, penambahan stok tanpa sumber, malformed source operation, edit saldo lot langsung, ubah identitas/qty lot awal, hapus posisi lot, pengeluaran lebih besar dari saldo, dan konkurensi lintas sale/adjustment.
- Tidak ada jurnal kas, jurnal HPP, revenue, piutang atau pemotongan 30% yang otomatis di-post oleh prototipe ini.

## Blockers wajib sebelum Supabase staging dan produksi
1. File SQL tetap menggunakan fixture **sintetis** dan telah menguji satu database disposable, bukan migrasi aplikatif siap pakai. Uji integrasi tidak otomatis memvalidasi schema produksi lengkap, RLS dan trigger stock balance existing.
2. **Owner JWT/session asli belum divalidasi** oleh trusted backend. Parameter `actor_id`, `evidence_ref`, `physically_returned=true` dan flag `inventory_consumed` pada CI bukan bukti persetujuan. Perlu audit token, izin dan bukti fisik actual; jangan mengirim service_role key ke browser.
3. Validasi stok fisik dan HPP harus dimulai dari opname disahkan, invoice/biaya asli, alokasi tenaga kerja dan overhead serta penanganan reject. Membuat opening lot/positive adjustment yang sumbernya tidak diketahui DILARANG; perlu workflow verified stocktake/surplus intake dan isolasi barang tidak layak jual.
4. Perlu **real Supabase staging independen**, bukti semantik 9 endpoint/API yang existing, cek compatibilities status/order/production/triggers, ACL/RLS, testing migrasi dan rollback, serta uji rekonsiliasi laporan produk keluar dan stok.
5. Pembatalan transaksi historis yang telah masuk buku besar perlu jurnal pembalik POSTED; ketidakadaan barang fisik tidak boleh otomatis mengembalikan stok. Cafe consignment bukan otomatis penjualan. Setoran kafe yang user catat sudah bersih, jangan dikurangi 30% lagi.
6. Saat ini `lot_tracking_control.mode='ON'` HANYA dilakukan oleh tes PostgreSQL disposable. Jangan aktifkan writer gate pada Bunbun production selama prosedur lama masih berlaku.

## Bukti GitHub
- Draft PR: https://github.com/bunbunkitchen/bunbun-os/pull/1
- CI menjalankan semua source SQL pada dua database terpisah (full lifecycle & competing sale/adjustment), tetapi masing-masing database memiliki satu **gabungan** skema yang sama.

**Kesimpulan desain: seluruh sembilan keluarga mutasi kini telah diuji bersama dalam satu sistem transaksi pada PostgreSQL uji. Ini menyelesaikan target validasi integrasi kode, BUKAN pengesahan produksi/HPP aktual.**