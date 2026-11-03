import { supabase } from '../lib/supabase';

export const purchaseAccountingAvailable = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, '') === 'https://pkgrqalpazhwdcxmthvb.supabase.co';

export async function requestPurchaseAccounting(input) {
  if (!purchaseAccountingAvailable) throw new Error('Akuntansi pembelian tersedia di staging yang ditentukan.');
  const { data, error } = await supabase.functions.invoke('accounting-purchase', { body: input });
  if (error) {
    let detail;
    try { detail = await error.context?.json(); } catch { /* unavailable gateway */ }
    throw new Error(detail?.message || ({
      STAGING_NOT_CONFIGURED: 'Layanan akuntansi staging belum disiapkan.',
      OWNER_REQUIRED: 'Hanya Owner aktif yang dapat mencatat jurnal.',
      INVALID_REVIEW_REQUEST: 'Lengkapi transaksi, akun pembayaran dan referensi bukti.',
      PURCHASE_NOT_FOUND: 'Pembelian tidak ditemukan. Muat ulang daftar pembelian.',
    }[detail?.code]) || 'Layanan akuntansi belum dapat dihubungi. Transaksi belum dikonfirmasi.');
  }
  return data;
}
