-- Applied only to isolated Supabase staging project pkgrqalpazhwdcxmthvb.
-- Trigger functions are executed by their attached database triggers; clients
-- should not invoke these functions as PostgREST RPCs.
BEGIN;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_sub_recipe_finished_stock() FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_finished_product_stock_balance() FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.assert_frozen_flow_operator() FROM PUBLIC, authenticated;
COMMIT;
