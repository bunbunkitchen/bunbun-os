import {supabase} from '../lib/supabase';
import {purchaseAccountingAvailable} from './accountingPurchaseService';
export async function requestCafeException(input){
 if(!purchaseAccountingAvailable)throw Error('Pencatatan uang muka dan waste tersedia di staging yang ditentukan.');
 const {data,error}=await supabase.functions.invoke('accounting-cafe-exceptions',{body:input});
 if(error){let detail;try{detail=await error.context?.json();}catch{/* gateway unavailable */}
  throw Error(detail?.message||'Periksa sesi Owner, saldo/lot sumber, bukti dan periode sebelum menjurnal.');}
 return data;
}
