# Bunbun OS — Single Cafe Release + Finished Stock Adjustment (DRAFT SQL, CI ONLY)

**STATUS: 9 dari 9 writer mempunyai prototipe isolated PostgreSQL. 0 dari 9 terintegrasi dengan aplikasi aktif.** Dokumen/SQL ini BUKAN migration yang siap dijalankan ke Supabase, BELUM ada staging cloud independen, dan tidak mempunyai validasi fisik/Owner sebenarnya. Bunbun `main` dan Supabase produksi tidak diubah.

## 1. Pengeluaran satu produk ke kafe
- Prosedur lama `public.record_cafe_deposit` mengeluarkan `CAFE_OUT` satu produk per permintaan, tetapi tanpa ID lot produksi. Produk konsinyasi **bukan** pendapatan maupun COGS terjual, dan nama prosedur `deposit` dalam hal ini adalah setoran **produk**, bukan uang.
- `docs/sql/accounting-single-cafe-lot-staging.sql`: private prototype `record_single_cafe_release_staging` meneruskan satu produk dan satu atau beberapa ID lot secara atomik ke mesin `record_lot_assigned_release`, sama dengan pengeluaran multi-produk. Karena satu source engine, tidak ada rumus stok yang dibuat dua kali. CAFE_OUT source movement berisi `sale_id NULL` dan tidak menimbulkan jurnal, kas, atau revenue.
- `tests/sql/accounting-single-cafe-lot-e2e.sql`: pengeluaran 6 unit Original dari dua lot berjumlah 10, saldo 4, dua per-lot allocation, replay UUID idempotent, cek owner nonaktif/role lain, partial allocation, overdraw dan operation key reused with different payload.

## 2. Stock Adjustment produk jadi, tetap terpisah dari cashflow dan HPP resep
- Prosedur asli `public.record_product_stock_adjustment` sudah memiliki input owner, alasan, notes dan operasi masuk/keluar. Perlu ditambah jejak lot agar sesudah cutover stok produk sesuai catatan lot.
- `docs/sql/accounting-product-adjustment-staging.sql`: schema private untuk header dan detail alokasi per lot, immutable audit, tipe `ADJUSTMENT_OUT` dan `ADJUSTMENT_IN` pada fixture, penolakan legacy writer, serta deferred checks: saldo stok produk = total saldo lot, dan untuk setiap lot berlaku `stok awal − saldo saat ini = pengeluaran ke kafe + penyesuaian OUT − penyesuaian IN` pada fixture terpisah ini.
- `docs/sql/accounting-product-adjustment-operations-staging.sql`: hanya Owner via backend tepercaya; validasi qty, tanggal cutover, alasan, notes, evidence, operation UUID, produk aktif, lot, dan stok fisik. `OUT` mengurangi dari lot asal secara atomik. `IN` hanya **pembalikan penuh dari satu OUT sebelumnya**, ke lot yang **sama persis**, dengan referensi bukti menemukan kembali barang layak jual. Tidak mendukung menambah stok tanpa asal yang terbukti, tidak memindahkan stok dari lot penjualan, dan tidak membuat pseudo opening lot baru.
- Alasan, catatan, dan nomor bukti juga ditulis pada movement. `cash_posted:false`, `recipe_hpp_changed:false`, `accounting_posted:false`, `source_cost_review_pending:true`. Kerugian/stock gain perlu jurnal valuasi dan persetujuan sebelum laba rugi riil dapat diterbitkan.
- `tests/sql/accounting-product-adjustment-e2e.sql`: OUT 4 unit (3+1 dari dua lot), shipment ke kafe 2 unit, IN 4 unit yang mengembalikan lot asal sesuai audit, shipment lanjutan, exact stock-balance conservation; menolak IN tanpa sumber, non-Owner, jumlah alokasi tidak cocok, replay berubah, double IN dan stok yang tidak bisa dikurangi.
- `tests/sql/accounting-adjustment-race.sh` + two-session SQL: dua transaksi OUT masing-masing mengambil 4 unit dari lot yang berisi 6; baris produk dikunci. Hanya satu berhasil, dan yang kalah tidak meninggalkan header/stock movement yatim.

## Batasan keamanan dan data
1. Penerimaan alasan, catatan dan `evidence_ref` adalah **klaim dari parameter**, bukan verifikasi fisik independen. Backend harus memeriksa ulang bukti barang, status pangan aman dan persetujuan Owner dengan JWT/session aktif. `service_role` tidak boleh masuk frontend.
2. **Penambahan barang yang tidak punya lot atau pembalikan adjustment OUT** (misalnya kelebihan hasil opname) memerlukan workflow *verified surplus intake/quarantine*, identitas sumber, valuasi/biaya, dan approval Owner yang terpisah. Prototipe ini memilih **memblokir** kasus tersebut agar HPP tidak dibuat secara fiktif. Kelak UI Stock Adjustment perlu menjelaskan pilihan tersebut secara ramah.
3. Produk yang sudah terjual, dikonsumsi, rusak, kedaluwarsa atau diserahkan ke kafe tidak boleh ditambahkan kembali hanya dengan memilih `IN`. Prosedur retur fisik dan loss/gain finansial terpisah.
4. Setiap stage SQL yang tersedia saat ini masih memperluas/menimpa writer gate yang sama **dalam database uji yang berbeda** (shaping/frozen, sales, adjustment). Walaupun kesembilan writer punya prototipe, **belum ada satu gate universal** yang diuji untuk seluruh lifecycle sekaligus. Ini adalah blocker utama berikutnya.
5. Field `original_qty` dan lot posisi dalam CI adalah sintetis. Harga bahan master tetap untuk perencanaan HPP; harga purchasing historis/actual, raw material, labor, overhead, reject dan opening harus direkonsiliasi sebelum laba aktual.
6. Setoran kafe yang dimasukkan dalam OS sudah merupakan jumlah hak Bunbun; jangan mengurangi 30% sekali lagi. `CAFE_OUT` delivery dan `INCOME` cash deposit adalah dua peristiwa berbeda; tidak boleh double-revenue.
7. Tidak ada migrasi produksi, tidak ada penyesuaian kas maupun mutasi stok real. Semua fungsi adalah `security invoker` private schema, service_role CI-only; tidak tersambung ke UI aktif atau Supabase Auth sungguhan.

## Urutan tahap selanjutnya
1. Satukan writer gate serta deferred constraints untuk seluruh 9 jalur, termasuk override stok material/historis. Semua **tidak bisa langsung diaktifkan** pada Supabase karena jalur lama masih berjalan.
2. Rancang opname fisik & `verified surplus intake` untuk penambahan baru, termasuk penahanan stok yang belum punya nilai biaya. Tetapkan persetujuan Owner, approved cutover dan penolakan data historis yang tidak bisa dibuktikan.
3. Uji integrasi real Supabase staging yang independen: JWT Owner/Baker, RLS, lama+baru, double-submit, race, soft delete, rollback, UI dan backup. Belum boleh memasang migrasi ke Supabase produksi.
4. Hanya transaksi posted, valuasi inventory dan revenue cafe entitlement yang terverifikasi bisa membuka dashboard laba rugi aktual.

**Draft PR #1 tetap draft, `main` dan database produksi tidak diubah.**