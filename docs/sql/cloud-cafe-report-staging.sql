-- Isolated staging only. Factual cafe reports; no stock, sales, cash or journal writes.
BEGIN;
CREATE TABLE bunbun_accounting.cafe_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), month date NOT NULL CHECK(extract(day FROM month)=1),
 cafe_key text NOT NULL CHECK(cafe_key IN('PUBLIC_HUB','PUBLIC_COFFEE')), revision integer NOT NULL CHECK(revision>0),
 supersedes uuid REFERENCES bunbun_accounting.cafe_reports(id), operation_key uuid NOT NULL UNIQUE,
 input jsonb NOT NULL, source_snapshot jsonb NOT NULL, source_fingerprint text NOT NULL,
 summary jsonb NOT NULL CHECK(summary->>'readyToClose'='false'),
 actor_id uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(month,cafe_key,revision)
);
CREATE TABLE bunbun_accounting.current_cafe_reports (
 month date NOT NULL, cafe_key text NOT NULL, report_id uuid NOT NULL UNIQUE REFERENCES bunbun_accounting.cafe_reports(id), PRIMARY KEY(month,cafe_key)
);
CREATE TABLE bunbun_accounting.cafe_report_receipts (
 report_id uuid NOT NULL REFERENCES bunbun_accounting.cafe_reports(id), income_id bigint NOT NULL REFERENCES public.incomes(id),
 amount numeric(18,2) NOT NULL CHECK(amount>0 AND amount::text NOT IN('NaN','Infinity','-Infinity')), PRIMARY KEY(report_id,income_id)
);
CREATE INDEX cafe_report_receipts_income ON bunbun_accounting.cafe_report_receipts(income_id);
CREATE TABLE bunbun_accounting.cafe_movement_assignments (
 movement_id bigint PRIMARY KEY REFERENCES public.product_stock_movements(id),
 cafe_key text NOT NULL CHECK(cafe_key IN('PUBLIC_HUB','PUBLIC_COFFEE')),
 first_report_id uuid NOT NULL REFERENCES bunbun_accounting.cafe_reports(id), original_source jsonb NOT NULL, evidence_ref text NOT NULL
);
ALTER TABLE bunbun_accounting.cafe_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE bunbun_accounting.current_cafe_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE bunbun_accounting.cafe_report_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE bunbun_accounting.cafe_movement_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON bunbun_accounting.cafe_reports,bunbun_accounting.current_cafe_reports,bunbun_accounting.cafe_report_receipts,bunbun_accounting.cafe_movement_assignments FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON bunbun_accounting.cafe_reports,bunbun_accounting.cafe_report_receipts,bunbun_accounting.cafe_movement_assignments TO service_role;
GRANT SELECT,INSERT,UPDATE ON bunbun_accounting.current_cafe_reports TO service_role;

