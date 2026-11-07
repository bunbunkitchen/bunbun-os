import {supabase} from '../lib/supabase';
import {purchaseAccountingAvailable} from './accountingPurchaseService';
export async function requestCafeReport(input){
 if(!purchaseAccountingAvailable)throw Error('Rekonsiliasi kafe tersedia di staging yang ditentukan.');
 const {data,error}=await supabase.functions.invoke('accounting-cafe-report',{body:input});
 if(error){let detail;try{detail=await error.context?.json();}catch{/* gateway unavailable */}
  throw Error(detail?.message||'Laporan belum dapat diproses. Periksa sesi Owner, sumber dan periode.');}
 return data;
}
