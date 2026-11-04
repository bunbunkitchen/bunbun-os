// Read-only posted financial reports. Exact isolated project/origin; no DB URL/password.
import {createClient} from 'npm:@supabase/supabase-js@2.110.2';
import {isIsolatedAccountingStaging} from '../_shared/accountingStagingGuard.js';
import {parsePrivateLedgerReportRows} from '../_shared/accountingPrivateLedgerRead.js';
import {createOwnerMonthlyReportHandler} from '../_shared/accountingOwnerMonthlyReport.js';
const projectUrl=Deno.env.get('SUPABASE_URL')||'';
const anon=Deno.env.get('SUPABASE_ANON_KEY')||'';
const secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const isolated=projectUrl==='https://pkgrqalpazhwdcxmthvb.supabase.co';
const origins=new Set(isolated?[
 'https://bunbun-os-git-feature-hpp-actual-8b54a5-bunbunkitchens-projects.vercel.app',
 'https://bunbun-7ceems8s7-bunbunkitchens-projects.vercel.app','http://localhost:5173',
]:[]);
const configuredOrigin=Deno.env.get('BUNBUN_ACCOUNTING_ALLOWED_ORIGIN');
if(isolated&&configuredOrigin)origins.add(configuredOrigin);
const options={auth:{autoRefreshToken:false,persistSession:false}};
const auth=isolated&&anon?createClient(projectUrl,anon,options):null;
const admin=isolated&&secret?createClient(projectUrl,secret,options):null;
Deno.serve(request=>{
 const allowedOrigin=request.headers.get('Origin')||'';
 const configured=Boolean(auth&&admin&&origins.has(allowedOrigin)&&isIsolatedAccountingStaging({
  stageFlag:Deno.env.get('BUNBUN_ACCOUNTING_STAGE')||(isolated?'isolated-staging':''),
  stagingProjectRef:Deno.env.get('BUNBUN_ACCOUNTING_STAGING_REF')||(isolated?'pkgrqalpazhwdcxmthvb':''),projectUrl,allowedOrigin,
 }));
 return createOwnerMonthlyReportHandler({stageEnabled:configured,allowedOrigin,
  async verifyUserToken(token:string){if(!auth)throw Error('Unavailable');const {data,error}=await auth.auth.getUser(token);if(error||!data.user)throw Error('Unauthorized');return{id:data.user.id};},
  async loadProfile(id:string){if(!admin)throw Error('Unavailable');const{data,error}=await admin.from('profiles').select('id,role,is_active').eq('id',id).maybeSingle();if(error)throw error;return data;},
  async loadMonthlyReport(month:string,actor:string){
   if(!admin)throw Error('Unavailable');
   const {data,error}=await admin.rpc('accounting_owner_financial_report',{p_month:month,p_actor_id:actor});
   if(error)throw error;return data?parsePrivateLedgerReportRows([data]):null;
  },
 })(request);
});