CREATE FUNCTION bunbun_accounting.cafe_report_sources(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE m date:=((p_input->>'month')||'-01')::date; cafe text:=p_input->>'cafeKey'; source jsonb; previous bunbun_accounting.cafe_reports%rowtype;
BEGIN
 SELECT r.* INTO previous FROM bunbun_accounting.current_cafe_reports c JOIN bunbun_accounting.cafe_reports r ON r.id=c.report_id
 WHERE c.month=(m-interval '1 month')::date AND c.cafe_key=cafe;
 IF (SELECT count(*) FROM public.product_stock_movements WHERE movement_date>=m AND movement_date<m+interval '1 month' AND movement_type IN('CAFE_OUT','CAFE_IN') AND NOT is_deleted)>2000
 THEN RAISE EXCEPTION 'Monthly source list needs a narrower import'; END IF;
 SELECT jsonb_build_object(
 'products',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id::text,'name',nama) ORDER BY id) FROM public.products WHERE NOT is_deleted),'[]'::jsonb),
 'previousReportId',previous.id,'previousRows',coalesce(previous.input->'rows','[]'::jsonb),
 'movements',coalesce((SELECT jsonb_agg(jsonb_build_object('id',x.id::text,'date',x.movement_date,'type',x.movement_type,'productId',x.product_id::text,
 'quantity',x.qty::text,'cafeKey',coalesce(a.cafe_key,e.request->>'cafeKey',CASE WHEN s.sales_channel::text IN('PUBLIC_HUB','PUBLIC_COFFEE') THEN s.sales_channel::text END,t.tracked_cafe,CASE WHEN x.id::text IN(SELECT jsonb_array_elements_text(coalesce(p_input->'shipmentIds','[]'::jsonb)) UNION ALL SELECT jsonb_array_elements_text(coalesce(p_input->'returnIds','[]'::jsonb))) THEN cafe END,''),
 'excluded',coalesce(x.qty<=0 OR x.unit<>'pcs' OR s.sales_channel::text IN('DIRECT','CAFE_OTHER') OR (x.movement_type='CAFE_IN' AND x.sale_id IS NOT NULL),false),
 'source',to_jsonb(x),'saleChannel',s.sales_channel,'valuedCafe',e.request->>'cafeKey','trackedCafe',t.tracked_cafe) ORDER BY x.id)
 FROM public.product_stock_movements x LEFT JOIN public.sales s ON s.id=x.sale_id
 LEFT JOIN bunbun_accounting.cafe_movement_assignments a ON a.movement_id=x.id
 LEFT JOIN bunbun_accounting.product_cost_events e ON e.movement_id=x.id AND e.kind IN('SHIP','RETURN')
 LEFT JOIN LATERAL (SELECT CASE o.destination WHEN 'PUBLIC_HUB' THEN 'PUBLIC_HUB' WHEN 'Public Hub' THEN 'PUBLIC_HUB'
 WHEN 'PUBLIC_COFFEE' THEN 'PUBLIC_COFFEE' WHEN 'The Public Coffee' THEN 'PUBLIC_COFFEE' END AS tracked_cafe
 FROM bunbun_accounting.lot_release_operations o WHERE o.operation_key=x.operation_key AND o.status='RECORDED' AND o.destination_type='CAFE_CONSIGNMENT') t ON true
 WHERE x.movement_date>=m AND x.movement_date<m+interval '1 month' AND x.movement_type IN('CAFE_OUT','CAFE_IN') AND NOT x.is_deleted),'[]'::jsonb),
 'incomes',coalesce((SELECT jsonb_agg(jsonb_build_object('id',i.id::text,'date',i.tanggal,'net',i.pemasukan_bunbun::text,'source',to_jsonb(i),
 'usedElsewhere',coalesce((SELECT sum(l.amount) FROM bunbun_accounting.cafe_report_receipts l JOIN bunbun_accounting.current_cafe_reports c ON c.report_id=l.report_id
 WHERE l.income_id=i.id AND NOT(c.month=m AND c.cafe_key=cafe)),0)::text) ORDER BY i.id)
 FROM public.incomes i WHERE NOT i.is_deleted AND i.id IN(SELECT (r->>'incomeId')::bigint FROM jsonb_array_elements(coalesce(p_input->'receipts','[]'::jsonb)) r)),'[]'::jsonb)
 ) INTO source;
 RETURN source||jsonb_build_object('fingerprint',encode(sha256(convert_to(source::text,'UTF8')),'hex'));
