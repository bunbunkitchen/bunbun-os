import {supabase} from '../lib/supabase';
import {purchaseAccountingAvailable} from './accountingPurchaseService';
export async function requestProductCostFlow(input){
 if(!purchaseAccountingAvailable)throw new Error('Alur biaya produk tersedia di staging yang ditentukan.');
 const {data,error}=await supabase.functions.invoke('accounting-product-flow',{body:input});
 if(error){let detail;try{detail=await error.context?.json();}catch{/* gateway unavailable */}
   throw new Error(detail?.message||'Posisi biaya produk belum dapat diperiksa. Lengkapi sumber dan periode.');}
 return data;
}
