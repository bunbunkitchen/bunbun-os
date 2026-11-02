# Bunbun OS — Supabase Isolated Staging, Owner Auth & Opening Cost Runbook

**STATUS 2026-11-02: STAGING CLOUD BELUM DIBUAT; PENAWARAN BIAYA MENUNGGU KONFIRMASI EKSPILISIT.** Semua file SQL `docs/sql/accounting-*-staging.sql` masih prototipe laboratorium; jangan langsung diterapkan pada Supabase production ataupun staging tanpa rekonsiliasi skema.

## 1. Proyek dan biaya
- Organisasi Supabase yang terhubung: `Bunbun Kitchen` (Free), project produksi `bunbun-os` di `ap-southeast-1` dengan PostgreSQL 17.6. Hanya satu project terdeteksi, **tidak ada branch**. Tidak ada staging baru saat audit.
- `get_cost` menunjukkan **standalone project US$0/bulan** untuk organisasi tersebut saat pengecekan; development branch berbeda, **US$0.01344/jam**, belum termasuk pemakaian lain. Backend Supabase tetap meminta **cost confirmation ID walaupun biaya proyek ditampilkan US$0**. Jangan memanggil `confirm_cost` hingga pengguna secara eksplisit menyetujui penawaran itu.
- Pilih **project baru bernama `bunbun-os-staging` di organisasi yang sama, region `ap-southeast-1`**, setelah konfirmasi. Catat project ref baru lalu pastikan TIDAK sama dengan ref produksi `amgyogvqyuxzdpjseqsi`. Never use a production service key in staging.
- Jangan membuat branch berbayar, mengubah subscription, atau mengimpor data bisnis pribadi tanpa persetujuan terpisah. Ini bukan instruksi otomatis untuk deploy.

## 2. Audit skema sumber dan baseline
- SQL yang sudah dijalankan read-only: `docs/sql/accounting-production-staging-preflight-readonly.sql`. Di produksi ada **semua sembilan legacy RPC**, semua kolom yang wajib untuk source audit, 0 beda antara cache stock dan saldo gerakan, 51 penjualan aktif tanpa `operation_key`, 136 CAFE_OUT tanpa `sale_id`, serta 2356/2356 `PRODUCTION_OUT.unit_value=NULL`. Angka audit saat ini **bukan nilai HPP**, dan dapat berubah.
- Database asli PG17.6. Test isolasi CI diperluas untuk PG16 dan PG17. Tetap wajib uji fitur pada skema/trigger/RLS real setelah staging ada.
- **Penting: folder `supabase/migrations` pada repo hanya berisi dua file September 2026**, sedangkan riwayat migrasi produksi mencakup enam entries sejak Agustus. Folder `database/` memuat potongan DDL historis, namun **belum menjadi baseline yang bisa diputar ulang dari nol dan dijamin identik produksi**.
- Untuk project staging baru: ekspor **schema-only** yang direview dari database produksi menggunakan alat resmi melalui koneksi lokal aman. Pastikan hanya DDL yang diperlukan, tanpa rows, Auth user/password, data transaksi, storage objects, atau secrets. Jangan berasumsi `supabase db push` dengan dua migration files bisa membangun seluruh schema.
- Audit object dependency/owners/permissions, ownership `security definer`, check constraints, triggers `trg_refresh_finished_product_stock_balance`, `prevent_sub_recipe_finished_stock_before_insert`, `set_automatic_split_lot_code`, type enums, RLS, dan fungsi sembilan RPC. Uji kesamaan hasil metadata preflight dari production dan staging sebelum mengaplikasikan akuntansi.
- Script SQL prototipe termasuk `DROP TRIGGER`, `CREATE/REPLACE FUNCTION`, dan penyuntingan CHECK constraint; **tidak boleh diputar langsung ke skema nyata** sebelum review diff, transaksi rollback, dan rencana migrasi terurut khusus PostgreSQL17.

## 3. Security Advisor — perlu diuji di staging
- Produksi menghasilkan warning advisor `anon_security_definer_function_executable` (9 objek), termasuk RPC `record_product_stock_adjustment` yang dapat dieksekusi sebagai role `anon` menurut ACL metadata. Jangan simpulkan eksploit otomatis, tetapi akses ini **harus ditutup dan dites** di staging. Draf perbaikannya harus menjaga Owner autentikasi dan dependensi trigger, bukan memutus operasional produksi.
- Advisory lain: 20 fungsi `SECURITY DEFINER` executable oleh `authenticated` (bisa memang disengaja, harus diuji RLS + pemeriksaan `auth.uid()`), 2 fungsi helper `search_path` mutable, dan konfigurasi perlindungan password bocor. Gunakan `get_advisors` setelah setiap migrasi dan bahas pengecualiannya.
- Referensi: https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable dan https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable.
- Private schema harus tetap tidak diekspos API umum dan `service_role` tidak pernah masuk kode frontend, GitHub artifacts/logs atau file `.env` yang di-commit.