END $fn$;
REVOKE ALL ON FUNCTION bunbun_accounting.cafe_report_sources(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION bunbun_accounting.cafe_report_sources(jsonb) TO service_role;

CREATE FUNCTION public.accounting_cafe_report_service(p_action text,p_payload jsonb,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE inp jsonb:=CASE WHEN p_action='record' THEN p_payload->'input' ELSE p_payload END; m date; cafe text; current_id uuid; prior bunbun_accounting.cafe_reports%rowtype;
 old bunbun_accounting.cafe_reports%rowtype; source jsonb; item jsonb; mid bigint; bank public.incomes%rowtype; used numeric; rid uuid:=gen_random_uuid(); rev integer;
BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'Private backend required'; END IF;
 PERFORM 1 FROM public.profiles WHERE id=p_actor_id AND role::text='owner' AND is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active Owner required'; END IF;
 IF coalesce(inp->>'month','')!~'^20[0-9]{2}-(0[1-9]|1[0-2])$' OR coalesce(inp->>'cafeKey','') NOT IN('PUBLIC_HUB','PUBLIC_COFFEE') THEN RAISE EXCEPTION 'Month and cafe required'; END IF;
 m:=((inp->>'month')||'-01')::date; cafe:=inp->>'cafeKey';
 IF p_action='inspect' THEN
  source:=bunbun_accounting.cafe_report_sources(inp);
  SELECT r.* INTO prior FROM bunbun_accounting.current_cafe_reports c JOIN bunbun_accounting.cafe_reports r ON r.id=c.report_id WHERE c.month=m AND c.cafe_key=cafe;
  RETURN source||jsonb_build_object('sourceChanged',CASE WHEN prior.id IS NULL THEN false ELSE prior.source_fingerprint IS DISTINCT FROM bunbun_accounting.cafe_report_sources(prior.input)->>'fingerprint' END)||jsonb_build_object('currentReport',(SELECT to_jsonb(r) - 'source_snapshot' FROM bunbun_accounting.current_cafe_reports c JOIN bunbun_accounting.cafe_reports r ON r.id=c.report_id WHERE c.month=m AND c.cafe_key=cafe),
  'history',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'revision',revision,'createdAt',created_at,'status',summary->>'status') ORDER BY revision DESC) FROM bunbun_accounting.cafe_reports WHERE month=m AND cafe_key=cafe),'[]'::jsonb),
  'receiptCandidates',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id::text,'date',tanggal,'net',pemasukan_bunbun::text,'description',keterangan) ORDER BY tanggal,id) FROM public.incomes WHERE NOT is_deleted AND ((tanggal>=m AND tanggal<m+interval '3 months') OR id IN(SELECT (r->>'incomeId')::bigint FROM jsonb_array_elements(coalesce(prior.input->'receipts','[]'::jsonb)) r))),'[]'::jsonb));
 END IF;
 IF p_action NOT IN('review','record') THEN RAISE EXCEPTION 'Unknown action'; END IF;
 IF inp->>'factsConfirmed'<>'true' OR length(coalesce(inp->>'evidenceRef',''))<6 OR length(coalesce(inp->>'openingEvidenceRef',''))<6
 OR jsonb_array_length(inp->'rows') NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Complete factual report required'; END IF;
 -- A single transaction serializes versions and all cross-cafe receipt allocations.
 PERFORM pg_advisory_xact_lock(1129662026,1);
 IF p_action='record' THEN
  SELECT * INTO old FROM bunbun_accounting.cafe_reports WHERE operation_key=(p_payload->>'operationKey')::uuid;
  IF FOUND THEN
   IF old.input IS DISTINCT FROM inp OR old.actor_id<>p_actor_id THEN RAISE EXCEPTION 'Operation replay differs'; END IF;
   RETURN jsonb_build_object('id',old.id,'revision',old.revision,'summary',old.summary,'replayed',true);
  END IF;
 END IF;
 SELECT c.report_id INTO current_id FROM bunbun_accounting.current_cafe_reports c WHERE c.month=m AND c.cafe_key=cafe;
 IF current_id IS DISTINCT FROM (inp->>'expectedReportId')::uuid THEN RAISE EXCEPTION 'Report version changed'; END IF;
 PERFORM 1 FROM bunbun_accounting.periods WHERE month_start=m FOR SHARE;
 IF EXISTS(SELECT 1 FROM bunbun_accounting.periods WHERE month_start=m AND status='CLOSED') THEN RAISE EXCEPTION 'Closed period cannot be revised'; END IF;
 -- Freeze a consistent selected source snapshot while recording.
 PERFORM 1 FROM public.product_stock_movements WHERE movement_date>=m AND movement_date<m+interval '1 month' AND movement_type IN('CAFE_OUT','CAFE_IN') ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.incomes WHERE id IN(SELECT (r->>'incomeId')::bigint FROM jsonb_array_elements(inp->'receipts') r) ORDER BY id FOR UPDATE;
 source:=bunbun_accounting.cafe_report_sources(inp);
 IF (SELECT count(*) FROM public.product_stock_movements WHERE id::text IN(SELECT jsonb_array_elements_text(inp->'shipmentIds')) AND movement_type='CAFE_OUT' AND NOT is_deleted AND movement_date>=m AND movement_date<m+interval '1 month')<>jsonb_array_length(inp->'shipmentIds')
 OR (SELECT count(*) FROM public.product_stock_movements WHERE id::text IN(SELECT jsonb_array_elements_text(inp->'returnIds')) AND movement_type='CAFE_IN' AND NOT is_deleted AND movement_date>=m AND movement_date<m+interval '1 month')<>jsonb_array_length(inp->'returnIds')
 THEN RAISE EXCEPTION 'Source identities or quantities differ'; END IF;
 FOR item IN SELECT x FROM jsonb_array_elements(source->'movements') x LOOP
  IF item->>'id' IN(SELECT jsonb_array_elements_text(inp->'shipmentIds') UNION ALL SELECT jsonb_array_elements_text(inp->'returnIds')) THEN
   IF (item->>'excluded')::boolean OR (item->>'cafeKey'<>'' AND item->>'cafeKey'<>cafe)
    OR (item->>'valuedCafe' IS NOT NULL AND item->>'valuedCafe'<>cafe) OR (item->>'trackedCafe' IS NOT NULL AND item->>'trackedCafe'<>cafe)
    OR (item->>'saleChannel' IN('PUBLIC_HUB','PUBLIC_COFFEE') AND item->>'saleChannel'<>cafe)
   THEN RAISE EXCEPTION 'Cafe movement identity differs'; END IF;
  END IF;
 END LOOP;
 FOR item IN SELECT x FROM jsonb_array_elements(inp->'receipts') x LOOP
  SELECT * INTO bank FROM public.incomes WHERE id=(item->>'incomeId')::bigint AND NOT is_deleted AND tanggal<=(inp->>'asOfDate')::date;
  IF NOT FOUND THEN RAISE EXCEPTION 'Receipt source missing'; END IF;
  SELECT coalesce(sum(l.amount),0) INTO used FROM bunbun_accounting.cafe_report_receipts l JOIN bunbun_accounting.current_cafe_reports c ON c.report_id=l.report_id
  WHERE l.income_id=bank.id AND NOT(c.month=m AND c.cafe_key=cafe);
  IF (item->>'amount')::numeric<=0 OR used+(item->>'amount')::numeric>bank.pemasukan_bunbun THEN RAISE EXCEPTION 'Receipt allocation exceeds net source'; END IF;
 END LOOP;
 IF p_action='review' THEN RETURN source; END IF;
 IF p_payload->>'fingerprint' IS DISTINCT FROM source->>'fingerprint' THEN RAISE EXCEPTION 'Source changed'; END IF;
 IF p_payload->'summary'->>'readyToClose' IS DISTINCT FROM 'false' OR p_payload->'summary'->>'accountingStatus' IS DISTINCT FROM 'REQUIRES_LEDGER_RECONCILIATION' THEN RAISE EXCEPTION 'Factual reports cannot close accounting'; END IF;
 SELECT * INTO prior FROM bunbun_accounting.cafe_reports WHERE id=current_id; rev:=coalesce(prior.revision,0)+1;
 INSERT INTO bunbun_accounting.cafe_reports(id,month,cafe_key,revision,supersedes,operation_key,input,source_snapshot,source_fingerprint,summary,actor_id)
 VALUES(rid,m,cafe,rev,current_id,(p_payload->>'operationKey')::uuid,inp,source,source->>'fingerprint',p_payload->'summary',p_actor_id);
 INSERT INTO bunbun_accounting.cafe_report_receipts(report_id,income_id,amount)
 SELECT rid,(x->>'incomeId')::bigint,(x->>'amount')::numeric FROM jsonb_array_elements(inp->'receipts') x;
 FOR mid IN SELECT x::bigint FROM (SELECT jsonb_array_elements_text(inp->'shipmentIds') x UNION ALL SELECT jsonb_array_elements_text(inp->'returnIds')) z LOOP
  INSERT INTO bunbun_accounting.cafe_movement_assignments(movement_id,cafe_key,first_report_id,original_source,evidence_ref)
  SELECT mid,cafe,rid,to_jsonb(x),inp->>'evidenceRef' FROM public.product_stock_movements x WHERE x.id=mid ON CONFLICT(movement_id) DO NOTHING;
 END LOOP;
 INSERT INTO bunbun_accounting.current_cafe_reports(month,cafe_key,report_id) VALUES(m,cafe,rid) ON CONFLICT(month,cafe_key) DO UPDATE SET report_id=excluded.report_id;
 RETURN jsonb_build_object('id',rid,'revision',rev,'summary',p_payload->'summary','replayed',false);
