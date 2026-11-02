# Bunbun OS — Owner Accounting Edge Security Gate (Staging Only)

**Status: CODE ONLY / DRAFT PR / NEVER DEPLOYED.**

## Tujuan
Verifikasi peran Owner aktif di backend sebelum menghubungkan saldo awal, laporan keuangan dan fungsi posting. Halaman Owner (`RoleRoute`) bukan bukti otorisasi server.

## Kode
- `supabase/functions/_shared/accountingOwnerReadiness.js`: handler bebas dependensi dengan pemeriksaan token, Owner aktif, origin eksplisit dan kebijakan allowlist tindakan.
- `supabase/functions/accounting-owner-readiness/index.ts`: Supabase Edge Function dengan supabase-js Auth `auth.getUser(jwt)` untuk memverifikasi token secara remote dan client server-only `profiles` untuk memeriksa `role = owner` serta `is_active = true` saat permintaan berlangsung.
- `tests/hppAccountingOwnerReadiness.test.js`: uji token palsu/hilang, staf, Owner nonaktif, profil mismatch, error Auth/database, origin/CORS, body tidak sah, upaya posting dan mode non-staging.
- `.github/workflows/hpp-staging-checks.yml`: pengujian Node + lint + build + Deno typecheck, semuanya hanya di GitHub CI.

## Perilaku API
- **Hanya** `POST {"action":"readiness"}`. Permintaan `post-journal`, `approve-opening`, `ownerId`, `canPost`, atau operasi lain selalu ditolak.
- Bila valid, balasan hanya menyatakan `BLOCKED_PENDING_CUTOVER`, `ledgerConnected:false`, `mayPost:false`. Tidak memuat saldo, data persediaan, atau identitas pribadi.
- JWT tidak di-*decode* sebagai dasar identitas. User id diperoleh dari `auth.getUser(jwt)`; profil dan role dibaca langsung lagi dari database.
- `Owner` nonaktif atau role selain Owner dilarang, walau aplikasi di browser bisa dimanipulasi.
- Hanya origin exact yang diizinkan. CORS **bukan** otorisasi; JWT dan profil tetap wajib.
- Respons memakai cache-control `no-store`. Token, service key dan kesalahan internal tidak ditampilkan kepada pemanggil.

## Persyaratan konfigurasi staging
1. Buat **proyek Supabase staging terpisah**, bukan proyek `bunbun-os` produksi. Saat audit 2 Nov 2026, hanya proyek produksi yang tersedia.
2. Tetapkan `BUNBUN_ACCOUNTING_STAGE=isolated-staging` untuk environment staging **saja**.
3. Tetapkan `BUNBUN_ACCOUNTING_ALLOWED_ORIGIN` ke satu URL frontend staging yang benar-benar tepercaya, misalnya `https://staging.example.org` sebagai placeholder (bukan URL nyata).
4. Biarkan `verify_jwt = true` pada Edge Function. Jangan menonaktifkan pemeriksaan JWT platform.
5. Runtime Edge memerlukan `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` pada **server environment**, tidak dalam kode frontend, file GitHub, atau Vite `VITE_*`.
6. Pastikan tabel `profiles(id, role, is_active)` pada staging mengikuti skema sebenarnya dan bahwa Owner punya akun terverifikasi untuk uji role. Jangan menyalin data sensitif atau kredensial produksi.
7. Jalankan tes fungsi staging sebagai Owner, Baker, Helper dan pengguna nonaktif. Verifikasi service role key tidak pernah muncul pada respons atau browser.

## Gerbang berikutnya sebelum pembukaan posting sungguhan
- Buat/validasi migrasi resmi dengan Supabase CLI untuk private ledger, terpisah dari data operasional historis.
- Bangun backend posting atomik yang memverifikasi session Owner dan memetakan `actor_id` ke user sesi server; tidak mengambil `actor_id` dari request body.
- Cek `source_key`, status invoice/piutang, jumlah stok dan MWA, transaksi duplikat, periode, `reversal`, lock transaksi dan audit trail.
- Uji RLS/grants sesungguhnya di staging, uji rollback dan non-owner denial, baru pertimbangkan release.
- Tetapkan saldo awal/tanggal cutover yang disahkan Owner sebelum ada satu pun jurnal POSTED dari transaksi nyata.

**Endpoint readiness bukan sistem akuntansi yang aktif. Semua SQL dan transaksi produksi tetap tidak berubah.**