## 4. Auth Owner asli — tes yang disiapkan, belum dijalankan remote
- Backend `supabase/functions/accounting-owner-readiness/index.ts` ada di PR, **belum di-deploy**. Ia memverifikasi JWT lewat Supabase Auth `getUser`, lalu memuat ulang `profiles.role` dan `profiles.is_active`. Response Owner sengaja `BLOCKED_PENDING_CUTOVER` (read only, tidak bisa posting). Semua endpoint posting tetap disabled.
- `scripts/staging/owner-auth-smoke.mjs` dan `scripts/staging/stagingTarget.mjs` menolak URL/ref produksi, memerlukan publishable key staging dan origin staging yang cocok; kemudian mengetes credential akun **dummy yang dibuat khusus staging**: Owner aktif → 200, Baker → 403, Owner nonaktif → 403, anonymous dan token palsu → 401. Tidak ada perubahan data.
- Jalankan hanya sesudah project staging ada, backend staging-only dan tiga akun dummy terpisah disiapkan, URL frontend dan allow-list CORS benar, dan Cloud Edge config `verify_jwt=true`.
- Jangan memasukkan email/password atau secret project produksi ke chat. Gunakan protected secrets GitHub Environment atau vault tim. Tool ini tidak membuat user baru dan tidak menggunakan service_role key untuk pemeriksaan login.
- Perintah setelah penyiapan environment: `node scripts/staging/owner-auth-smoke.mjs`. Jika staging/project credentials tidak lengkap atau ref sama produksi, skrip **gagal tertutup**.

## 5. Saldo awal (opening) — daftar bukti dan keputusan
- Tetapkan tanggal cutover yang **akan datang** setelah opname, pemetaan kewenangan Owner dan pengujian rollback; jangan menetapkan tanggal saat ini otomatis.
- Isi `docs/templates/accounting-opening-stocktake.csv` dengan hasil **opname fisik** per jenis: bahan baku, WIP, frozen, finished di dapur, dan barang titipan kafe; jangan mencampur lokasi. Lot sumber/batch/tanggal/jumlah/unit dan nilai rupiah wajib punya bukti yang dapat ditelusuri.
- Isi `docs/templates/accounting-actual-cost-evidence.csv`: invoice bahan, konversi dan qty, harga perolehan aktual, alokasi gaji/overhead tanpa double expense, biaya produksi/reject dan review Owner. **Harga master bahan pada resep tetap sebagai master HPP rencana**, bukan bukti otomatis perolehan aktual.
- Awal neraca membutuhkan hasil hitung kas, saldo rekening, piutang yang dikonfirmasi kafe, utang supplier, aset dan kewajiban. Seluruh jurnal opening harus balance, dan **DRAFT sampai approve Owner**.
- Untuk pemakaian bahan historis, 2356 mutasi `PRODUCTION_OUT` aktif tidak menyimpan `unit_value`, jadi jangan membuat angka aktual/COGS berdasarkan harga pembelian rencana tanpa bukti. Jika biaya dan saldo tidak bisa dipulihkan dengan audit, tandai `UNVERIFIED`, jangan otomatis nol.
- Produk keluar kafe adalah perpindahan stok ke konsinyasi, bukan otomatis penjualan. Catatan `incomes` OS sudah merupakan **setoran bersih hak Bunbun**, sehingga **jangan** potong lagi 30%. Setoran melunasi piutang yang sudah diakui, **bukan** pendapatan kedua.
- Pengeluaran uang pembelian bahan, upah, dan maintenance harus diklasifikasi sesuai akuntansi dan relasi `purchase_id`. Jangan menggandakan biaya saat membuat HPP actual dan pengeluaran kas.

## 6. Hanya jika tahapan di atas selesai
- Backup schema + data staging, jalankan SQL migration dari repo yang direview dalam transaksi, cek delta metadata dan rollback.
- Uji sembilan writer pada **real PG17 schema**, dengan data dummy dalam staging: shaping→frozen→baking→cafe delivery→sale→return/edit→adjustment, termasuk negative tests dan 2 koneksi bersamaan; pastikan trigger balance material, `production_batch_splits`, `finished_product_stock_balances` dan release frozen sesuai.
- Uji Owner/Baker/Helper/anon/inactive, RLS, metadata spoof, idempotency, payload malformed dan akses audit; recheck Supabase security advisor. `lot_tracking_control.mode` tetap OFF hingga ready.
- Baru setelah audited stocktake, unit costs, post/reversal journal, dan cutover approval: jalankan tampilan Owner actual laba rugi. Closed period dan laporan yang sudah direkonsiliasi bukan angka simulasi.

## Status sekarang
| Komponen | Status |
|---|---|
| Read-only audit struktur produksi & gap HPP | SELESAI |
| CI PG16+PG17 gabungan 9 keluarga stock writers | SELESAI |
| Script smoke test staging-only Owner Auth | DISIAPKAN, BELUM LIVE |
| Proyek staging terpisah | BLOCKED: konfirmasi cost $0 diperlukan |
| Baseline schema/trigger real ke staging | BELUM |
| Auth Owner/Baker nyata di staging | BELUM |
| Opname + cost evidence approved dan ledger posting | BELUM |
| Laba rugi aktual production | TETAP DISABLED |

**Tidak ada perubahan pada production Supabase ataupun branch `main`.**