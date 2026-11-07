import { supabase } from '../lib/supabase';
import { purchaseAccountingAvailable } from './accountingPurchaseService';
export async function requestProductionAccounting(input){
 if(!purchaseAccountingAvailable)throw new Error('Penilaian produksi tersedia di staging yang ditentukan.');
 const {data,error}=await supabase.functions.invoke('accounting-production',{body:input});
 if(error){let detail;try{detail=await error.context?.json();}catch{/* gateway unavailable */}
   throw new Error(detail?.message||'Biaya produksi belum dapat diperiksa. Lengkapi sumber, bukti dan periode terlebih dahulu.');}
 return data;
}
