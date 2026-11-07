> Pembaruan 2026-11-02: staging independen telah aktif dan pengujian real-schema ledger serta sembilan stock writers lulus dalam transaksi rollback. Status mutakhir: [runbook](accounting-staging-implementation-runbook.md). Uraian keterbatasan staging belum ada di bawah adalah riwayat tahap CI, bukan kondisi sekarang. Belum ada aktivasi produksi atau HPP aktual.

# Bunbun OS — Uji End-to-End Transaksi Bakery dan Laporan Akuntansi

> STATUS: STAGING TEST ONLY. Seluruh nominal di bawah adalah **simulasi** dan BUKAN laba atau omzet Bunbun yang sesungguhnya.

## Lingkungan pengujian
- Per 2 November 2026, akses Supabase yang tersedia hanya mencantumkan proyek `bunbun-os` yang sedang aktif. **Belum tersedia proyek Supabase staging terpisah.**
- Karena itu, SQL dijalankan hanya pada PostgreSQL 16 **sementara** di GitHub Actions, tidak pada Supabase pengguna.
- `docs/sql/accounting-schema-review.sql` dan `docs/sql/accounting-posting-staging.sql` tetap proposal, **bukan migrasi resmi**, belum diuji dalam proyek Supabase staging asli.
- `docs/sql/accounting-reports-staging.sql` adalah view laporan `security_invoker` di schema privat. Hanya membaca baris jurnal `POSTED`, bukan cashbook historis.
- Alur uji: `tests/sql/accounting-bakery-lifecycle.sql`; workflow `.github/workflows/accounting-postgres-staging.yml` dan `.github/workflows/hpp-staging-checks.yml`.

## Skenario uji terisolasi
Seluruh jumlah berikut adalah contoh untuk menguji aturan, bukan data riil:

| Peristiwa | Nilai | Perlakuan akuntansi |
|---|---:|---|
| Saldo awal bank dan bahan baku | Rp1.000.000 + Rp200.000 | Aset awal, bukan pendapatan |
| Pembelian bahan secara kredit | Rp150.000 | Persediaan naik dan utang naik |
| Pembayaran utang sebagian | Rp100.000 | Kas turun, utang turun |
| Pemakaian bahan ke WIP | Rp120.000 | Perpindahan aset bahan → WIP |
| Produk selesai | Rp120.000 | WIP → produk jadi, belum ada pendapatan |
| Barang titipan yang dikirim ke kafe | Rp100.000 nilai HPP | Produk jadi → persediaan titipan, belum jadi penjualan |
| Barang titipan yang terjual | Rp60.000 nilai HPP | Titipan turun, HPP terjual naik |
| Pendapatan yang menjadi hak Bunbun dari penjualan tadi | Rp150.000 | Piutang naik, pendapatan naik sekali |
| Setoran kafe sebagian | Rp90.000 | Piutang turun, bank naik; **bukan pendapatan kedua** |
| Gaji beban periode | Rp20.000 | Beban naik, bank turun |
| Transfer bank ke uang tunai | Rp10.000 | Tidak menjadi arus kas eksternal |

## Hasil yang harus cocok
- **Laba rugi:** pendapatan Rp150.000 − HPP Rp60.000 − beban Rp20.000 = laba Rp70.000.
- **Kas:** Rp1.000.000 − Rp100.000 + Rp90.000 − Rp20.000 = Rp970.000, terpisah dari laba.
- **Aset akhir:** bank+kas Rp970.000; bahan baku Rp230.000; produk jadi Rp20.000; titipan belum terjual Rp40.000; piutang Rp60.000; total **Rp1.320.000**.
- **Kewajiban:** utang pembelian tersisa Rp50.000.
- **Ekuitas:** ekuitas awal Rp1.200.000 + laba Rp70.000 = Rp1.270.000.
- **Neraca seimbang:** aset Rp1.320.000 = kewajiban Rp50.000 + ekuitas Rp1.270.000.
- Ada jurnal penjualan simulasi ekstra Rp999.999 yang masih `DRAFT`; angka itu tidak boleh masuk laporan.
- Pengulangan perintah posting setoran yang sama tidak boleh menghasilkan audit ganda.

## Pengaman yang sudah diuji di PostgreSQL sementara
- Tidak mengizinkan posting normal sebelum saldo awal `POSTED`.
- Owner aktif dan periode `OPEN` dibutuhkan untuk fungsi posting.
- Baris debit-kredit yang tidak sama, pengakuan arus kas tanpa kategori, aliran kas campur, dan reversal palsu ditolak.
- Jurnal final dan snapshot saldo awal yang disahkan tidak dapat diedit seperti draft biasa.
- View privat hanya membaca jurnal berstatus `POSTED`.
- Alur stok titipan tidak otomatis menimbulkan pendapatan/HPP sampai benar-benar terjual.

## Belum dapat diklaim selesai
1. **Supabase staging belum tersedia.** Pengujian PG 16 ini tidak membuktikan RLS dan konfig Supabase asli.
2. Belum ada endpoint backend dengan verifikasi session Owner dan penjagaan service_role secret.
3. Belum ada mesin yang menautkan tiap sumber event ke data `sales`, `incomes`, `expenses`, `inventory_transactions` dan `product_stock_movements` secara otomatis dan akurat.
4. Belum ada rekonsiliasi unit produksi dan stok aktual, MWA bahan pasca-cutover, biaya tenaga kerja/overhead, dan produk rusak/retur secara lengkap.
5. Belum ada jurnal `POSTED` produksi, tanggal cutover yang disetujui, maupun laporan laba aktual. Ekspansi dan bonus tidak boleh dihitung dari angka simulasi.

## Selanjutnya
- Siapkan lingkungan Supabase staging terpisah tanpa menyalin data sensitif produksi sembarangan.
- Uji RLS dan backend posting di staging, buat migrasi resmi melalui Supabase CLI, dengan rollback.
- Setelah hasil stok opname dan kas/bank disahkan Owner, uji cutover dengan data yang benar.
- Kemudian aktifkan laporan Owner dan dashboard Business Health menggunakan jurnal aktual yang telah lolos rekonsiliasi.