import { supabase } from '../lib/supabase';
import { purchaseAccountingAvailable } from './accountingPurchaseService';
export async function requestMaterialAccounting(input) {
  if (!purchaseAccountingAvailable) throw new Error('Penilaian bahan tersedia di staging yang ditentukan.');
  const { data, error } = await supabase.functions.invoke('accounting-material', { body: input });
  if (error) {
    let detail;
    try { detail = await error.context?.json(); } catch { /* gateway unavailable */ }
    throw new Error(detail?.message || ({ OWNER_REQUIRED: 'Hanya Owner aktif yang dapat mencatat jurnal.',
      SOURCE_NOT_FOUND: 'Pemakaian bahan tidak ditemukan.' }[detail?.code]) || 'Layanan penilaian bahan belum dapat dihubungi.');
  }
  return data;
}
