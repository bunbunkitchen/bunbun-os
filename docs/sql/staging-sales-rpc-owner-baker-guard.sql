-- Applied only to isolated Supabase staging project pkgrqalpazhwdcxmthvb.
-- The /sales application route permits Owner and Baker. Enforce that boundary
-- inside each SECURITY DEFINER RPC because HTTP route guards can be bypassed.
-- Keep authenticated EXECUTE for the frontend; the functions enforce role access.
BEGIN;
DO $$
DECLARE
  v_name text;
  v_oid regprocedure;
  v_def text;
  v_old constant text := '  v_user_id := public.assert_frozen_flow_operator();';
  v_guard constant text := E'  if not public.is_owner_or_baker() then\n    raise exception ''Sales hanya dapat diproses oleh Owner atau Baker.'' using errcode = ''42501'';\n  end if;\n';
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'record_sale_transaction(date,text,text,jsonb,uuid)',
    'update_sale_transaction(bigint,date,text,text,jsonb)',
    'delete_sale_transaction(bigint)'
  ] LOOP
    v_oid := v_name::regprocedure;
    v_def := pg_get_functiondef(v_oid);

    -- Idempotent when the guard has already been installed.
    IF position('Sales hanya dapat diproses oleh Owner atau Baker.' in v_def) > 0 THEN
      CONTINUE;
    END IF;

    IF length(v_def) - length(replace(v_def, v_old, '')) <> length(v_old) THEN
      RAISE EXCEPTION 'Expected exactly one operational guard in %', v_name;
    END IF;

    EXECUTE replace(v_def, v_old, v_old || E'\n' || v_guard);
  END LOOP;
END $$;
COMMIT;
