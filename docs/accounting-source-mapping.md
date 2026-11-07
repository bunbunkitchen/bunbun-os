# Bunbun OS — Pemetaan Sumber Transaksi ke Akuntansi Pasca-cutover

**Status: desain dan kode DRAFT pada PR #1. Tidak ada jurnal yang diposting, SQL yang dijalankan, atau laporan profit aktual yang diumumkan.**

## Temuan dari audit read-only (2 November 2026)
- `sales`: 1.723 baris aktif. PUBLIC_HUB 1.715 transaksi (total yang tercatat Rp56.905.000), DIRECT 5 (Rp386.000), PUBLIC_COFFEE 3 (Rp1.587.500). Angka tersebut bukan otomatis hak pendapatan Bunbun.
- `incomes`: 4 baris setoran aktif yang tersebar Agustus–Oktober 2026. Tidak boleh langsung dijumlahkan lagi sebagai revenue di samping seluruh sales.
- `expenses`: 177 baris aktif. 172 memiliki purchase_id; jangan memposting pembelian dan pengeluaran kas yang terhubung sebagai beban dobel.
- `product_stock_movements`: 2.600 baris CAFE_OUT aktif, masih merupakan aliran barang; bukan bukti semua produk terjual atau kas diterima.
- `inventory_transactions`: 2.356 PRODUCTION_OUT aktif tidak mempunyai unit_value; dilarang menghitung HPP akuntansi hanya dari nol tersebut.

## Pemetaan yang memerlukan verifikasi sumber
| Sumber / peristiwa | Usulan jurnal saat benar-benar terverifikasi | Menghindari kesalahan |
|---|---|---|
| Pembelian bahan baku | Dr Persediaan bahan (1210), Cr Utang usaha (2010) | Tidak langsung dicatat sebagai HPP produk terjual atau beban dua kali |
| Pembayaran pembelian | Dr Utang usaha (2010), Cr Kas/Bank | Memisahkan faktur pembelian dengan transaksi kas |
| Pemakaian bahan produksi | Dr WIP (1215), Cr Bahan baku (1210) | Butuh valuasi MWA dan stok aktual setelah cutover |
| Produk selesai | Dr Produk jadi / Frozen, Cr WIP | Tidak menjadi penjualan |
| Kirim barang titipan kafe | Dr Titipan kafe (1240), Cr Produk jadi / Frozen | Tidak mengakui seluruh pengiriman sebagai revenue |
| Produk titipan benar-benar terjual | Dr Piutang usaha (1120), Cr Pendapatan hak Bunbun (4010); terpisah Dr HPP (5010), Cr Titipan (1240) | Hak Bunbun dihitung sekali, stok keluar diakui saat benar-benar terjual |
| Setoran pembayaran dari kafe | Dr Bank/Kas, Cr Piutang usaha | Setoran bukan revenue baru bila penjualan sudah diakui |
| Pendapatan wholesale | Dr Piutang usaha, Cr Pendapatan wholesale (4020) | Terpisah dari penjualan titipan / bagi hasil kafe |
| Biaya operasional yang benar-benar beban periode dan dibayar | Dr akun beban, Cr Kas/Bank | Jangan otomatis memasukkan seluruh Maintenance atau seluruh Gaji ke beban periode |
| Beli aset oven yang langsung dibayar | Dr Aset usaha, Cr Kas/Bank | Bukan langsung HPP/beban, kebijakan penyusutan menyusul |
| Setoran modal Owner / pengambilan Owner | Akun ekuitas vs Kas/Bank | Bukan omzet dan bukan beban usaha |

## Pengaman yang sudah dikodekan
- `src/utils/accountingEventProposals.js` menghasilkan **DRAFT** saja jika ada event hasil review, tanggal, referensi sumber unik, dan bukti. Tidak membaca otomatis `sales`, `incomes`, `expenses` lama dan tidak menulis Supabase.
- Nominal revenue kafe adalah nominal **hak Bunbun terverifikasi**, bukan omzet bruto yang otomatis dikali 70% lagi.
- Setoran kafe mewajibkan referensi piutang, sehingga tidak diakui sebagai revenue kedua kalinya.
- Pembayaran yang terkait Purchasing tidak boleh diajukan sebagai beban periodik independen.
- Perpindahan bahan–WIP–finished–frozen–titipan tidak membuat pendapatan/kas.
- Usulan pemakaian stok dan penjualan harus melalui pemeriksaan saldo serta nilai persediaan oleh backend terproteksi sebelum posting.
- `src/utils/accountingPostedReports.js` hanya menerima jurnal POSTED, termasuk tepat satu jurnal saldo awal, dan akan menolak jurnal tidak seimbang, tanpa klasifikasi kas, atau duplikat operation key.

## Batasan yang wajib dilanjutkan sebelum rilis
1. Konfirmasi akun kafe / settlement hak Bunbun, waktu pengakuan penjualan (barang terjual vs kas diterima) dan stok konsinyasi berdasarkan perjanjian.
2. Bangun dan uji posting backend atomik dengan audit trail, anti-duplikat, logika reversal dan periode tutup.
3. Selaraskan sumber pendapatan kas/bank dengan piutang, dan biaya HPP dengan stock movements dari cutover yang sudah disetujui.
4. Uji end-to-end pada staging dengan 1 batch produk, kirim kafe, terjual sebagian, setoran sebagian, retur, pembayaran bahan dan gaji.
5. Aktifkan laporan laba rugi, arus kas dan growth dashboard hanya ketika ketuntasan sumber dan saldo awal sudah dinyatakan valid.

**Kesimpulan:** kode laporan dan pemetaan siap untuk pengujian terisolasi; data lama tetap tersimpan dan tidak ditulis balik.