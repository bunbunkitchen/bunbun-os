-- EPHEMERAL PG16 ONLY. Edit is a linked cancel + new sale in ONE SQL
-- transaction; never delete original sale_items or overwrite old lot sources.
-- Only when physically returned stock is verified; no automatic financial
-- reversal, receivables or cash entry. Old and new sales remain distinct IDs.
create or replace function bunbun_accounting.replace_lot_sale_staging(
 p_old_sale_id bigint,p_new_date date,p_new_channel text,
 p_return_evidence text,p_new_sale_evidence text,
 p_physically_returned boolean,p_new_items jsonb,
 p_cancel_key uuid,p_new_sale_key uuid,p_actor_id uuid
) returns jsonb language plpgsql security invoker
set search_path=pg_catalog as $fn$
declare
 v_previous bunbun_accounting.lot_sale_replacements%rowtype;
 v_fingerprint text;
 v_cancel jsonb;
 v_new jsonb;
 v_new_id bigint;
begin
 if current_user<>'service_role' then raise exception 'Service required'; end if;
 if p_cancel_key is null or p_new_sale_key is null or
   p_cancel_key=p_new_sale_key then
   raise exception 'Two distinct operation IDs required for sale edit'; end if;
 v_fingerprint:=md5(concat_ws('|',p_old_sale_id::text,p_new_date::text,
   p_new_channel,p_return_evidence,p_new_sale_evidence,
   p_new_items::text,p_actor_id::text,p_physically_returned::text));
 select * into v_previous from bunbun_accounting.lot_sale_replacements
 where old_sale_id=p_old_sale_id;
 if found then
   if v_previous.cancel_operation_key<>p_cancel_key or
     v_previous.new_operation_key<>p_new_sale_key or
     v_previous.actor_id<>p_actor_id or
     v_previous.fingerprint<>v_fingerprint then
     raise exception 'Sale already replaced with different request'; end if;
   return jsonb_build_object('old_sale_id',p_old_sale_id,
     'new_sale_id',v_previous.new_sale_id,
     'already_exists',true,'financial_posted',false);
 end if;
 v_cancel:=bunbun_accounting.cancel_lot_sale_staging(
   p_old_sale_id,p_new_date,p_return_evidence,p_physically_returned,
   p_cancel_key,p_actor_id);
 v_new:=bunbun_accounting.record_sale_with_lots_staging(
   p_new_date,p_new_channel,p_new_sale_evidence,p_new_items,
   p_new_sale_key,p_actor_id);
 v_new_id:=(v_new->>'sale_id')::bigint;
 insert into bunbun_accounting.lot_sale_replacements
  (old_sale_id,new_sale_id,cancel_operation_key,new_operation_key,
   fingerprint,actor_id)
 values(p_old_sale_id,v_new_id,p_cancel_key,p_new_sale_key,
   v_fingerprint,p_actor_id);
 return jsonb_build_object('old_sale_id',p_old_sale_id,
   'new_sale_id',v_new_id,'already_exists',false,
   'stock_reversed_and_reissued',true,
   'financial_posted',false,'financial_reversal_pending',true);
end $fn$;
revoke all on function bunbun_accounting.replace_lot_sale_staging(
 bigint,date,text,text,text,boolean,jsonb,uuid,uuid,uuid)
 from public,anon,authenticated;
grant execute on function bunbun_accounting.replace_lot_sale_staging(
 bigint,date,text,text,text,boolean,jsonb,uuid,uuid,uuid) to service_role;
