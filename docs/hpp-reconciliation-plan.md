# Bunbun OS — Rekonsiliasi HPP Aktual

Status: Draft / hanya untuk staging, belum diterapkan ke Supabase produksi.

## Prinsip
Pisahkan harga master resep untuk pricing dan biaya persediaan akuntansi. Persediaan memakai moving weighted average berdasarkan total biaya di Purchasing, bukan harga master.

## Temuan audit 2 November 2026
- 2.356 PRODUCTION_OUT aktif tidak memiliki unit_value.
- 149 PURCHASE inventory aktif memiliki tautan pembelian yang valid dan bahan yang cocok.
- 3 pembelian tertaut bernilai total nol: Gula Pasir (purchase 14), Susu Bubuk Indomilk (31), Keju Shred Emina (122). Jangan otomatis anggap gratis.
- 15 bahan mulai dipakai sebelum pembelian pertama tercatat; 3 dipakai tanpa pembelian yang tercatat.
- 10 ADJUSTMENT_IN belum bernilai, dan 23 PRODUCTION_IN sub-recipe belum bernilai.
- Biskuit Biscoff master pc namun transaksi pembelian gr; perlu verifikasi tanpa mengubah satuan otomatis.
- Ada 429 split aktif, termasuk split turunan; jangan jumlahkan seluruh split sebagai hasil akhir tanpa memeriksa source_split_id.

## Urutan sebelum cutover
1. Pilih tanggal cutover, verifikasi jumlah dan nilai stok awal per bahan dari opname dan dokumentasi.
2. Klasifikasikan pembelian nol: benar-benar gratis, bonus, pemindahan stok atau kesalahan input; simpan sumber bukti.
3. Untuk stok non-pembelian yang sudah punya unit_value, nilai masuk = qty x unit_value dalam satuan transaksi, bukan satuan master.
4. Tetapkan dasar valuasi atas koreksi stok masuk historis sebelum perhitungan biaya di periode sesudahnya.
5. Biaya sub-recipe harus berasal dari produksi sub-recipe atau sumber sah; jangan menciptakan nilai persediaan dari nol.
6. Jalankan MWA di ledger terpisah. Verifikasi urutan transaksi pada tanggal yang sama, terutama data backfill.
7. Rekonsiliasi stok kuantitas ke ledger aktif setelah memperhitungkan transaksi yang di-soft-delete.
8. Hitung labor, gas, serta overhead produksi berdasarkan biaya yang benar-benar terjadi dan klasifikasi yang disetujui.
9. Finalisasi HPP batch hanya setelah nilai bahan dan output finished/frozen/split tervalidasi; setelah itu desain posting jurnal dan rollback.

## Modul pada draft PR
- src/utils/hppHistoricalValuation.js: algoritme audit MWA tanpa penulisan database.
- src/services/hppHistoricalValuationService.js: adapter Supabase read-only per bahan.
- src/components/hpp/HistoricalInventoryAudit.jsx: tampilan daftar kendala per bahan.
- tests/hppHistoricalValuation.test.js: kasus uji opening, harga pembelian, adjustment, sub-recipe, satuan dan saldo negatif.

## Keamanan data
Jangan mengubah harga master, total pembelian, unit_value historis, stok aktif, atau laporan lama secara otomatis. Jangan menganggap saldo awal nol tanpa verifikasi. Draft PR tidak boleh di-merge ke main sebelum uji staging dan review Owner.