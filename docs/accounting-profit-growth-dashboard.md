# Bunbun OS — Laba Rugi & Dashboard Keuntungan–Pertumbuhan

**Status: kode baru ada di Draft PR staging. BELUM dideploy, belum digabung ke `main`, dan BELUM menampilkan laba aktual.**

## Tujuan dashboard Owner
Halaman baru **Keuntungan & Pertumbuhan** tersedia di route `/finance/business-health`, khusus Owner. Menampilkan pendapatan yang menjadi hak Bunbun, HPP produk terjual, laba kotor, beban periode, laba bersih, margin laba, kas akhir, pertumbuhan bulanan dan tren enam bulan. Dilengkapi laporan P&L terinci, kas operasional/investasi/pendanaan, posisi keuangan dan CSV. Menggunakan palet sage/cream.

## Arsitektur sumber data
- `src/utils/accountingBusinessHealth.js`: menghitung KPIs, marjin, dan perbandingan MoM dari laporan akuntansi yang telah lolos pemeriksaan debit–kredit dan arus kas pada server. Tidak memakai `sales - expenses` dari cashbook lama.
- `src/components/accounting/FinancialTrendChart.jsx`: SVG tren enam bulan; bulan kosong adalah gap, BUKAN laba nol.
- `src/pages/finance/OwnerBusinessHealth.jsx`: UI Owner, pemilih bulan, P&L, cashflow, neraca, tren dan mode ilustrasi dengan peringatan eksplisit.
- `src/services/accountingBusinessHealthService.js`: memanggil `accounting-owner-monthly-report` **hanya jika client berada di Supabase staging yang terpisah dan flag staging diaktifkan**. Bila masih memakai Supabase produksi, status menjadi `STAGING_NOT_CONFIGURED` dan TIDAK mengakses endpoint laporan.
- `supabase/functions/_shared/accountingPrivateLedgerRead.js`: sekarang mengikutsertakan `cutover_date` dari saldo awal yang disahkan, untuk menentukan apakah bulan pertama merupakan periode parsial.
- `supabase/functions/_shared/accountingOwnerMonthlyReport.js`: menyertakan cutover date dalam respons setelah verifikasi validitas tanggal, seluruh penghitungan keuangan, pembatasan Owner aktif, dan kesiapan jurnal.

## Aturan bisnis
- Pendapatan adalah hak Bunbun terverifikasi; **bukan** omzet kafe bruto, setoran baru yang sudah diakui sebagai piutang, atau nilai seluruh barang titipan.
- HPP hanya untuk barang yang benar-benar terjual. Pembelian bahan yang masih tersedia tetap persediaan dan tidak otomatis mengurangi laba pada bulan pembelian.
- Laba bersih = Pendapatan hak Bunbun − HPP barang terjual − beban periode. Margin kotor = laba kotor / pendapatan; margin bersih = laba bersih / pendapatan.
- Arus kas terpisah dari laba rugi: kas awal + operasi + investasi + pendanaan = kas akhir.
- Neraca: aset = kewajiban + ekuitas. Keseimbangan matematis tidak membuktikan dokumen sudah lengkap.
- Pertumbuhan pendapatan/laba bulan ke bulan **hanya** ketika dua bulan berturutan berstatus CLOSED, waktunya penuh (sesudah cutover sejak tanggal 1) dan bukan bulan kalender berjalan. Bila tidak valid, tampil `—` beserta alasan.
- Margin saat revenue nol `—`, bukan angka nol persen palsu. Pertumbuhan saat basis sebelumnya nol atau laba sebelumnya <= 0 juga `—`.
- Simulasi menggunakan angka fiktif yang selalu ditandai `SIMULASI — BUKAN LABA AKTUAL`. Tidak ada data demo dimasukkan ke Supabase.
- Semua respons staging tetap diberi label `sourceAudited:false`, `sourceCompletenessVerified:false`, `readyForBonusDecision:false`, `readyForExpansionDecision:false`, `mayPost:false` sampai ada mekanisme pengesahan terpisah.
- Dashboard tidak mengaktifkan posting jurnal, mengubah saldo, mengubah stok, atau mengubah HPP.

## Langkah aktivasi selanjutnya (belum dilakukan)
1. Siapkan proyek Supabase staging terpisah dengan approval biaya bila ada. Proyek Bunbun produksi tidak digunakan untuk uji migrasi.
2. Jalankan migrasi resmi di staging dan uji RLS, JWT Owner, database private ledger, audit trail dan integrasi data transaksi yang benar.
3. Owner sahkan stok opname, saldo kas/bank, piutang, utang, WIP, finished, frozen, titipan kafe dan tanggal cutover.
4. Verifikasi stock layer dan HPP, penjualan kafe dan settlement, biaya produksi vs biaya periode, rekonsiliasi harian/bulanan.
5. Baru kemudian sambungkan laporan sesungguhnya dan pertimbangkan merge/release terkontrol. Bonus dan ekspansi hanya setelah kelengkapan bukti disahkan.

## Uji
- Tes baru `tests/hppBusinessHealth.test.js`: laba, HPP, gross/net margin, pertumbuhan bulan penuh, bulan parsial, bulan berjalan, data tidak ada, basis nol/rugi, respons staging palsu, ketidakseimbangan keuangan, serta mode demo.
- Tests juga diperbarui untuk menolak cutover date yang tidak valid. Semua perubahan dilindungi pipeline GitHub Actions (Node tests, eslint, build, Deno typecheck, PostgreSQL 16 E2E).

**Tidak ada laba aktual yang diklaim dari angka historis maupun simulasi.**