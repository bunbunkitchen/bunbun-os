-- STAGING ONLY pkgrqalpazhwdcxmthvb; review before production proposal.
BEGIN;
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.profiles(id,full_name,role)
 VALUES(NEW.id,coalesce(NEW.raw_user_meta_data->>'full_name',split_part(NEW.email,'@',1)),'helper'::public.user_role);
 RETURN NEW;
END; $$;
ALTER FUNCTION public.set_updated_at() SET search_path='';
ALTER FUNCTION public.set_sales_updated_at() SET search_path='';
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_owner_or_baker() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_owner_baker_or_helper() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_owner() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_profiles_updated_at() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.assert_frozen_flow_operator() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.record_shaping_split(bigint,bigint,integer,integer,integer,text,date,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.release_frozen_stock(bigint,integer,date,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.record_baking_result(bigint,integer,integer,date,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.record_non_purchase_stock(date,bigint,numeric,text,numeric,text,text,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_automatic_split_lot_code() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.record_inventory_adjustment(date,bigint,text,numeric,text,text,text,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_baker() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_sales_updated_at() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sync_recipe_output_ingredient() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sync_recipe_output_from_ingredient() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.prevent_sub_recipe_finished_stock() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_sale_transaction(bigint) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_finished_product_balances() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.refresh_finished_product_stock_balance() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.record_product_stock_adjustment(bigint,text,integer,date,text,text,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.record_cafe_deposit(bigint,integer,date,uuid,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.record_multi_product_release(date,text,text,jsonb,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.record_sale_transaction(date,text,text,jsonb,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_sale_transaction(bigint,date,text,text,jsonb) FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;
COMMIT;
