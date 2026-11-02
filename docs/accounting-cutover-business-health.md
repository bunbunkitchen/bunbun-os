# Bunbun OS — Cutover dan Business Health

Status: RANCANGAN DI BRANCH STAGING. Belum ada tanggal cutover yang disetujui. Tidak ada pencatatan jurnal atau mutasi otomatis ke database aktif.

## Tujuan Owner
- Mengetahui laba usaha aktual dan arus kas terpisah.
- Melihat pertumbuhan penjualan, efisiensi produksi, dan margin per bulan.
- Menilai kemampuan memberi bonus, menambah karyawan, produksi dan kafe baru tanpa mengorbankan kas operasional.

## Kebijakan data
- Sejarah sebelum cutover tetap disimpan, namun ditandai sebagai data perbandingan yang belum sepenuhnya dapat diaudit.
- Tidak ada normalisasi diam-diam pada konversi satuan, harga master, saldo negatif, maupun riwayat pemakaian.
- Harga bahan master untuk costing resep/penawaran tetap terpisah dari biaya persediaan menurut transaksi perolehan.
- Deposito/setoran kafe yang dicatat Owner sudah merupakan nominal diterima; sistem TIDAK menguranginya lagi sebesar persentase kafe.
- Produk yang dikirim ke kafe belum tentu terjual; pemindahan stok bukan otomatis pendapatan.
- Pembelian bahan memengaruhi kas dan persediaan; pemakaian bahan menjadi WIP/produksi; produk terjual menjadi HPP penjualan, dengan skema posting yang akan disetujui kemudian.
- Stock adjustment tidak otomatis menciptakan transaksi kas.

## Tahap 1 — Menyusun draft saldo awal (sudah ada di branch)
Menu Owner: Persiapan Saldo Awal, /finance/cutover.
1. Owner mengusulkan tanggal mulai akuntansi baru (D). Belum ada default tanggal resmi.
2. Sistem menampilkan stok buku dari mutasi dengan tanggal < D. Baris bersatuan tak kompatibel, transaksi tak dikenal dan saldo buku negatif ditandai; tidak dinormalisasi ke nol.
3. Owner mencatat jumlah fisik per bahan, biaya per satuan master, dokumen bukti, dan alasan selisih.
4. Owner memasukkan saldo kas tunai, bank, piutang, utang, stok produk jadi, frozen, stok di kafe yang BELUM terjual, dan aset serta kewajiban lain.
5. Field kosong tetap TIDAK DIKETAHUI; tidak diam-diam menjadi nol. Saldo rekening tidak diturunkan otomatis dari incomes minus expenses.
6. Formulir menghasilkan draft yang bisa diunduh sebagai JSON, dibuka kembali dan form stok opname CSV. File ada di perangkat Owner, bukan database.
7. Nominal aset, kewajiban dan selisih ekuitas yang muncul hanya bersifat sementara sampai ada verifikasi bukti dan persetujuan.

## Tahap 2 — Validasi dan aktivasi akuntansi (belum ada)
1. Lakukan stok opname dalam kondisi cutover yang disepakati; pisahkan bahan, sub-recipe, produk jadi, frozen, titipan kafe dan produk rusak/retur.
2. Rekonsiliasi rekening bank, kas tunai, saldo piutang, utang dan pemisahan modal Owner vs pengeluaran pribadi.
3. Verifikasi nilai setiap kategori aset; jangan menggandakan bahan yang sudah masuk produk jadi atau WIP.
4. Definisikan posting saldo awal dan transaksi sesudah D dalam ledger akuntansi tersendiri, lengkap dengan izin Owner dan audit trail.
5. Buat migrasi database, kontrol akses RLS Owner, pengujian keamanan, dry-run dan prosedur rollback; nilai lama tidak di-overwrite.
6. Lakukan penutupan bulanan dengan rekonsiliasi jumlah stok, nilai stok, biaya per batch, produk terjual dan setoran kafe.

## Tahap 3 — Laporan manajemen (belum ada)
- Arus kas: penerimaan aktual dan pembayaran aktual, dipisah dari laporan laba.
- Laba rugi: pendapatan bisnis yang menjadi hak Bunbun, HPP barang yang benar-benar terjual, beban operasi dan penyusutan yang telah ditentukan.
- Posisi keuangan: kas, bank, piutang, persediaan bahan, WIP, produk jadi, frozen, titipan belum terjual, aset lain, utang dan modal.
- Pelacakan performa bulanan: net sales, gross margin, net margin, hasil produk bagus vs reject, perputaran stok, produktivitas, kontribusi produk.

## Tahap 4 — Keputusan bonus dan ekspansi (belum ada)
- Bonus didasarkan pada laba berulang, kas tersedia setelah cadangan dan kemampuan melunasi kewajiban; tidak semata saldo rekening.
- Penambahan staf menggunakan skenario kapasitas, jam kerja, tambahan penjualan yang diperlukan dan target margin.
- Ekspansi supply kitchen: pendapatan wholesale dan kafe dipisah, simulasi biaya tetap/variabel serta break-even dan kebutuhan modal kerja.

## Perlindungan kualitas pelaporan
- Tanggal cutover, fisik persediaan, dan saldo uang tidak boleh dipilih secara otomatis untuk tujuan posting.
- Tidak ada data historis yang dihapus agar tampak rapi.
- HPP historis Rp2.615 per yield atau nilai estimasi lama tidak diubah sampai ada cutover yang disahkan.
- Draft UI tidak menyimpan maupun mengubah cashbook, stok, purchasing, HPP atau jurnal.
- Semua perubahan saat ini hanya berada di Draft Pull Request #1.