# Bunbun OS — Jembatan Validasi Transaksi ke Usulan Jurnal (READ-ONLY)

**Status: PURE JS / DRAFT PR; bukan posting aktual dan belum dihubungkan ke Supabase staging.**

## Tujuan
Rangkaian berikut dipisahkan: `sales` sebagai catatan penjualan, `incomes` sebagai uang masuk/setoran kafe, `purchases` sebagai faktur barang, `expenses` sebagai pembayaran/pengeluaran. Tidak ada kesimpulan langsung `sales - expenses = laba`; keuntungan baru muncul dari ledger POSTED setelah nilai persediaan dan kelengkapan sumber teruji.

## Modul
`src/utils/accountingVerifiedSourceBridge.js` menghasilkan **usulan jurnal DRAFT** dari row sumber asli **berdasarkan ID asli** dan bukti verifikasi. Pencatatan tetap menunggu pemeriksaan langsung oleh backend staging dan approval Owner yang sesungguhnya. Tidak ada akses atau perubahan DB.

### A. Sales → Piutang/Pendapatan (usulan DRAFT)
1. Input: row `sales` (ID, tanggal, channel, total) serta bukti bahwa produk BENAR-BENAR terjual, bukan sekadar `CAFE_OUT` (pengiriman titipan).
2. Rekonsiliasi `recordedBasis=NET_BUNBUN`: `netEntitlement` wajib sama persis dengan nilai sales yang terinput.
3. Rekonsiliasi `recordedBasis=GROSS_CAFE`: `netEntitlement` wajib didukung bukti laporan kafe, positif dan tidak lebih besar daripada total bruto pada sales. Tidak pernah memakai perkalian 70% secara otomatis atau potongan kafe dua kali.
4. Jika tanggal/source proof tidak valid, belum diverifikasi, hilang, atau duplikat, jangan usulkan pendapatan.
5. Proposal: Dr Piutang Usaha (1120), Cr Pendapatan Hak Bunbun (4010). **HPP wajib diverifikasi secara terpisah.**

### B. Setoran Kafe → Pelunasan Piutang (usulan DRAFT)
1. Input: setiap row `incomes` dengan `pemasukan_bunbun` dan tanggal, plus bukti mutasi kas/bank yang telah dicocokkan dan alokasi ke `saleId`.
2. Total alokasi WAJIB sama persis dengan setoran yang terinput. Tiap `saleId` harus sudah terverifikasi pendapatannya.
3. Boleh melunasi secara parsial dan membayar lebih dari satu penjualan dalam satu setoran; total seluruh setoran untuk satu piutang **tidak boleh melebihi** hak Bunbun.
4. Setoran sebelum tanggal penjualan atau piutang tanpa bukti di dalam cakupan bridge ditolak; piutang cutover harus lebih dulu dibuktikan sebagai saldo awal.
5. Proposal: Dr Kas/Bank (1010/1020), Cr Piutang (1120). **Bukan revenue baru.**

### C. Pembelian & Pembayaran → Persediaan / Utang (usulan DRAFT)
1. Hanya `purchases` yang jelas `ingredient_id` dan telah diverifikasi sebagai bahan baku bisa menghasilkan Dr Persediaan Bahan (1210), Cr Utang (2010).
2. `expenses.purchase_id` wajib cocok ID pembelian sumber; total pembayaran boleh parsial tetapi tidak melebihi nilai invoice, dan tidak mendahului tanggal faktur.
3. Proposal pembayaran: Dr Utang (2010), Cr Kas/Bank; **bukan beban HPP kedua**.
4. Maintenance, peralatan/aset, dan beban gaji yang belum diberi klasifikasi sah tetap menjadi blocker, bukan dipaksa ke akun bahan atau HPP.

### D. Persediaan, produksi, HPP — tetap DIBLOKIR
- Modul ini **tidak** memetakan `CAFE_OUT` sebagai penjualan, atau `PRODUCTION_OUT` dengan `unit_value` NULL sebagai HPP nol.
- Belum menghubungkan bahan→WIP→finished/frozen→titipan→HPP barang terjual; memerlukan valuasi biaya dan lot/batch yang dibuktikan pada cutover.
- Pembukuan produksi, gaji, overhead, retur/reject, dan adjustments masih membutuhkan transaksi dan aturan terverifikasi terpisah.
- Semua output mengandung `complete:false`, `approved:false`, `readyToPost:false`, `actualProfitAvailable:false`, `writesDatabase:false` dan blocker eksplisit.

## Kondisi lintas-periode dan bukti
- Bridge ini mengharapkan semua row yang dipasok berada pada periode setelah cutover, termasuk invoice dan penjualannya. Piutang dan utang yang berasal dari SEBELUM cutover harus lebih dahulu dimasukkan sebagai saldo awal terverifikasi, tidak direkonstruksi otomatis.
- Implementasi saat ini memakai `reviewed:true` serta `evidenceRef` **hanya untuk preview/testing**. Flag itu BUKAN tanda tangan digital atau persetujuan Owner, karena nilai dapat dikirim oleh caller. Backend nyata **wajib** mengikat akun Owner dari JWT, mengecek sumber dari DB asli, dan memvalidasi dokumen eksternal secara independen.
- Modul tidak menjamin bahwa semua transaksi original telah dimuat. Backend staging perlu query server-side lengkap, pengecekan referensi dan anti-duplikat transaksional.
- Identitas source keys deterministik: `verified-sale:<id>`, `verified-deposit:<id>`, `verified-purchase:<id>`, `verified-purchase-payment:<id>` untuk idempotensi setelah backend tervalidasi.

## Langkah sebelum aktivasi
1. Buat Supabase staging terpisah (persetujuan biaya jika ada) dan uji RLS/auth sebenarnya.
2. Pastikan setiap source row direfetch melalui backend terpercaya; cocokkan evidence invoices, setoran dan stok.
3. Bentuk valuasi lot produk/WIP/Frozen/Consignment, kemudian usulkan COGS dari barang benar-benar terjual.
4. Buat posting backend atomik yang mengikat transaksi sumber, saldos awal, owner authorization dan audit trail.
5. Hanya setelah jurnal POSTED lengkap dan review kelengkapan sumber disetujui, izinkan dashboard menampilkan laba aktual untuk keputusan bisnis.

## Tes
- `tests/hppVerifiedSourceBridge.test.js`: sumber terverifikasi, net entitlement bukan 70% otomatis, setoran parsial dan banyak invoice, double-payment, pengeluaran tertaut Purchasing, penolakan cross-date, ID duplicate, sumber kosong, asal sumber di luar cutover, serta penolakan COGS tanpa valuasi.
- Semua pekerjaan pada branch `feature/hpp-actual-staging` (Draft PR #1) dan **tidak menjalankan SQL atau menulis Supabase aktif**.