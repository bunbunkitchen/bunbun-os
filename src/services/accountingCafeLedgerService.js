import {supabase} from '../lib/supabase';
import {purchaseAccountingAvailable} from './accountingPurchaseService';
export async function requestCafeLedger(input){
 if(!purchaseAccountingAvailable)throw Error('Jurnal laporan kafe tersedia di staging yang ditentukan.');
 const {data,error}=await supabase.functions.invoke('accounting-cafe-ledger',{body:input});
 if(error){let detail;try{detail=await error.context?.json();}catch{/* gateway unavailable */}
  throw Error(detail?.message||'Jurnal belum dapat diproses. Periksa sesi Owner, sumber, saldo awal, dan periode.');}
 return data;
}