END $fn$;
REVOKE ALL ON FUNCTION public.accounting_cafe_report_service(text,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.accounting_cafe_report_service(text,jsonb,uuid) TO service_role;

CREATE FUNCTION bunbun_accounting.guard_cafe_report_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF TG_TABLE_NAME='incomes' THEN
  IF EXISTS(SELECT 1 FROM bunbun_accounting.cafe_report_receipts l JOIN bunbun_accounting.current_cafe_reports c ON c.report_id=l.report_id WHERE l.income_id=OLD.id)
  THEN RAISE EXCEPTION 'Income is linked to an active cafe report; revise report links first'; END IF;
 ELSIF TG_TABLE_NAME='product_stock_movements' THEN
  IF EXISTS(SELECT 1 FROM bunbun_accounting.cafe_movement_assignments WHERE movement_id=OLD.id) THEN RAISE EXCEPTION 'Reported cafe movement is immutable'; END IF;
 ELSE
  IF NEW.kind IN('SHIP','RETURN') AND EXISTS(SELECT 1 FROM bunbun_accounting.cafe_movement_assignments WHERE movement_id=NEW.movement_id AND cafe_key<>NEW.request->>'cafeKey')
  THEN RAISE EXCEPTION 'Financial cafe identity differs from factual report'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION bunbun_accounting.guard_cafe_report_source() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_cafe_report_income BEFORE UPDATE OR DELETE ON public.incomes FOR EACH ROW EXECUTE FUNCTION bunbun_accounting.guard_cafe_report_source();
CREATE TRIGGER guard_cafe_report_movement BEFORE UPDATE OR DELETE ON public.product_stock_movements FOR EACH ROW EXECUTE FUNCTION bunbun_accounting.guard_cafe_report_source();
CREATE TRIGGER guard_cafe_report_cost_destination BEFORE INSERT ON bunbun_accounting.product_cost_events FOR EACH ROW EXECUTE FUNCTION bunbun_accounting.guard_cafe_report_source();
COMMIT;
