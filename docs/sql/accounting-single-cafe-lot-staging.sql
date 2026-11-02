-- BUNBUN OS: SINGLE-PRODUCT CAFE RELEASE → SAME ATOMIC MULTI-LOT ENGINE.
-- REVIEW ONLY / EPHEMERAL POSTGRES CI. DO NOT RUN ON PRODUCTION.
-- The trusted backend must verify fresh Owner auth, real lot evidence,
-- destination and approved physical stock before calling this function.
-- CAFE_OUT for consignment is NOT sale, COGS or cash deposit.
create or replace function bunbun_accounting.record_single_cafe_release_staging(
  p_product_id bigint,
  p_qty integer,
  p_movement_date date,
  p_destination text,
  p_evidence_ref text,
  p_allocations jsonb,
  p_operation_key uuid,
  p_actor_id uuid
) returns jsonb
language plpgsql security invoker
set search_path=pg_catalog
as $fn$
declare
  v_gate bunbun_accounting.lot_tracking_control%rowtype;
  v_result jsonb;
  v_item jsonb;
  v_id bigint;
  v_movement_ids jsonb;
begin
  if current_user<>'service_role' then
    raise exception 'Trusted service role required'; end if;
  if p_product_id is null or p_product_id<=0 or
    p_qty is null or p_qty<=0 or p_movement_date is null or
    nullif(btrim(coalesce(p_destination,'')),'') is null or
    length(btrim(coalesce(p_evidence_ref,'')))<6 or
    p_operation_key is null or
    jsonb_typeof(p_allocations)<>'array' or
    jsonb_array_length(p_allocations) not between 1 and 100 then
    raise exception 'Valid product, qty, destination, evidence and explicit lots required';
  end if;
  select * into v_gate from bunbun_accounting.lot_tracking_control
  where singleton;
  if not found or v_gate.mode<>'ON'
    or p_movement_date<v_gate.cutover_on then
    raise exception 'Lot tracking cutover is not approved for this movement';
  end if;

  v_item:=jsonb_build_array(jsonb_build_object(
    'productId',p_product_id,
    'quantity',p_qty,
    'allocations',p_allocations
  ));
  v_result:=bunbun_accounting.record_lot_assigned_release(
    p_movement_date,
    btrim(p_destination),
    'CAFE_CONSIGNMENT',
    btrim(p_evidence_ref),
    v_item,
    p_operation_key,
    p_actor_id
  );
  v_movement_ids:=v_result->'movement_ids';
  if jsonb_typeof(v_movement_ids)<>'array'
    or jsonb_array_length(v_movement_ids)<>1 then
    raise exception 'Single cafe release must have exactly one stock movement';
  end if;
  v_id:=(v_movement_ids->>0)::bigint;
  return jsonb_build_object(
    'movement_id',v_id,
    'product_id',p_product_id,
    'deposited_qty',p_qty,
    'remaining_finished_qty',(
      select coalesce(sum(available_qty),0)
      from bunbun_accounting.finished_lot_positions
      where product_id=p_product_id and location='FINISHED'
    ),
    'already_exists',v_result->'already_exists',
    'source_lot_verified_in_ci',true,
    'recognized_sale',false,
    'cogs_posted',false,
    'cash_posted',false
  );
end
$fn$;
revoke all on function bunbun_accounting.record_single_cafe_release_staging(
  bigint,integer,date,text,text,jsonb,uuid,uuid)
from public,anon,authenticated;
grant execute on function bunbun_accounting.record_single_cafe_release_staging(
  bigint,integer,date,text,text,jsonb,uuid,uuid)
to service_role;
